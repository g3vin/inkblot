import SwiftUI

/// The Typeset tab's first section: the entry selected in the Book navigator (or the
/// document open) — what it is, and how its page sits.
///
/// A chapter can be made a prologue or an interlude, which the book does not number.
/// A page of front or back matter, a part or a page the book lays out can open on a
/// right- or left-hand page, sit at the top, down the page or at its foot, and carry
/// the running heads and folio or not — each with its kind's usual setting until the
/// author changes it.
struct ThisPageSection: View {
    @Environment(AppModel.self) private var model
    let row: BookRow

    var body: some View {
        FinishingSection("This Page: \(row.title)", id: FinishingSectionID.thisPage) {
            if row.kind == .chapter {
                Picker("Chapter Type", selection: Binding(
                    get: { row.chapterType ?? .chapter },
                    set: { edit(chapterType: $0) })) {
                    ForEach([ChapterType.chapter, .prologue, .epilogue, .interlude, .unnumbered], id: \.self) {
                        Text($0.label).tag($0)
                    }
                }
                if let label = row.label {
                    LabeledContent("Heading", value: label)
                }
            } else {
                Picker("Starts On", selection: page(\.start)) {
                    Text("The Next Page").tag(PageStart.any)
                    Text("A Right-Hand Page").tag(PageStart.recto)
                    Text("A Left-Hand Page").tag(PageStart.verso)
                }
                Picker("Sits", selection: page(\.position)) {
                    Text("At the Top").tag(PagePosition.top)
                    Text("Down the Page").tag(PagePosition.sunk)
                    Text("In the Middle").tag(PagePosition.centered)
                    Text("At the Foot").tag(PagePosition.bottom)
                }
                Toggle("Running Heads", isOn: page(\.runningHeads))
                Toggle("Page Number", isOn: page(\.folio))
            }
            if row.hidden {
                FinishingCaution(text: "Hidden: this is left out of the pages, print and export.")
                Button("Show in the Book") {
                    model.bridge.send(.setBookItemHidden(SetBookItemHiddenCommand(id: row.id, hidden: false)))
                }
            }
        } footer: {
            FinishingNote(note)
        }
    }

    private var note: String {
        switch row.kind {
        case .chapter: "A prologue, an epilogue or an interlude is headed by what it is and not numbered; the chapters after it count on."
        case .matter: "A page of the book’s own. Write it in the page itself — in Typeset or in Write."
        case .generated: "Laid out from the book: its title and author, its chapters."
        case .part: "A divider before the chapters of the part."
        }
    }

    private func page<T: Equatable>(_ keyPath: WritableKeyPath<PageOptionsDraft, T>) -> Binding<T> {
        Binding(
            get: { PageOptionsDraft(row.page)[keyPath: keyPath] },
            set: { value in
                var draft = PageOptionsDraft(row.page)
                guard draft[keyPath: keyPath] != value else { return }
                draft[keyPath: keyPath] = value
                model.bridge.send(.editBookItem(EditBookItemCommand(id: row.id, title: nil, chapterType: nil, page: draft.options)))
            })
    }

    private func edit(chapterType: ChapterType) {
        model.bridge.send(.editBookItem(EditBookItemCommand(id: row.id, title: nil, chapterType: chapterType, page: nil)))
    }
}

/// `PageOptions` as something a control can write to.
struct PageOptionsDraft: Equatable {
    var start: PageStart
    var position: PagePosition
    var runningHeads: Bool
    var folio: Bool
    var heading: Bool

    init(_ options: PageOptions) {
        start = options.start
        position = options.position
        runningHeads = options.runningHeads
        folio = options.folio
        heading = options.heading
    }

    var options: PageOptions {
        PageOptions(start: start, position: position, runningHeads: runningHeads, folio: folio, heading: heading)
    }
}
