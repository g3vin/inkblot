import CoreGraphics
import Foundation
import Observation

/// Which note's hover cards are showing, and where their anchor is.
///
/// The page reports its note markers (`useNativeNotePreviews`); this turns those reports
/// into the same behaviour `NoteHoverPreview` had:
///
///  - hovering a marker opens its cards; leaving the marker closes them after a short
///    grace period, unless the pointer has moved onto a card in the meantime
///  - clicking a marker pins the cards open; a click anywhere else in the page (or
///    Escape, or the close button) closes them
///  - while open, the cards follow the marker as the document scrolls
@MainActor
@Observable
final class NotePreviewModel {
    struct Preview: Equatable {
        var noteId: String
        var docPath: String
        var anchor: CGRect
        /// The note as the marker knew it — used only until the page's live list has it.
        var fallbackNote: Note?
        var pinned: Bool
    }

    private(set) var preview: Preview?

    /// Drag and resize in flight, by note id — committed to the note when the gesture ends.
    var dragOffsets: [String: CGSize] = [:]
    var sizeOverrides: [String: CGSize] = [:]

    @ObservationIgnored private var hideTask: Task<Void, Never>?
    @ObservationIgnored private var hoveredCards: Set<String> = []

    /// `HIDE_DELAY_MS` in notePreviewGeometry.ts.
    static let hideDelay: Duration = .milliseconds(110)

    init(bridge: ShellBridge) {
        bridge.addListener { [weak self] event in self?.handle(event) }
    }

    private func handle(_ event: WebviewEvent) {
        switch event {
        case .noteMarkerHover(let marker):
            cancelHide()
            // Hovering another marker does not steal a pinned card.
            if let preview, preview.pinned, preview.noteId != marker.noteId { return }
            if preview?.noteId == marker.noteId {
                preview?.anchor = marker.rect
            } else {
                show(marker, pinned: false)
            }
        case .noteMarkerLeave(let marker) where marker.noteId == preview?.noteId:
            scheduleHide()
        case .noteMarkerPin(let marker):
            cancelHide()
            if preview?.noteId == marker.noteId {
                preview?.pinned = true
                preview?.anchor = marker.rect
            } else {
                show(marker, pinned: true)
            }
        case .noteMarkerMoved(let marker) where marker.noteId == preview?.noteId:
            preview?.anchor = marker.rect
        case .notePreviewDismissed(let dismissed) where dismissed.noteId == preview?.noteId:
            close()
        case .projectChanged, .activeEditorChanged:
            // A different document is showing; its markers are not this one's.
            if let preview, !preview.pinned { close() }
        default:
            break
        }
    }

    private func show(_ marker: NoteMarkerEvent, pinned: Bool) {
        dragOffsets = [:]
        sizeOverrides = [:]
        hoveredCards = []
        preview = Preview(noteId: marker.noteId, docPath: marker.docPath, anchor: marker.rect,
                          fallbackNote: marker.note, pinned: pinned)
    }

    /* ---------------- the cards' side ---------------- */

    func cardHovered(_ noteId: String, _ hovering: Bool) {
        if hovering {
            hoveredCards.insert(noteId)
            cancelHide()
        } else {
            hoveredCards.remove(noteId)
            if hoveredCards.isEmpty { scheduleHide() }
        }
    }

    /// Working in a card — typing, dragging — pins it, as it did in the page: a card that
    /// vanished because the pointer drifted off it mid-sentence would lose the sentence.
    func pin() {
        cancelHide()
        preview?.pinned = true
    }

    func close() {
        cancelHide()
        preview = nil
        hoveredCards = []
        dragOffsets = [:]
        sizeOverrides = [:]
    }

    private func scheduleHide() {
        cancelHide()
        hideTask = Task { [weak self] in
            try? await Task.sleep(for: Self.hideDelay)
            guard let self, !Task.isCancelled else { return }
            if preview?.pinned == false, hoveredCards.isEmpty { preview = nil }
        }
    }

    private func cancelHide() {
        hideTask?.cancel()
        hideTask = nil
    }
}

extension NoteMarkerEvent {
    /// Page coordinates, which are the web view's own at page zoom 1.
    var rect: CGRect {
        CGRect(x: anchorLeft, y: anchorTop, width: anchorRight - anchorLeft, height: anchorBottom - anchorTop)
    }
}
