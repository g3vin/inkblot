import SwiftUI

/// The Typeset tab's Editions section: the book in its other forms.
///
/// A paperback, a hardcover, large print, an e-book: one book, each with its own trim,
/// margins, type and cover, sharing the contents, design and styles. The one chosen here
/// (or in the toolbar) is the one being typeset — its page and cover are what the Page
/// and Body Text sections change — and Export All Editions makes every one's files.
struct EditionsSection: View {
    @Environment(AppModel.self) private var model
    @State private var renaming: Edition?
    @State private var newName = ""

    var body: some View {
        let layout = model.pageLayout
        let editions = layout.book?.editions ?? []
        let active = layout.book?.activeEdition
        FinishingSection("Editions", id: FinishingSectionID.editions) {
            Picker("Typesetting", selection: Binding(
                get: { active ?? "" },
                set: { layout.editEditions(.activate, id: $0.isEmpty ? nil : $0) }
            )) {
                Text("The Book as Set Up").tag("")
                ForEach(editions, id: \.id) { edition in
                    Text(edition.name).tag(edition.id)
                }
            }
            ForEach(editions, id: \.id) { edition in
                HStack {
                    Image(systemName: Self.symbol(edition.kind ?? .paperback)).foregroundStyle(.secondary).frame(width: 18)
                    Text(edition.name).fontWeight(edition.id == active ? .semibold : .regular)
                    Spacer()
                    if let sets = layout.state?.cover?.sets, !sets.isEmpty {
                        Menu {
                            Button("The Book’s Cover") { layout.editEditions(.setCover, id: edition.id) }
                            Divider()
                            ForEach(sets, id: \.id) { set in
                                Button(set.name) { layout.editEditions(.setCover, id: edition.id, coverSetId: set.id) }
                            }
                        } label: {
                            Text(sets.first { $0.id == edition.coverSetId }?.name ?? "Book’s Cover")
                        }
                        .fixedSize()
                        .help("The cover this edition prints and exports with")
                    }
                    Menu {
                        Button("Rename…") {
                            newName = edition.name
                            renaming = edition
                        }
                        Button("Duplicate") { layout.editEditions(.duplicate, id: edition.id) }
                        Divider()
                        Button("Delete", role: .destructive) { layout.editEditions(.delete, id: edition.id) }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .menuStyle(.borderlessButton)
                    .menuIndicator(.hidden)
                    .fixedSize()
                }
            }
            Menu("Add an Edition", systemImage: "plus") {
                Button("Paperback") { layout.editEditions(.add, kind: .paperback) }
                Button("Hardcover") { layout.editEditions(.add, kind: .hardcover) }
                Button("Large Print") { layout.editEditions(.add, kind: .largePrint) }
                Button("eBook") { layout.editEditions(.add, kind: .ebook) }
            }
            if !editions.isEmpty {
                Button("Export All Editions…", systemImage: "square.and.arrow.up.on.square") { layout.exportAllEditions() }
            }
        } footer: {
            FinishingNote(editions.isEmpty
                ? "Add a hardcover, a large-print or an e-book edition: each keeps its own trim, margins, type and cover; the text and design stay one."
                : "Changes to the page and the type are the edition’s being typeset. Export All Editions writes each print edition’s interior and cover PDFs, and each e-book’s EPUB.")
        }
        .alert("Rename Edition", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $newName)
            Button("Rename") {
                if let edition = renaming { layout.editEditions(.rename, id: edition.id, name: newName) }
                renaming = nil
            }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
    }

    static func symbol(_ kind: EditionKind) -> String {
        switch kind {
        case .paperback: "book.closed"
        case .hardcover: "books.vertical"
        case .largePrint: "textformat.size.larger"
        case .ebook: "ipad"
        }
    }
}

/// The toolbar's edition picker: which edition is being typeset.
struct EditionPicker: View {
    let model: AppModel

    var body: some View {
        let layout = model.pageLayout
        let editions = layout.book?.editions ?? []
        let active = layout.book?.activeEdition
        Menu {
            Button {
                layout.editEditions(.activate, id: nil)
            } label: {
                if active == nil { Label("The Book as Set Up", systemImage: "checkmark") } else { Text("The Book as Set Up") }
            }
            if !editions.isEmpty { Divider() }
            ForEach(editions, id: \.id) { edition in
                Button {
                    layout.editEditions(.activate, id: edition.id)
                } label: {
                    if edition.id == active { Label(edition.name, systemImage: "checkmark") } else { Text(edition.name) }
                }
            }
            Divider()
            Menu("Add an Edition") {
                Button("Paperback") { layout.editEditions(.add, kind: .paperback) }
                Button("Hardcover") { layout.editEditions(.add, kind: .hardcover) }
                Button("Large Print") { layout.editEditions(.add, kind: .largePrint) }
                Button("eBook") { layout.editEditions(.add, kind: .ebook) }
            }
            if !editions.isEmpty {
                Button("Export All Editions…") { layout.exportAllEditions() }
            }
        } label: {
            Label(editions.first { $0.id == active }?.name ?? "Edition", systemImage: "books.vertical")
        }
        .help("The edition being typeset: its page, type and cover")
        .disabled(!layout.hasDocument)
    }
}
