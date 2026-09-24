import AppKit
import CoreGraphics
import Foundation
import Observation
import SwiftUI

/// Which note's hover cards are showing, and where their anchor is.
///
/// The page reports its note markers (`useNativeNotePreviews`); this turns those reports
/// into the same behaviour `NoteHoverPreview` had:
///
///  - hovering a marker opens its cards. Leaving the marker watches where the pointer
///    goes: heading for the card keeps them open (it is on its way), heading anywhere
///    else closes them, and so does stopping short of the card for a moment
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

    private(set) var preview: Preview? {
        didSet {
            if preview == nil { stopWatchingIntent() }
            // The page highlights the text the open note is about; the cards do not quote it.
            if oldValue?.noteId != preview?.noteId {
                bridge.send(.highlightNote(HighlightNoteCommand(noteId: preview?.noteId)))
                // Another note's cards, or none: whatever shows next comes in afresh.
                appearances = [:]
                settleTask?.cancel()
                appearanceSettled = true
            }
        }
    }

    /// Every note marker the page can see. The shell draws their dots, as glass.
    private(set) var markers: [NoteMarkerRect] = []

    /// Drag and resize in flight, by note id — committed to the note when the gesture ends.
    var dragOffsets: [String: CGSize] = [:]
    var sizeOverrides: [String: CGSize] = [:]
    /// A reply asked for from a card's + button, until its card arrives: that card grows
    /// out of the button instead of fading in.
    struct Spawn: Equatable {
        var parentId: String
        /// The + button's centre, in the overlay's coordinates.
        var origin: CGPoint
    }
    var pendingSpawn: Spawn?
    /// Cards whose + is out, sliding down as a new reply: their own + is hidden until it
    /// has gone, so the button reads as the thing that left.
    var budding: Set<String> = []

    /// Each card's height as drawn — taller than its layout height when its text is — so
    /// a reply is placed below the whole of its parent.
    var renderedHeights: [String: CGFloat] = [:]

    /// Where a dragged card's replies are drawn while they catch up with it: they trail
    /// it on a spring (`NoteHoverPreview`'s elastic follow), and settle where the layout
    /// puts them after it is dropped. A card with no entry is drawn where it is laid out.
    private(set) var elasticOrigins: [String: CGPoint] = [:]
    @ObservationIgnored private var elasticVelocities: [String: CGVector] = [:]
    @ObservationIgnored private var elasticIds: Set<String> = []
    @ObservationIgnored private var elasticDragging = false
    @ObservationIgnored private var elasticTask: Task<Void, Never>?
    /// The overlay's last layout: where each card belongs, and whose reply it is.
    @ObservationIgnored private var cardTargets: [String: CGPoint] = [:]
    @ObservationIgnored private var cardParents: [String: String] = [:]

    /// How far each sidebar reaches over the page (`ContentView`): no card goes under one.
    var panelInsets = EdgeInsets()

    /// Where a dropped card was committed to, until the page's echo of the note says the
    /// same — without it the card is drawn at its old place for the frames in between.
    var layoutOverrides: [String: NotePreviewLayout] = [:]

    /// When each card began to come in, by note id. A card slides in from the right as
    /// its string draws out to it from its parent (or the marker's dot), the two ending
    /// together; replies wait for their parent. A card with no entry has not begun.
    private(set) var appearances: [String: Date] = [:]
    /// No card is still coming in, so nothing needs drawing frame by frame.
    private(set) var appearanceSettled = true

    nonisolated static let appearDuration: TimeInterval = 0.32
    /// How long each generation of replies waits after its parent begins: long enough
    /// that the parent has all but landed.
    nonisolated static let appearStagger: TimeInterval = 0.26
    /// How far right of its place a card starts.
    nonisolated static let appearSlide: CGFloat = 28

    @ObservationIgnored private var settleTask: Task<Void, Never>?
    @ObservationIgnored private let bridge: ShellBridge
    @ObservationIgnored private var hideTask: Task<Void, Never>?
    @ObservationIgnored private var hoveredCards: Set<String> = []

    /// The view the page's coordinates are in — the web view — for reading the pointer.
    @ObservationIgnored weak var pointerSpace: NSView?
    /// Where the root card is, as the overlay last laid it out: what the pointer is
    /// heading for, or not.
    @ObservationIgnored var rootCardFrame: CGRect?
    @ObservationIgnored private var intentMonitor: Any?
    @ObservationIgnored private var lastDistance: CGFloat?

    /// `HIDE_DELAY_MS` in notePreviewGeometry.ts.
    nonisolated static let hideDelay: Duration = .milliseconds(110)
    /// How long a pointer heading for the card may pause before the card gives up on it.
    nonisolated static let intentGrace: Duration = .milliseconds(350)

    init(bridge: ShellBridge) {
        self.bridge = bridge
        bridge.addListener { [weak self] event in self?.handle(event) }
    }

    private func handle(_ event: WebviewEvent) {
        switch event {
        case .noteMarkerHover(let marker):
            cancelHide()
            // Hovering another marker does not steal a pinned card.
            if let preview, preview.pinned, preview.noteId != marker.noteId { return }
            stopWatchingIntent()
            if preview?.noteId == marker.noteId {
                preview?.anchor = marker.rect
            } else {
                show(marker, pinned: false)
            }
        case .noteMarkerLeave(let marker) where marker.noteId == preview?.noteId:
            watchIntent()
        case .noteMarkerPin(let marker):
            cancelHide()
            stopWatchingIntent()
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
        case .noteMarkersChanged(let changed):
            markers = changed.markers
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
        layoutOverrides = [:]
        renderedHeights = [:]
        resetElastic()
        pendingSpawn = nil
        budding = []
        hoveredCards = []
        preview = Preview(noteId: marker.noteId, docPath: marker.docPath, anchor: marker.rect,
                          fallbackNote: marker.note, pinned: pinned)
    }

    /* ---------------- the cards' side ---------------- */

    func cardHovered(_ noteId: String, _ hovering: Bool) {
        if hovering {
            hoveredCards.insert(noteId)
            cancelHide()
            stopWatchingIntent()
        } else {
            hoveredCards.remove(noteId)
            if hoveredCards.isEmpty { scheduleHide() }
        }
    }

    /// The cards now laid out: those new since the last layout begin to come in, each
    /// generation after the one above it. A reply grown from a + has its own entrance
    /// (`GlassNoteCard`), so it is simply there.
    func stageAppearance(of cards: [NotePreviewLayoutEngine.Card]) {
        let ids = Set(cards.map(\.id))
        // Gone — folded away, say — so that it comes in again when it is back.
        appearances = appearances.filter { ids.contains($0.key) }
        let new = cards.filter { appearances[$0.id] == nil }
        guard let top = new.map(\.depth).min() else { return }

        let now = Date.now
        var end = now
        for card in new {
            if let spawn = pendingSpawn, spawn.parentId == card.parentId {
                appearances[card.id] = .distantPast
                continue
            }
            let start = now.addingTimeInterval(Double(card.depth - top) * Self.appearStagger)
            appearances[card.id] = start
            end = max(end, start.addingTimeInterval(Self.appearDuration))
        }
        guard end > now else { return }
        appearanceSettled = false
        settleTask?.cancel()
        settleTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(end.timeIntervalSince(now)))
            guard let self, !Task.isCancelled else { return }
            appearanceSettled = true
        }
    }

    /// The overlay's layout, each time it changes: where the replies are pulled toward.
    func cardsLaidOut(_ cards: [NotePreviewLayoutEngine.Card]) {
        cardTargets = Dictionary(uniqueKeysWithValues: cards.map { ($0.id, $0.frame.origin) })
        cardParents = Dictionary(uniqueKeysWithValues: cards.compactMap { card in card.parentId.map { (card.id, $0) } })
    }

    /// A card has begun to be dragged: its replies, and theirs, start to trail it.
    func beginDrag(of id: String) {
        var descendants = Set<String>()
        var frontier = [id]
        while let next = frontier.popLast() {
            for (child, parent) in cardParents where parent == next && descendants.insert(child).inserted {
                frontier.append(child)
            }
        }
        elasticDragging = true
        elasticIds.formUnion(descendants)
        // From where they are now, before the drag has moved their targets.
        for id in descendants where elasticOrigins[id] == nil { elasticOrigins[id] = cardTargets[id] }
        guard elasticTask == nil, !elasticIds.isEmpty else { return }
        elasticTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(16))
                guard let self, self.stepElastic() else { break }
            }
            self?.elasticTask = nil
        }
    }

    /// Dropped: the replies carry on until they have caught up.
    func endDrag() {
        elasticDragging = false
    }

    /// One frame of the spring; false once the drag is over and every reply has landed.
    private func stepElastic() -> Bool {
        var origins = elasticOrigins
        var moving = false
        for id in elasticIds {
            guard let target = cardTargets[id] else {
                origins[id] = nil
                elasticVelocities[id] = nil
                continue
            }
            let current = origins[id] ?? target
            var velocity = elasticVelocities[id] ?? .zero
            velocity.dx = (velocity.dx + (target.x - current.x) * 0.12) * 0.72
            velocity.dy = (velocity.dy + (target.y - current.y) * 0.12) * 0.72
            let next = CGPoint(x: current.x + velocity.dx, y: current.y + velocity.dy)
            if abs(target.x - next.x) > 0.35 || abs(target.y - next.y) > 0.35
                || abs(velocity.dx) > 0.12 || abs(velocity.dy) > 0.12 {
                moving = true
                origins[id] = next
                elasticVelocities[id] = velocity
            } else {
                origins[id] = target
                elasticVelocities[id] = .zero
            }
        }
        guard elasticDragging || moving else {
            resetElastic()
            return false
        }
        elasticOrigins = origins
        return true
    }

    private func resetElastic() {
        elasticDragging = false
        elasticIds = []
        elasticVelocities = [:]
        if !elasticOrigins.isEmpty { elasticOrigins = [:] }
    }

    /// How far in a card is at `now`, from 0 to 1, eased out.
    func appearance(of id: String, at now: Date) -> CGFloat {
        guard let start = appearances[id] else { return 0 }
        if appearanceSettled { return 1 }
        let t = min(max(now.timeIntervalSince(start) / Self.appearDuration, 0), 1)
        return 1 - pow(1 - t, 3)
    }

    /// Working in a card — typing, dragging — pins it, as it did in the page: a card that
    /// vanished because the pointer drifted off it mid-sentence would lose the sentence.
    func pin() {
        cancelHide()
        stopWatchingIntent()
        preview?.pinned = true
    }

    func close() {
        cancelHide()
        preview = nil
        hoveredCards = []
        dragOffsets = [:]
        sizeOverrides = [:]
        layoutOverrides = [:]
        renderedHeights = [:]
        resetElastic()
        pendingSpawn = nil
        budding = []
    }

    private func scheduleHide(after delay: Duration = hideDelay) {
        cancelHide()
        hideTask = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard let self, !Task.isCancelled else { return }
            hideIfIdle()
        }
    }

    private func hideIfIdle() {
        if preview?.pinned == false, hoveredCards.isEmpty { preview = nil }
    }

    /* ---------------- where the pointer is heading ---------------- */

    /// The pointer left the marker without clicking. Follow it: each move that closes on
    /// the card buys it another `intentGrace`; a move that opens the gap closes the card.
    private func watchIntent() {
        stopWatchingIntent()
        guard let preview, !preview.pinned, hoveredCards.isEmpty else { return }
        guard pointerSpace != nil, rootCardFrame != nil else { return scheduleHide() }
        scheduleHide(after: Self.intentGrace)
        intentMonitor = NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved]) { [weak self] event in
            MainActor.assumeIsolated { self?.pointerMoved(event) }
            return event
        }
    }

    private func pointerMoved(_ event: NSEvent) {
        guard let view = pointerSpace, event.window === view.window, let card = rootCardFrame else { return }
        let local = view.convert(event.locationInWindow, from: nil)
        let point = CGPoint(x: local.x, y: view.isFlipped ? local.y : view.bounds.height - local.y)
        let distance = Self.distance(from: point, to: card)
        defer { lastDistance = distance }
        guard let last = lastDistance else { return }
        switch Self.heading(from: last, to: distance) {
        case .toward: scheduleHide(after: Self.intentGrace)
        case .away:
            cancelHide()
            hideIfIdle()
        case .unclear: break
        }
    }

    private func stopWatchingIntent() {
        if let intentMonitor { NSEvent.removeMonitor(intentMonitor) }
        intentMonitor = nil
        lastDistance = nil
    }

    nonisolated enum Heading { case toward, away, unclear }

    /// Judged on the gap to the card, so a curving path that still closes on it counts as
    /// heading there. A point of slack either way, for the jitter in a steady hand.
    nonisolated static func heading(from last: CGFloat, to distance: CGFloat) -> Heading {
        if distance < last - 0.5 { return .toward }
        if distance > last + 1 { return .away }
        return .unclear
    }

    nonisolated static func distance(from point: CGPoint, to rect: CGRect) -> CGFloat {
        let dx = max(rect.minX - point.x, 0, point.x - rect.maxX)
        let dy = max(rect.minY - point.y, 0, point.y - rect.maxY)
        return hypot(dx, dy)
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
