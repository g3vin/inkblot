import CoreGraphics
import Foundation
import Testing
@testable import inkblot_core

/// Note patches, and the glass hover cards' layout and open/close rules.
@MainActor
struct NotePreviewTests {
    private func note(_ id: String, parent: String? = nil, layout: (Double, Double) = (0, 0),
                      size: (Double, Double) = (260, 88)) -> Note {
        Note(id: id, type: parent == nil ? .quote : .free, content: "", anchor: "the door",
             from: 4, to: 12, color: "#ffd54f", pinned: false, parentNoteId: parent,
             collapsedChildren: false,
             previewLayout: NotePreviewLayout(offsetX: layout.0, offsetY: layout.1),
             previewSize: NotePreviewSize(width: size.0, height: size.1),
             images: [], audio: [], createdAt: "a", updatedAt: "a", timestamp: "t")
    }

    /* ---------------- patches ---------------- */

    /// It once called itself — every native note edit was a stack overflow, and the
    /// compiler was content, because the recursion is perfectly well-typed.
    @Test func aPatchNamesOnlyWhatChanged() throws {
        let patch = NotePatch.with(pinned: true, previewLayout: NotePreviewLayout(offsetX: 4, offsetY: 5))
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(patch)) as! [String: Any]
        #expect(Set(json.keys) == ["pinned", "previewLayout"])
        #expect(json["pinned"] as? Bool == true)
    }

    /* ---------------- layout ---------------- */

    @Test func theRootCardSitsRightOfItsAnchorWhenThereIsRoom() {
        let layout = NotePreviewLayoutEngine(
            root: note("n1"), notes: [note("n1")], anchor: CGRect(x: 100, y: 300, width: 8, height: 16),
            viewport: CGSize(width: 1000, height: 800), dragOffsets: [:], sizeOverrides: [:])
        let root = layout.cards[0].frame
        #expect(abs(root.minX - (108 + 22)) < 0.001)
        #expect(abs(root.minY - (300 - 88 * 0.3)) < 0.001)
    }

    @Test func andLeftOfItWhenThereIsNot() {
        let layout = NotePreviewLayoutEngine(
            root: note("n1"), notes: [note("n1")], anchor: CGRect(x: 900, y: 300, width: 8, height: 16),
            viewport: CGSize(width: 1000, height: 800), dragOffsets: [:], sizeOverrides: [:])
        #expect(layout.cards[0].frame.maxX <= 900)
    }

    @Test func aCardNeverLeavesTheViewport() {
        let layout = NotePreviewLayoutEngine(
            root: note("n1", layout: (5000, -5000)), notes: [note("n1", layout: (5000, -5000))],
            anchor: CGRect(x: 100, y: 300, width: 8, height: 16),
            viewport: CGSize(width: 1000, height: 800), dragOffsets: [:], sizeOverrides: [:])
        let frame = layout.cards[0].frame
        #expect(frame.maxX <= 1000 - 20)
        #expect(frame.minY >= 20)
    }

    @Test func repliesHangBelowTheirParentAndMoveWithIt() {
        let notes = [note("n1"), note("r1", parent: "n1"), note("r2", parent: "n1")]
        let still = NotePreviewLayoutEngine(
            root: notes[0], notes: notes, anchor: CGRect(x: 100, y: 100, width: 8, height: 16),
            viewport: CGSize(width: 1400, height: 1200), dragOffsets: [:], sizeOverrides: [:])
        let root = still.cards[0].frame
        let replies = still.cards.filter { $0.parentId == "n1" }
        #expect(replies.count == 2)
        #expect(replies.allSatisfy { $0.frame.minY == root.minY + NotePreviewLayoutEngine.childOffsetY })
        #expect(replies[0].frame.minX < replies[1].frame.minX)

        let dragged = NotePreviewLayoutEngine(
            root: notes[0], notes: notes, anchor: CGRect(x: 100, y: 100, width: 8, height: 16),
            viewport: CGSize(width: 1400, height: 1200), dragOffsets: ["n1": CGSize(width: 50, height: 0)],
            sizeOverrides: [:])
        #expect(dragged.cards[1].frame.minX == still.cards[1].frame.minX + 50)
    }

    @Test func aCollapsedBranchShowsNoReplies() {
        var root = note("n1")
        root = Note(id: root.id, type: root.type, content: "", anchor: root.anchor, from: 4, to: 12,
                    color: root.color, pinned: false, parentNoteId: nil, collapsedChildren: true,
                    previewLayout: root.previewLayout, previewSize: root.previewSize,
                    images: [], audio: [], createdAt: "a", updatedAt: "a", timestamp: "t")
        let layout = NotePreviewLayoutEngine(
            root: root, notes: [root, note("r1", parent: "n1")], anchor: .zero,
            viewport: CGSize(width: 1000, height: 800), dragOffsets: [:], sizeOverrides: [:])
        #expect(layout.cards.map(\.id) == ["n1"])
    }

    /* ---------------- open and close ---------------- */

    private func marker(_ type: String, _ id: String = "n1", top: Double = 100) -> String {
        #"{"kind":"event","message":{"seq":SEQ,"event":{"type":"\#(type)","payload":{"noteId":"\#(id)","docPath":"one","anchorLeft":10,"anchorTop":\#(top),"anchorRight":18,"anchorBottom":\#(top + 16)}}}}"#
    }

    @MainActor private final class Wire {
        let bridge = ShellBridge()
        var seq = 0
        init() { bridge.detach(); bridge.attach { _ in } }
        func send(_ json: String) {
            bridge.receive(json: json.replacingOccurrences(of: "SEQ", with: "\(seq)"))
            seq += 1
        }
    }

    @Test func hoveringOpensAndLeavingClosesAfterTheGracePeriod() async throws {
        let wire = Wire()
        let previews = NotePreviewModel(bridge: wire.bridge)
        wire.send(marker("noteMarkerHover"))
        #expect(previews.preview?.noteId == "n1")
        wire.send(marker("noteMarkerLeave"))
        #expect(previews.preview != nil)
        try await Task.sleep(for: .milliseconds(250))
        #expect(previews.preview == nil)
    }

    @Test func movingOntoACardKeepsItOpen() async throws {
        let wire = Wire()
        let previews = NotePreviewModel(bridge: wire.bridge)
        wire.send(marker("noteMarkerHover"))
        wire.send(marker("noteMarkerLeave"))
        previews.cardHovered("n1", true)
        try await Task.sleep(for: .milliseconds(250))
        #expect(previews.preview?.noteId == "n1")
    }

    @Test func aPinnedCardSurvivesLeavingAndOtherMarkersButNotADismissal() async throws {
        let wire = Wire()
        let previews = NotePreviewModel(bridge: wire.bridge)
        wire.send(marker("noteMarkerPin"))
        wire.send(marker("noteMarkerLeave"))
        wire.send(marker("noteMarkerHover", "n2"))
        try await Task.sleep(for: .milliseconds(250))
        #expect(previews.preview?.noteId == "n1")

        wire.send(marker("noteMarkerMoved", top: 40))
        #expect(previews.preview?.anchor.minY == 40)

        wire.send(#"{"kind":"event","message":{"seq":SEQ,"event":{"type":"notePreviewDismissed","payload":{"noteId":"n1"}}}}"#)
        #expect(previews.preview == nil)
    }
}
