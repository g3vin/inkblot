import AppKit
import Foundation
import Testing
@testable import inkblot_core

/// The small pieces with exact contracts: AnyCodable's fidelity, byte ranges, and the
/// Tauri accelerator syntax.
struct AnyCodableTests {
    private func roundTrip(_ json: String) throws -> String {
        let value = try JSONDecoder().decode(AnyCodable.self, from: Data(json.utf8))
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        return String(decoding: try encoder.encode(value), as: UTF8.self)
    }

    /// A TipTap document that said `1` must not come back saying `1.0` — the diff
    /// engine and the parity harness both compare numbers by their text.
    @Test func integersStayIntegers() throws {
        #expect(try roundTrip(#"{"level":1,"x":1.5}"#) == #"{"level":1,"x":1.5}"#)
    }

    @Test func everyJSONShapeSurvives() throws {
        let json = #"{"a":[true,null,"s",{"b":[]}],"c":{}}"#
        #expect(try roundTrip(json) == json)
    }

    @Test func equalityIsByValue() throws {
        let decode = { (json: String) in try JSONDecoder().decode(AnyCodable.self, from: Data(json.utf8)) }
        #expect(try decode(#"{"a":[1,2]}"#) == decode(#"{"a":[1,2]}"#))
        #expect(try decode(#"{"a":[1,2]}"#) != decode(#"{"a":[2,1]}"#))
        #expect(try decode("1") != decode("true"))
    }

    /// The generated protocol decodes through AnyCodable wherever content is untyped.
    @Test func aCommandCarryingDocumentContentRoundTrips() throws {
        let json = #"{"type":"setContent","payload":{"pane":"primary","docPath":"one","content":{"type":"doc","content":[{"type":"paragraph"}]},"isLoad":true}}"#
        let command = try JSONDecoder().decode(NativeCommand.self, from: Data(json.utf8))
        guard case .setContent(let payload) = command else { Issue.record("wrong case"); return }
        #expect(payload.docPath == "one")
        let again = try JSONDecoder().decode(NativeCommand.self, from: try JSONEncoder().encode(command))
        #expect(again == command)
    }
}

struct AppSchemeHandlerTests {
    @Test func rangesAreClampedToTheFile() {
        #expect(AppSchemeHandler.parseRange("bytes=0-99", length: 50)! == (0, 49))
        #expect(AppSchemeHandler.parseRange("bytes=10-", length: 50)! == (10, 49))
        #expect(AppSchemeHandler.parseRange("bytes=-5", length: 50)! == (45, 49))
    }

    @Test func anUnsatisfiableRangeIsIgnoredRatherThanServedWrong() {
        #expect(AppSchemeHandler.parseRange("bytes=60-70", length: 50) == nil)
        #expect(AppSchemeHandler.parseRange("bytes=9-3", length: 50) == nil)
        #expect(AppSchemeHandler.parseRange("items=0-1", length: 50) == nil)
    }

    @Test func wasmAndModulesGetTheTypesBrowsersInsistOn() {
        #expect(AppSchemeHandler.mimeType(for: URL(fileURLWithPath: "/x/ort.wasm")) == "application/wasm")
        #expect(AppSchemeHandler.mimeType(for: URL(fileURLWithPath: "/x/index.mjs")) == "text/javascript")
    }
}

@MainActor
struct WebMenusTests {
    @Test func tauriAcceleratorsBecomeKeyEquivalents() {
        let parsed = WebMenus.keyEquivalent("CmdOrCtrl+Shift+V")
        #expect(parsed?.0 == "v")
        #expect(parsed?.1 == [.command, .shift])
        #expect(WebMenus.keyEquivalent("") == nil)
        #expect(WebMenus.keyEquivalent("Shift") == nil)
    }

    @Test func onlyTheViewMenuIsMerged() {
        let menus = WebMenus()
        menus.setAppMenu([
            "rid": 1, "kind": "Menu", "items": [
                ["rid": 2, "kind": "Submenu", "text": "View", "items": [
                    ["rid": 3, "kind": "MenuItem", "text": "Switch to Dark"],
                    ["rid": 4, "kind": "Predefined", "predefined": "Separator"],
                    ["rid": 5, "kind": "Check", "text": "Show Word Count", "checked": true],
                ]],
                ["rid": 6, "kind": "Submenu", "text": "Mystery", "items": []],
            ],
        ])
        #expect(menus.viewMenuItems.map(\.rid) == [3, 4, 5])
        #expect(menus.viewMenuItems[1].isSeparator)
        #expect(menus.viewMenuItems[2].checked)
    }
}

struct GlassTabBarTests {
    /// Where a released bubble lands: the slot its centre is over, clamped to the bar.
    @Test func theBubbleLandsOnTheSlotItsCentreIsOver() {
        #expect(GlassTabBar<Int>.index(at: 10, slot: 50, count: 4) == 0)
        #expect(GlassTabBar<Int>.index(at: 149, slot: 50, count: 4) == 2)
        #expect(GlassTabBar<Int>.index(at: 999, slot: 50, count: 4) == 3)
        #expect(GlassTabBar<Int>.index(at: -20, slot: 50, count: 4) == 0)
        #expect(GlassTabBar<Int>.index(at: 10, slot: 0, count: 4) == 0)
    }
}

/// `inkblot-models` through `inkblot-ffi`. These run against the real library, so a
/// stale `inkblot_ffi.swift` (a checksum mismatch) fails here rather than at the first
/// click on a synonym tile. They only read status: the models live in the user's real
/// data folder, and nothing here downloads.
@MainActor
struct ModelServiceTests {
    @Test func theTokenizerIsBundled() {
        #expect(Bundle.main.url(forResource: "minilm-tokenizer", withExtension: "json") != nil)
    }

    @Test func statusAnswersWithTheTauriCommandsShape() async throws {
        let status = try await ModelService.shared.invoke("synonym_model_status", args: [:]) as? [String: Any]
        #expect(status?["installed"] is Bool)
        #expect(status?["missing"] is [Any])
        let kokoro = try await ModelService.shared.invoke("kokoro_model_status", args: ["voice": "af_heart"]) as? [String: Any]
        #expect(kokoro?["installed"] is Bool)
    }

    @Test func aVoiceThatIsAPathIsRefused() async {
        await #expect(throws: (any Error).self) {
            try await ModelService.shared.invoke("kokoro_model_status", args: ["voice": "../../etc"])
        }
    }

    @Test func theScrapeChannelRoundTrips() async throws {
        let id = UUID().uuidString
        _ = try await ModelService.shared.invoke("pinterest_begin_scrape", args: ["requestId": id])
        _ = try await ModelService.shared.invoke("pinterest_report_scrape", args: [
            "report": ["requestId": id, "url": "https://pinterest.com/b", "pins": [], "reason": "stable", "stage": "", "progress": false],
        ])
        let report = try await ModelService.shared.invoke("pinterest_await_scrape", args: ["requestId": id, "timeoutMs": 500]) as? [String: Any]
        #expect(report?["reason"] as? String == "stable")
    }
}

/// The tab dock's per-tab decisions, which `TabDock.jsx` made per dot.
@MainActor
struct WorkspaceModelTests {
    @Test func aDocumentTabShowsWhereItIs() throws {
        let event = #"{"type":"tabsChanged","payload":{"tabs":[{"id":"1","docPath":"ch/one"},{"id":"2","docPath":"board.canvas"},{"id":"3"}],"activeTabId":"1","currentDoc":"ch/one","secondaryDoc":"board.canvas","split":true}}"#
        let decoded = try JSONDecoder().decode(WebviewEvent.self, from: Data(event.utf8))
        guard case .tabsChanged(let changed) = decoded else { Issue.record("wrong case"); return }
        let one = WorkspaceModel.presentation(of: changed.tabs[0], in: changed)
        #expect(one.isActive && one.isOpen && !one.inSecondary && one.label == "one")
        let board = WorkspaceModel.presentation(of: changed.tabs[1], in: changed)
        #expect(board.inSecondary && board.isOpen && !board.isActive && board.label == "board")
        let draft = WorkspaceModel.presentation(of: changed.tabs[2], in: changed)
        #expect(draft.isDraft && !draft.isOpen && draft.label == "New Tab")
    }

    @Test func aDisplayNameDropsTheFolderAndTheCanvasSuffix() {
        #expect(WorkspaceModel.displayName("Act 1/Scene.canvas") == "Scene")
        #expect(WorkspaceModel.displayName("notes") == "notes")
    }
}
