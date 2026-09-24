import Foundation

/// Saved versions ("forms") of a bubble arrangement — the page's `lib/bubbleForms.ts`,
/// whose rules these have to agree with: a session saved in one shell is reopened in the
/// other.
///
/// The bubbles on screen are always one arrangement, the one written into the document
/// when the editor closes; a form is a copy of one, saved to come back to. Which form is
/// showing is never stored: it is the form the arrangement equals, ids and all, since
/// showing a form copies it exactly. None equal means the arrangement is unsaved.
///
/// Forms are pages, in the order they were saved, and the unsaved arrangement is one more
/// page after them. Leaving it for a form keeps it (`unsaved`), so coming back finds it
/// as it was; it is only let go once another arrangement becomes the unsaved one, by an
/// edit to a form that is showing. Undo brings back any of it.
enum BubbleForms {
    struct Page: Equatable {
        var arrangement: BubbleDrop.Arrangement
        var mode: BubbleMode
    }

    struct State: Equatable {
        var page: Page
        var forms: [BubbleForm]
        /// The unsaved arrangement, kept while a form is showing in its place.
        var unsaved: Page?
    }

    static func isForm(_ page: Page, _ form: BubbleForm) -> Bool {
        (form.mode ?? .words) == page.mode && form.words == page.arrangement.words
            && (form.aside ?? []) == page.arrangement.aside
    }

    /// The form showing, or nil if the arrangement is unsaved.
    static func current(_ state: State) -> Int? {
        state.forms.firstIndex { isForm(state.page, $0) }
    }

    /// How many pages there are to move between: every form, and the unsaved one if any.
    static func pages(_ state: State) -> Int {
        state.forms.count + (current(state) == nil || state.unsaved != nil ? 1 : 0)
    }

    /// The page showing: a form's index, or `forms.count` for the unsaved arrangement.
    static func page(_ state: State) -> Int {
        current(state) ?? state.forms.count
    }

    /// The arrangement saved as a new form, after the others. Nothing if it is one already.
    static func save(_ state: State, id: String = BubbleText.newId()) -> State {
        guard current(state) == nil else { return state }
        var next = state
        next.forms.append(BubbleForm(id: id, words: state.page.arrangement.words, aside: state.page.arrangement.aside,
                                     mode: state.page.mode == .words ? nil : state.page.mode))
        next.unsaved = nil
        return next
    }

    /// Show a page: a form, or (at `forms.count`) the unsaved arrangement.
    static func show(_ state: State, page target: Int) -> State {
        guard target != page(state), target >= 0, target < pages(state) else { return state }
        let unsaved = current(state) == nil ? state.page : state.unsaved
        var next = state
        if target == state.forms.count {
            guard let unsaved else { return state }
            next.page = unsaved
            next.unsaved = nil
            return next
        }
        let form = state.forms[target]
        next.page = Page(arrangement: BubbleDrop.Arrangement(words: form.words, aside: form.aside ?? []),
                         mode: form.mode ?? .words)
        next.unsaved = unsaved
        return next
    }

    /// A form deleted. The bubbles on screen stay as they are: if they were that form,
    /// they are the unsaved arrangement now, in place of any that was kept.
    static func delete(_ state: State, at index: Int) -> State {
        guard state.forms.indices.contains(index) else { return state }
        var next = state
        next.forms.remove(at: index)
        if current(state) == index { next.unsaved = nil }
        return next
    }

    /// After an edit to the bubbles. An edited form is the unsaved arrangement now; the
    /// one kept from before is let go (undo still has it).
    static func settle(_ state: State) -> State {
        guard state.unsaved != nil, current(state) == nil else { return state }
        var next = state
        next.unsaved = nil
        return next
    }
}
