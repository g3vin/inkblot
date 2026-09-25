import Foundation
import SwiftUI
import Testing
@testable import inkblot_core

/// The Finishing tabs' model: what it draws from what the page publishes, where its
/// edits go, and the print jobs it reports — against the JSON the page sends.
@MainActor
struct FinishingTests {
    @MainActor private final class Wire {
        let bridge = ShellBridge()
        var seq = 0
        var sent: [String] = []

        init() {
            bridge.detach()
            bridge.attach { [unowned self] in sent.append($0) }
        }

        func event(_ type: String, _ payload: String) {
            bridge.receive(json: #"{"kind":"event","message":{"seq":\#(seq),"event":{"type":"\#(type)","payload":\#(payload)}}}"#)
            seq += 1
        }

        /// The commands sent, as their `type` and `payload`.
        var commands: [(type: String, payload: [String: Any])] {
            sent.compactMap { raw in
                guard let object = try? JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any],
                      let message = object["message"] as? [String: Any],
                      let command = message["command"] as? [String: Any],
                      let type = command["type"] as? String
                else { return nil }
                return (type, command["payload"] as? [String: Any] ?? [:])
            }
        }
    }

    private func setup(preset: String, width: Double, height: Double, formatId: String? = nil) -> String {
        let format = formatId.map { #","formatId":"\#($0)""# } ?? ""
        return #"""
        {"presetId":"\#(preset)","widthMm":\#(width),"heightMm":\#(height),"orientation":"portrait",
         "margins":{"topMm":25.4,"bottomMm":25.4,"insideMm":25.4,"outsideMm":25.4,"gutterMm":0},
         "mirrorMargins":false,"columns":1,"columnGapMm":6.35,
         "header":{"left":"","center":"","right":""},"footer":{"left":"","center":"{page}","right":""},
         "headerDistanceMm":12.7,"footerDistanceMm":12.7,"differentFirstPage":false,
         "pageNumberStart":1,"pageNumberFormat":"arabic","widowOrphanLines":2,"chapterStartsOnRecto":false\#(format)}
        """#
    }

    private func state(scope: String = "document", bookSetup: String? = nil, binding: String = "none") -> String {
        let book = bookSetup.map { #","pageSetup":\#($0)"# } ?? ""
        return #"""
        {"enabled":true,"docPath":"Novel/One","ready":true,
         "setup":\#(setup(preset: "a4", width: 210, height: 297, formatId: "a4")),"setupSource":"document",
         "hasOwnSetup":true,"formatId":"a4","formatModified":false,"pageCount":12,"currentPage":3,"zoom":1,
         "scope":"\#(scope)",
         "book":{"folder":"Novel","title":"The Novel","author":"A. Writer","language":"en-US"\#(book),
                 "binding":{"binding":"\#(binding)","sheetsPerSignature":4,"sheetPresetId":"letter","sheetFit":"actualSize",
                            "duplex":"automatic","paperThicknessMm":0.1,"cropMarks":true,"includeGuide":true}},
         "bookSetupActive":\#(bookSetup != nil),"bookChapters":["Novel/One","Novel/Two"],"suggestedInsideMarginMm":9.525}
        """#
    }

    @Test func theDraftIsTheDocumentsSetupUnderTheDocumentScope() {
        let wire = Wire()
        let layout = PageLayoutModel(bridge: wire.bridge)
        wire.event("pageLayoutState", state(bookSetup: setup(preset: "trade-6x9", width: 152.4, height: 228.6)))
        #expect(wire.bridge.droppedEventCount == 0)
        #expect(layout.setup?.presetId == "a4")
        #expect(layout.editsBook == false)
        #expect(layout.state?.currentPage == 3)
    }

    @Test func underABookScopeTheDraftAndTheEditsAreTheBooks() throws {
        let wire = Wire()
        let layout = PageLayoutModel(bridge: wire.bridge)
        wire.event("pageLayoutState", state(scope: "folder", bookSetup: setup(preset: "trade-6x9", width: 152.4, height: 228.6)))
        #expect(layout.editsBook)
        #expect(layout.setup?.presetId == "trade-6x9")

        var draft = try #require(layout.setup)
        draft.topMm = 30
        layout.apply(draft)
        let edit = try #require(wire.commands.last)
        #expect(edit.type == "setPageSetup")
        #expect(edit.payload["target"] as? String == "book")

        layout.applyFormat("a5-novel")
        #expect(wire.commands.last?.type == "applyFormat")
        #expect(wire.commands.last?.payload["target"] as? String == "book")
    }

    @Test func aBookWithNoSetupOfItsOwnStartsFromTheDocuments() {
        let wire = Wire()
        let layout = PageLayoutModel(bridge: wire.bridge)
        wire.event("pageLayoutState", state(scope: "project"))
        #expect(layout.editsBook)
        #expect(layout.setup?.presetId == "a4")
    }

    @Test func anEditIsKeptOnTheModelSoARebuiltTabShowsIt() throws {
        let wire = Wire()
        let layout = PageLayoutModel(bridge: wire.bridge)
        wire.event("pageLayoutState", state())
        var draft = try #require(layout.setup)
        draft.header.center = "{title}"
        layout.apply(draft)
        // Before the page answers, a tab built now reads the edit, not the old state.
        #expect(layout.setup?.header.center == "{title}")
        #expect(wire.commands.last?.payload["target"] as? String == "document")
    }

    @Test func theCatalogArrivesOnce() {
        let wire = Wire()
        let layout = PageLayoutModel(bridge: wire.bridge)
        wire.event("pageLayoutCatalog", #"""
        {"presets":[{"id":"a4","label":"A4","group":"ISO A","widthMm":210,"heightMm":297}],
         "formats":[{"id":"a4","label":"A4","group":"Everyday","summary":"A plain page.","kind":"prose"}],
         "signatureAdvice":[{"sheets":4,"label":"Standard"}],
         "tokens":[{"token":"{page}","label":"Page Number"}]}
        """#)
        #expect(wire.bridge.droppedEventCount == 0)
        #expect(layout.format("a4")?.summary == "A plain page.")
        #expect(layout.catalog?.tokens.first?.token == "{page}")
    }

    @Test func aJobIsShownWhileItRunsAndAFailureStays() async throws {
        let wire = Wire()
        let layout = PageLayoutModel(bridge: wire.bridge)
        wire.event("printJobStatus", #"{"jobId":"j1","kind":"export","format":"pdf","phase":"laying","done":2,"total":14}"#)
        #expect(layout.job?.phase == .laying)
        #expect(FinishingActionHeader.isRunning(layout.job!))
        wire.event("printJobStatus", #"{"jobId":"j1","kind":"export","format":"pdf","phase":"done","path":"/tmp/Book.pdf"}"#)
        #expect(layout.job?.path == "/tmp/Book.pdf")

        wire.event("printJobStatus", #"{"jobId":"j2","kind":"print","phase":"cancelled"}"#)
        #expect(layout.job == nil)

        wire.event("printJobStatus", #"{"jobId":"j3","kind":"print","phase":"failed","message":"No printer."}"#)
        #expect(layout.job?.message == "No printer.")
        layout.dismissJob()
        #expect(layout.job == nil)
        #expect(wire.bridge.droppedEventCount == 0)
    }

    @Test func theScopeIsTheBooksForBinding() {
        let wire = Wire()
        let layout = PageLayoutModel(bridge: wire.bridge)
        wire.event("pageLayoutState", state(binding: "saddle"))
        #expect(layout.bindingEnabled)
        layout.setScope(.project)
        #expect(wire.commands.last?.type == "setPrintScope")
        #expect(wire.commands.last?.payload["scope"] as? String == "project")
    }

    @Test func aDraftHoldsItsValuesToWhatThePageAccepts() throws {
        let wire = Wire()
        let layout = PageLayoutModel(bridge: wire.bridge)
        wire.event("pageLayoutState", state())
        var draft = try #require(layout.setup)
        draft.headerDistanceMm = 80   // further in than the 25.4 mm top margin
        draft.pageNumberStart = 250_000
        draft.widowOrphanLines = 9
        let setup = draft.setup
        #expect(setup.headerDistanceMm == 25.4)
        #expect(setup.pageNumberStart == 99_999)
        #expect(setup.widowOrphanLines == 5)
        #expect(setup.formatId == "a4")
    }

    @Test func lengthsRoundTripThroughEveryUnit() {
        for unit in LengthUnit.allCases {
            #expect(abs(unit.toMm(unit.fromMm(25.4)) - 25.4) < 1e-9)
        }
        #expect(LengthUnit.points.fromMm(25.4) == 72)
    }

    @Test func sectionsRememberBeingFolded() {
        let layout = PageLayoutModel(bridge: Wire().bridge)
        let ids = [FinishingSectionID.binding]
        layout.setExpanded(false, ids)
        #expect(layout.expansion(FinishingSectionID.binding).wrappedValue == false)
        layout.setExpanded(true, ids)
        #expect(layout.expansion(FinishingSectionID.binding).wrappedValue == true)
    }
}
