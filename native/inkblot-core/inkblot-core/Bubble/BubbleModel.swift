import AppKit
import SwiftUI
import QuartzCore
import CoreGraphics
import Observation

/// The bubble editor's state: which session is open and how it is arranged.
///
/// The page decides when a session opens (`bubbleSessionOpened` — from its context menu,
/// or the chip on a sentence with a session left open) and writes the sentence back when
/// this sends `closeBubbleSession`. In between, everything is here: the page holds only
/// where the sentence is.
///
/// Every change is an undo step on the window's `UndoManager`, so Edit ▸ Undo and ⌘Z
/// work while the editor is up; they are cleared when it closes, or the document's next
/// ⌘Z would reach back into a session that is gone.
@MainActor
@Observable
final class BubbleModel {
    struct Open: Equatable {
        var id: String
        var docPath: String
        var original: String
    }

    /// A bubble being typed into. A draft is a new word, not yet in the sentence.
    struct Editing: Equatable {
        var id: String
        var text: String
        var draft: Bool
        /// Where a draft goes in the sentence.
        var index: Int
    }

    struct Drag: Equatable {
        var id: String
        var translation: CGSize
        var target: BubbleDrop.Target?
    }

    private(set) var open: Open?
    private(set) var arrangement = BubbleDrop.Arrangement(words: [], aside: [])
    private(set) var mode: BubbleMode = .words
    /// The saved forms (`BubbleForms`), and the unsaved arrangement kept while one shows.
    private(set) var forms: [BubbleForm] = []
    private(set) var unsaved: BubbleForms.Page?
    /// How far the bubbles are following a sideways swipe toward another form, and which
    /// way a release would turn (-1, +1), or 0 while it would not yet.
    private(set) var swipeOffset: CGFloat = 0
    private(set) var swipeStep = 0
    var selectedId: String?
    var editing: Editing?
    private(set) var drag: Drag?
    /// The bubble a drop would join the dragged one to, and whether a drop would trash it.
    /// Kept apart from `drag`, which changes every frame without animation, so that these
    /// — which grow, shrink and tint the bubbles — can change with a spring.
    private(set) var joinTargetId: String?
    private(set) var trashArmed = false
    /// Every open session's chip the page can see. The shell draws them, as glass.
    private(set) var chips: [BubbleChipRect] = []

    /// Where every bubble is, in the editor's coordinates, as last laid out. Read when a
    /// drag starts; not observed, since drawing does not depend on it.
    @ObservationIgnored var frames: [String: CGRect] = [:]
    @ObservationIgnored var rowFrame: CGRect = .zero
    @ObservationIgnored var trashFrame: CGRect = .zero
    @ObservationIgnored var stage: CGSize = .zero
    @ObservationIgnored weak var undoManager: UndoManager?

    @ObservationIgnored private let bridge: ShellBridge
    /// Pointer moves arrive faster than the screen draws, and glass may be updated only
    /// once a frame: the latest move waits here for the next frame.
    @ObservationIgnored private var pendingDrag: Drag?
    @ObservationIgnored private lazy var frameTicker = FrameTicker { [weak self] in self?.applyPendingDrag() }
    /// The same for a swipe's scroll events.
    @ObservationIgnored private var pendingSwipeOffset: CGFloat?
    @ObservationIgnored private lazy var swipeTicker = FrameTicker { [weak self] in self?.applyPendingSwipe() }
    /// The dragged bubble's frame when the drag began, and where it sat in the sentence
    /// (nil for a set-aside bubble).
    @ObservationIgnored private var dragOrigin: (frame: CGRect, rowIndex: Int?)?
    /// The frames when the drag began, without the dragged bubble's.
    @ObservationIgnored private var dragFrames: (row: [(id: String, frame: CGRect)], aside: [(id: String, frame: CGRect)])?

    init(bridge: ShellBridge) {
        self.bridge = bridge
        bridge.addListener { [weak self] event in
            switch event {
            case .bubbleSessionOpened(let opened): self?.show(opened)
            case .bubbleChipsChanged(let changed): self?.chips = changed.chips
            default: break
            }
        }
    }

    var sentence: String { BubbleText.compose(arrangement.words, original: open?.original ?? "") }

    private func show(_ opened: BubbleSessionOpened) {
        let session = opened.session
        open = Open(id: session.id, docPath: opened.docPath, original: session.original)
        arrangement = BubbleDrop.Arrangement(words: session.words, aside: session.aside ?? [])
        mode = session.mode ?? .words
        forms = session.forms ?? []
        unsaved = session.unsaved.map {
            BubbleForms.Page(arrangement: BubbleDrop.Arrangement(words: $0.words, aside: $0.aside ?? []), mode: $0.mode ?? .words)
        }
        swipeOffset = 0
        swipeStep = 0
        selectedId = nil
        editing = nil
        drag = nil
        frames = [:]
    }

    /// Leave, writing the sentence back. `archive` takes the session off it and puts it in
    /// the document's archive (History ▸ Archive), from where it can be restored.
    func close(archive: Bool) {
        guard let open else { return }
        commitEditing()
        pendingDrag = nil
        let session = BubbleSession(id: open.id, words: arrangement.words, aside: arrangement.aside,
                                    original: open.original, mode: mode, forms: forms,
                                    unsaved: unsaved.map { BubbleForm(id: "unsaved", words: $0.arrangement.words,
                                                                      aside: $0.arrangement.aside,
                                                                      mode: $0.mode == .words ? nil : $0.mode) })
        bridge.send(.closeBubbleSession(CloseBubbleSessionCommand(session: session, archive: archive)))
        undoManager?.removeAllActions(withTarget: self)
        self.open = nil
        selectedId = nil
        editing = nil
        drag = nil
    }

    /* ---------------- changes, each one undoable ---------------- */

    private var formsState: BubbleForms.State {
        BubbleForms.State(page: BubbleForms.Page(arrangement: arrangement, mode: mode), forms: forms, unsaved: unsaved)
    }

    /// An edit to the bubbles. If a form was showing, the bubbles are unsaved now.
    private func commit(_ next: BubbleDrop.Arrangement, mode nextMode: BubbleMode? = nil) {
        var state = formsState
        state.page.arrangement = next
        if let nextMode { state.page.mode = nextMode }
        apply(BubbleForms.settle(state))
    }

    private func apply(_ next: BubbleForms.State, named name: String = "Bubble") {
        let previous = formsState
        guard next != previous else { return }
        arrangement = next.page.arrangement
        mode = next.page.mode
        forms = next.forms
        unsaved = next.unsaved
        undoManager?.registerUndo(withTarget: self) { model in
            MainActor.assumeIsolated { model.apply(previous, named: name) }
        }
        undoManager?.setActionName(name)
    }

    func regroup(_ nextMode: BubbleMode) {
        selectedId = nil
        editing = nil
        let words = BubbleText.regroup(arrangement.words, nextMode)
        commit(BubbleDrop.Arrangement(words: words, aside: arrangement.aside), mode: nextMode)
    }

    /// A bubble split — into words, unless `parts` says otherwise — in place. A set-aside
    /// one stays aside, its parts stacked where it was.
    func split(_ id: String, by parts: @MainActor (String) -> [String] = BubbleText.tokenize) {
        var next = arrangement
        next.words = next.words.flatMap { word -> [BubbleWord] in
            guard word.id == id else { return [word] }
            let pieces = parts(word.text)
            return pieces.count <= 1 ? [word] : BubbleText.words(pieces, keeping: word.id)
        }
        next.aside = next.aside.flatMap { word -> [BubbleAside] in
            guard word.id == id else { return [word] }
            let pieces = parts(word.text)
            guard pieces.count > 1 else { return [word] }
            return pieces.enumerated().map { index, text in
                let offset = (Double(index) - Double(pieces.count - 1) / 2) * 0.07
                return BubbleAside(id: index == 0 ? word.id : BubbleText.newId(), text: text,
                                  x: word.x, y: min(1, max(0, word.y + offset)))
            }
        }
        selectedId = nil
        commit(next)
    }

    /// A pinch on the trackpad at `point`. In, over the gap between two bubbles of the
    /// sentence, merges them; out, over a bubble of several words, splits it one level
    /// finer. Returns whether it did anything, so one pinch makes one change.
    func pinch(spreading: Bool, at point: CGPoint) -> Bool {
        if spreading {
            let ids = arrangement.words.map(\.id) + arrangement.aside.map(\.id)
            guard let id = ids.first(where: { frames[$0]?.contains(point) == true }),
                  let text = arrangement.text(of: id), BubbleText.splitOnce(text).count > 1 else { return false }
            split(id, by: BubbleText.splitOnce)
            return true
        }
        let row = arrangement.words.compactMap { word in frames[word.id].map { (id: word.id, frame: $0) } }
        guard row.count == arrangement.words.count, let gap = BubbleDrop.gapAt(row, point) else { return false }
        selectedId = nil
        commit(BubbleDrop.Arrangement(words: BubbleText.mergeAdjacent(arrangement.words, at: gap),
                                      aside: arrangement.aside))
        return true
    }

    func remove(_ id: String) {
        selectedId = nil
        commit(arrangement.without(id))
    }

    /// The action bar's "Set aside": against the left edge, below the ones already there.
    func setAside(_ id: String) {
        let size = frames[id]?.size ?? CGSize(width: 80, height: 40)
        let slot = CGFloat(arrangement.aside.count % 6)
        let point = CGPoint(x: 0, y: stage.height * (0.22 + slot * 0.11))
        let rest = BubbleDrop.asidePoint(stage: stage, point: point, size: size)
        land(.aside(x: rest.x, y: rest.y), dragging: id)
    }

    func returnToSentence(_ id: String) {
        land(.insert(index: arrangement.words.count, caret: .zero), dragging: id)
    }

    func moveSelected(by delta: Int) {
        guard let selectedId, let index = arrangement.words.firstIndex(where: { $0.id == selectedId }) else { return }
        let target = min(max(0, index + delta), arrangement.words.count - 1)
        guard target != index else { return }
        var next = arrangement
        next.words.insert(next.words.remove(at: index), at: target)
        commit(next)
    }

    private func land(_ target: BubbleDrop.Target, dragging id: String) {
        selectedId = nil
        commit(BubbleDrop.apply(target, dragging: id, to: arrangement))
    }

    /* ---------------- forms ---------------- */

    /// The form showing, or nil while the bubbles are unsaved.
    var currentForm: Int? { BubbleForms.current(formsState) }
    var formPages: Int { BubbleForms.pages(formsState) }
    var formPage: Int { BubbleForms.page(formsState) }

    func saveForm() {
        commitEditing()
        apply(BubbleForms.save(formsState, id: BubbleText.newId("form")), named: "Save Form")
    }

    /// Show a page: a form, or (at `forms.count`) the unsaved arrangement.
    func showForm(page: Int) {
        guard page != formPage else { return }
        commitEditing()
        selectedId = nil
        apply(BubbleForms.show(formsState, page: page), named: "Show Form")
    }

    func deleteForm(at index: Int) {
        apply(BubbleForms.delete(formsState, at: index), named: "Delete Form")
    }

    /// How far two fingers must travel sideways to turn to the next form.
    static let swipeDistance: CGFloat = 140

    /// A sideways two-finger swipe, `travel` points so far (negative is leftward, toward
    /// the next form). The bubbles follow the fingers, resisting more the further they
    /// go, and much more where there is no form that way.
    func swipeChanged(travel: CGFloat) {
        guard !forms.isEmpty, drag == nil, editing == nil else { return }
        let step = travel < 0 ? 1 : -1
        let possible = (0..<formPages).contains(formPage + step)
        let reach: CGFloat = possible ? 220 : 40
        pendingSwipeOffset = (travel < 0 ? -1 : 1) * reach * (1 - exp(-abs(travel) / reach))
        let armed = possible && abs(travel) >= Self.swipeDistance ? step : 0
        if armed != swipeStep {
            // Felt as well as seen: crossing the line that makes the swipe count.
            if armed != 0 { NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .now) }
            withAnimation(.spring(duration: 0.24)) { swipeStep = armed }
        }
        swipeTicker.request()
    }

    private func applyPendingSwipe() {
        guard let pendingSwipeOffset else { return }
        self.pendingSwipeOffset = nil
        swipeOffset = pendingSwipeOffset
    }

    /// The fingers lifted: turn the page if the swipe went far enough, or was a flick that
    /// way (`flick`, ±1), and either way the bubbles come back to the middle.
    func swipeEnded(flick: Int = 0) {
        let step = swipeStep != 0 ? swipeStep
            : flick != 0 && (0..<formPages).contains(formPage + flick) && !forms.isEmpty ? flick : 0
        pendingSwipeOffset = nil
        withAnimation(step != 0 ? .bubbleRegrouping : .spring(duration: 0.3, bounce: 0.2)) {
            if step != 0 { showForm(page: formPage + step) }
            swipeOffset = 0
            swipeStep = 0
        }
    }

    /// The swipe stopped without the fingers lifting (the system took it): no page turns.
    func swipeCancelled() {
        pendingSwipeOffset = nil
        withAnimation(.spring(duration: 0.3, bounce: 0.2)) {
            swipeOffset = 0
            swipeStep = 0
        }
    }

    /* ---------------- typing ---------------- */

    func startDraft(_ text: String) {
        let after = arrangement.words.firstIndex { $0.id == selectedId }.map { $0 + 1 }
        editing = Editing(id: BubbleText.newId(), text: text, draft: true, index: after ?? arrangement.words.count)
        selectedId = nil
    }

    func edit(_ id: String) {
        guard let text = arrangement.text(of: id) else { return }
        selectedId = nil
        editing = Editing(id: id, text: text, draft: false, index: 0)
    }

    /// Commit what is being typed. Returns where the next draft goes, after it.
    @discardableResult
    func commitEditing() -> Int? {
        guard let current = editing else { return nil }
        editing = nil
        let text = current.text.trimmingCharacters(in: .whitespaces)
        if current.draft {
            let parts = BubbleText.tokenize(text)
            guard !parts.isEmpty, arrangement.text(of: current.id) == nil else { return current.index }
            var next = arrangement
            let at = min(current.index, next.words.count)
            next.words.insert(contentsOf: parts.enumerated().map { index, part in
                BubbleWord(id: index == 0 ? current.id : BubbleText.newId(), text: part)
            }, at: at)
            commit(next)
            return at + parts.count
        }
        if text.isEmpty {
            commit(arrangement.without(current.id))
        } else if arrangement.text(of: current.id) != text {
            var next = arrangement
            next.words = next.words.map { $0.id == current.id ? BubbleWord(id: $0.id, text: text) : $0 }
            next.aside = next.aside.map {
                $0.id == current.id ? BubbleAside(id: $0.id, text: text, x: $0.x, y: $0.y) : $0
            }
            commit(next)
        }
        return nil
    }

    /// Space in a new word: that word is done, and the next one starts.
    func nextDraft() {
        guard let current = editing, current.draft,
              !current.text.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        let index = commitEditing() ?? arrangement.words.count
        editing = Editing(id: BubbleText.newId(), text: "", draft: true, index: index)
    }

    /* ---------------- dragging ---------------- */

    func dragChanged(_ id: String, location: CGPoint, translation: CGSize) {
        if drag?.id != id {
            guard editing == nil else { return }
            selectedId = nil
            let others = { (ids: [String]) in ids.filter { $0 != id }.compactMap { other in
                self.frames[other].map { (id: other, frame: $0) }
            } }
            dragFrames = (others(arrangement.words.map(\.id)), others(arrangement.aside.map(\.id)))
            dragOrigin = (frames[id] ?? .zero, arrangement.words.firstIndex { $0.id == id })
        }
        let next = Drag(id: id, translation: translation, target: target(at: location, translation: translation))
        if drag?.id != id {
            setDrag(next)
        } else {
            pendingDrag = next
            frameTicker.request()
        }
    }

    private func applyPendingDrag() {
        guard let pendingDrag, drag?.id == pendingDrag.id else { return }
        self.pendingDrag = nil
        if drag != pendingDrag { setDrag(pendingDrag) }
    }

    private func setDrag(_ next: Drag?) {
        let joinId: String? = { if case .join(let id, _)? = next?.target { return id } else { return nil } }()
        let armed = next?.target == .trash
        if joinId != joinTargetId || armed != trashArmed {
            withAnimation(.spring(duration: 0.26, bounce: 0.25)) {
                joinTargetId = joinId
                trashArmed = armed
            }
        }
        drag = next
    }

    func dragEnded(_ id: String, location: CGPoint, predicted: CGPoint, translation: CGSize) {
        guard drag?.id == id else { return }
        // Nil is the slot it came from: nothing changes, unless it was thrown.
        var target = target(at: location, translation: translation)
        // A throw: released moving fast, and heading for an edge. It lands where it was going.
        switch target {
        case .trash?, .join?: break
        default:
            let landing = CGPoint(x: min(max(predicted.x, 0), stage.width), y: min(max(predicted.y, 0), stage.height))
            if hypot(landing.x - location.x, landing.y - location.y) > 120, BubbleDrop.nearEdge(stage, landing) {
                let rest = BubbleDrop.asidePoint(stage: stage, point: landing, size: frames[id]?.size ?? .zero)
                target = .aside(x: rest.x, y: rest.y)
            }
        }
        pendingDrag = nil
        setDrag(nil)
        dragFrames = nil
        dragOrigin = nil
        if let target { land(target, dragging: id) }
    }

    func dragCancelled() {
        pendingDrag = nil
        setDrag(nil)
        dragFrames = nil
        dragOrigin = nil
    }

    /// What a drop here would do. Nil is the slot it came from, where nothing changes and
    /// no insertion bar is drawn.
    private func target(at point: CGPoint, translation: CGSize) -> BubbleDrop.Target? {
        guard let dragFrames, let dragOrigin else { return nil }
        if trashFrame.insetBy(dx: -18, dy: -18).contains(point) { return .trash }
        let rect = dragOrigin.frame.offsetBy(dx: translation.width, dy: translation.height)
        if let join = BubbleDrop.touchTarget(rect, dragFrames.row + dragFrames.aside) { return join }
        if BubbleDrop.nearEdge(stage, point) {
            let rest = BubbleDrop.asidePoint(stage: stage, point: point, size: dragOrigin.frame.size)
            return .aside(x: rest.x, y: rest.y)
        }
        let slot = BubbleDrop.insertion(row: dragFrames.row, rowFrame: rowFrame, at: point)
        if case .insert(let index, _) = slot, index == dragOrigin.rowIndex { return nil }
        return slot
    }
}

/// Calls its action once, on the next frame the screen draws, however many times it was
/// requested before then.
@MainActor
final class FrameTicker: NSObject {
    private let action: () -> Void
    private var link: CADisplayLink?

    init(_ action: @escaping () -> Void) {
        self.action = action
    }

    func request() {
        if link == nil {
            guard let screen = NSScreen.main else { return action() }
            let link = screen.displayLink(target: self, selector: #selector(tick))
            link.add(to: .main, forMode: .common)
            self.link = link
        }
        link?.isPaused = false
    }

    @objc private func tick(_ link: CADisplayLink) {
        link.isPaused = true
        action()
    }

    isolated deinit {
        link?.invalidate()
    }
}
