import SwiftUI

/// The left sidebar in Typeset mode: the book's contents, in the book's own order.
///
/// Front matter, the chapters (in their parts) and the back matter, as the book prints
/// them. Dragging a row reorders the book — never the file tree, which stays as the
/// writer arranged the manuscript. Each row can be hidden, which leaves it out of the
/// Typeset pages, print, export and the continuous document. Front and back matter
/// are pages of the book's own — real documents, made only when added here — and
/// selecting one opens it to be written, in either mode.
///
/// Everything is the page's: the rows are `PageLayoutState.bookItems`, and every change
/// goes back as a command (`bridge/print.rs`).
struct BookNavigator: View {
    @Environment(AppModel.self) private var model
    @State private var renaming: BookRow?
    @State private var newTitle = ""
    @State private var pendingRemove: BookRow?

    var body: some View {
        Group {
            if let state = model.pageLayout.state, model.hasProject {
                if state.bookItems?.isEmpty ?? true {
                    ContentUnavailableView {
                        Label("No Chapters Yet", systemImage: "book.closed")
                    } description: {
                        Text("A book is a folder’s documents. Open one of them to typeset its book.")
                    }
                } else {
                    list(state)
                }
            } else {
                ContentUnavailableView("No Project Open", systemImage: "book.closed", description: Text("Choose a project in the window."))
            }
        }
        .alert("Rename", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Title", text: $newTitle)
            Button("Rename") {
                if let row = renaming {
                    model.bridge.send(.editBookItem(EditBookItemCommand(id: row.id, title: newTitle, chapterType: nil, page: nil)))
                }
                renaming = nil
            }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
        .confirmationDialog(
            pendingRemove.map { "Remove “\($0.title)” from the book?" } ?? "",
            isPresented: Binding(get: { pendingRemove != nil }, set: { if !$0 { pendingRemove = nil } }),
            titleVisibility: .visible,
            presenting: pendingRemove
        ) { row in
            Button("Remove", role: .destructive) {
                model.bridge.send(.removeBookItem(RemoveBookItemCommand(id: row.id)))
            }
        } message: { row in
            Text(row.kind == .matter ? "Its page is deleted with it. This can’t be undone." : "You can add it again from the + menu.")
        }
    }

    /* ---------------- the list ---------------- */

    /// A row of the list: an entry, or one of the three headings between them.
    private enum Line: Identifiable {
        case heading(BookRowSection)
        case item(BookRow)

        var id: String {
            switch self {
            case .heading(let section): "heading.\(section.rawValue)"
            case .item(let row): row.id
            }
        }
    }

    private func lines(_ rows: [BookRow]) -> [Line] {
        var out: [Line] = []
        for section in [BookRowSection.front, .body, .back] {
            out.append(.heading(section))
            out += rows.filter { $0.section == section }.map(Line.item)
        }
        return out
    }

    private func list(_ state: PageLayoutState) -> some View {
        let rows = state.bookItems ?? []
        let all = lines(rows)
        return List(selection: Binding(
            get: { state.selectedBookItem },
            set: { id in if let id, id != state.selectedBookItem { open(id) } }
        )) {
            ForEach(all) { line in
                switch line {
                case .heading(let section):
                    Text(Self.title(of: section))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .moveDisabled(true)
                        .selectionDisabled(true)
                case .item(let row):
                    BookRowView(row: row) { hidden in
                        model.bridge.send(.setBookItemHidden(SetBookItemHiddenCommand(id: row.id, hidden: hidden)))
                    }
                    .tag(row.id)
                    .contextMenu { menu(for: row) }
                }
            }
            .onMove { source, destination in move(all, from: source, to: destination) }
        }
        .listStyle(.sidebar)
        .safeAreaInset(edge: .bottom) { bottomBar(state) }
    }

    static func title(of section: BookRowSection) -> String {
        switch section {
        case .front: "Front Matter"
        case .body: "Chapters"
        case .back: "Back Matter"
        }
    }

    /// A drag, as "before this entry": the first entry at or after where it landed.
    private func move(_ all: [Line], from source: IndexSet, to destination: Int) {
        guard let from = source.first, case .item(let moving) = all[from] else { return }
        let before = all[destination...].lazy.compactMap { line -> String? in
            if case .item(let row) = line, row.id != moving.id { return row.id }
            return nil
        }.first
        // Dropped past the last entry, into an empty back matter: at the end.
        model.bridge.send(.moveBookItem(MoveBookItemCommand(id: moving.id, before: before)))
    }

    private func open(_ id: String) {
        model.bridge.send(.openBookItem(OpenBookItemCommand(id: id)))
    }

    /* ---------------- menus ---------------- */

    @ViewBuilder
    private func menu(for row: BookRow) -> some View {
        Button(row.hidden ? "Show in the Book" : "Hide from the Book") {
            model.bridge.send(.setBookItemHidden(SetBookItemHiddenCommand(id: row.id, hidden: !row.hidden)))
        }
        if row.kind == .chapter {
            Menu("Chapter Type") {
                ForEach([ChapterType.chapter, .prologue, .epilogue, .interlude, .unnumbered], id: \.self) { type in
                    Toggle(type.label, isOn: Binding(
                        get: { (row.chapterType ?? .chapter) == type },
                        set: { _ in model.bridge.send(.editBookItem(EditBookItemCommand(id: row.id, title: nil, chapterType: type, page: nil))) }))
                }
            }
            Divider()
            Button("Open in Write Mode") {
                open(row.id)
                model.pageLayout.setMode(.write)
            }
            Button("Reveal in File Tree") {
                open(row.id)
                model.leftSidebar = .files
            }
        } else {
            Button("Rename…") {
                newTitle = row.title
                renaming = row
            }
            Button("Remove from the Book…", role: .destructive) { pendingRemove = row }
        }
        Divider()
        Button("Add a Part Before") {
            model.bridge.send(.addBookItem(AddBookItemCommand(matter: nil, generated: nil, part: true, before: row.id, title: "Part", back: false)))
        }
    }

    private func bottomBar(_ state: PageLayoutState) -> some View {
        GlassEffectContainer {
            HStack(spacing: 8) {
                Menu {
                    Section("Front Matter") {
                        ForEach(BookMatterMenu.front, id: \.label) { entry in addButton(entry) }
                    }
                    Section("Back Matter") {
                        ForEach(BookMatterMenu.back, id: \.label) { entry in addButton(entry) }
                    }
                    Divider()
                    Button("Part Divider") {
                        model.bridge.send(.addBookItem(AddBookItemCommand(matter: nil, generated: nil, part: true, before: nil, title: "Part", back: false)))
                    }
                    Button("Blank Page of the Book’s Own") { add(BookMatterMenu.Entry(label: "", matter: .custom)) }
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 13, weight: .medium))
                }
                .menuStyle(.button)
                .buttonStyle(.borderless)
                .menuIndicator(.hidden)
                .fixedSize()
                .frame(width: 28, height: 28)
                .contentShape(.circle)
                .glassEffect(.regular.interactive(), in: .circle)
                .help("Add front matter, back matter or a part")

                Text(state.book.title)
                    .font(.callout)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .padding(.horizontal, 12)
                    .frame(maxWidth: .infinity, minHeight: 24, alignment: .leading)
                    .glassEffect(.regular, in: .capsule)
                    .help(state.book.folder.isEmpty ? "The whole project, as one book" : "The book in “\(state.book.folder)”")
            }
            .onGeometryChange(for: CGFloat.self, of: { $0.frame(in: .global).midY }) { midY in
                if model.sidebarBarMidY != midY { model.sidebarBarMidY = midY }
            }
        }
        .padding(10)
    }

    private func addButton(_ entry: BookMatterMenu.Entry) -> some View {
        let rows = model.pageLayout.state?.bookItems ?? []
        let has = rows.contains { ($0.generated != nil && $0.generated == entry.generated) }
        return Button(entry.label) { add(entry) }
            .disabled(has)
    }

    private func add(_ entry: BookMatterMenu.Entry) {
        model.bridge.send(.addBookItem(AddBookItemCommand(
            matter: entry.matter, generated: entry.generated, part: false, before: nil, title: nil, back: entry.back)))
    }
}

/// One entry of the book: its number or kind, its title, and its hide button.
private struct BookRowView: View {
    let row: BookRow
    let setHidden: (Bool) -> Void
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 8) {
            leading
                .frame(minWidth: 20, alignment: .trailing)
            VStack(alignment: .leading, spacing: 1) {
                Text(row.title)
                    .lineLimit(1)
                    .truncationMode(.middle)
                if let label = row.label, row.kind != .part {
                    Text(label).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            if hovering || row.hidden {
                Button { setHidden(!row.hidden) } label: {
                    Image(systemName: row.hidden ? "eye.slash" : "eye")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.borderless)
                .help(row.hidden ? "Show in the book" : "Hide from the book: left out of the pages, print, export and the continuous document")
                .accessibilityLabel(row.hidden ? "Show \(row.title)" : "Hide \(row.title)")
            }
        }
        .padding(.leading, row.part == nil ? 0 : 12)
        .opacity(row.hidden ? 0.45 : 1)
        .onHover { hovering = $0 }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var leading: some View {
        switch row.kind {
        case .chapter:
            if let number = row.number {
                Text("\(number)").monospacedDigit().foregroundStyle(.secondary)
            } else {
                Image(systemName: "doc.text").foregroundStyle(.secondary)
            }
        case .part:
            Text(row.label.map { $0.replacingOccurrences(of: "Part ", with: "") } ?? "§")
                .font(.caption.weight(.bold))
                .foregroundStyle(.secondary)
        case .matter:
            Image(systemName: row.legacy == true ? "text.alignleft" : "doc.richtext").foregroundStyle(.secondary)
        case .generated:
            Image(systemName: "gearshape").foregroundStyle(.secondary)
        }
    }
}

/// The + menu's pages, in the standard order of each side.
enum BookMatterMenu {
    struct Entry {
        let label: String
        var matter: MatterKind?
        var generated: GeneratedKind?
        var back = false
    }

    static let front: [Entry] = [
        Entry(label: "Half Title", generated: .halfTitle),
        Entry(label: "Also By", matter: .alsoBy),
        Entry(label: "Title Page", generated: .titlePage),
        Entry(label: "Copyright", matter: .copyright),
        Entry(label: "Dedication", matter: .dedication),
        Entry(label: "Epigraph", matter: .epigraph),
        Entry(label: "Contents", generated: .contents),
        Entry(label: "Foreword", matter: .foreword),
        Entry(label: "Preface", matter: .preface),
        Entry(label: "Introduction", matter: .introduction),
    ]

    static let back: [Entry] = [
        Entry(label: "Afterword", matter: .afterword),
        Entry(label: "Acknowledgements", matter: .acknowledgements),
        Entry(label: "About the Author", matter: .aboutAuthor),
        Entry(label: "Also By", matter: .alsoBy, back: true),
        Entry(label: "Glossary", matter: .glossary),
        Entry(label: "Excerpt", matter: .excerpt),
        Entry(label: "Reading Group Guide", matter: .readingGuide),
        Entry(label: "Newsletter / Call to Action", matter: .callToAction),
    ]
}

extension ChapterType {
    var label: String {
        switch self {
        case .chapter: "Chapter"
        case .prologue: "Prologue"
        case .epilogue: "Epilogue"
        case .interlude: "Interlude"
        case .unnumbered: "Unnumbered"
        }
    }
}
