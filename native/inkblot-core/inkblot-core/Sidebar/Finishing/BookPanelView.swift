import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// The Finishing layout's Book tab: what goes into the book.
///
/// A book is a folder of documents, in the order the file tree shows — the active
/// document's folder, or the whole project. Its title and author go on the running
/// heads, the EPUB and the PDF; its own page setup, when it has one, is what every
/// chapter prints in. Which chapters are in, how they are headed, and the pages before
/// and after them are all the book's, kept in the project and applied whenever it is
/// printed or exported.
struct BookPanelView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        FinishingPanel(needsDocument: false) {
            if let state = model.pageLayout.state, let book = model.pageLayout.book {
                infoSection(state, book)
                chaptersSection(state, book)
                headingsSection(book)
                frontMatterSection(book)
                backMatterSection(book)
                setupSection(state)
            }
        }
    }

    private func binding<T: Equatable>(_ keyPath: WritableKeyPath<BookDraft, T>) -> Binding<T> {
        let layout = model.pageLayout
        return Binding(
            get: { layout.book?[keyPath: keyPath] ?? BookDraft(layout.state!.book)[keyPath: keyPath] },
            set: { value in
                guard var draft = layout.book, draft[keyPath: keyPath] != value else { return }
                draft[keyPath: keyPath] = value
                layout.apply(draft)
            })
    }

    /* ---------------- the book ---------------- */

    @ViewBuilder
    private func infoSection(_ state: PageLayoutState, _ book: BookDraft) -> some View {
        let layout = model.pageLayout
        FinishingSection("Book", id: FinishingSectionID.bookInfo) {
            Picker("Contains", selection: Binding(
                get: { state.scope == .project ? PrintScope.project : .folder },
                set: { layout.setScope($0) }
            )) {
                Text(folderLabel(book.folder)).tag(PrintScope.folder)
                Text("The Whole Project").tag(PrintScope.project)
            }
            CommitTextField("Title", text: binding(\.title))
            CommitTextField("Author", text: binding(\.author), prompt: "Your name")
            CommitTextField("Language", text: binding(\.language), prompt: "en-US")
            LabeledContent("Cover") {
                HStack(spacing: 8) {
                    if let file = state.coverFile, let image = NSImage(contentsOfFile: file) {
                        Image(nsImage: image)
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(width: 34, height: 48)
                            .clipShape(.rect(cornerRadius: 2))
                            .shadow(radius: 1, y: 1)
                            .accessibilityLabel("The cover")
                    }
                    Button(book.coverImage == nil ? "Choose…" : "Change…", action: chooseCover)
                    if book.coverImage != nil {
                        Button("Remove", role: .destructive) { layout.setCover(nil) }
                    }
                }
            }
        } footer: {
            FinishingNote("The title and author go on the running heads, the EPUB and the PDF. The language is what an e-reader reads it in; the cover is the EPUB’s.")
        }
    }

    private func chooseCover() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = false
        panel.message = "Choose an image for the book’s cover"
        panel.prompt = "Use as Cover"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        model.pageLayout.setCover(url)
    }

    private func folderLabel(_ folder: String) -> String {
        let name = folder.split(separator: "/").last.map(String.init)
        return name.map { "The “\($0)” Folder" } ?? "The Project’s Top Folder"
    }

    /* ---------------- chapters ---------------- */

    @ViewBuilder
    private func chaptersSection(_ state: PageLayoutState, _ book: BookDraft) -> some View {
        let layout = model.pageLayout
        let excluded = Set(book.excluded)
        let included = state.bookChapters.filter { !excluded.contains($0) }.count
        FinishingSection("Chapters", id: FinishingSectionID.chapters) {
            if state.bookChapters.isEmpty {
                FinishingNote("There are no documents in this book yet.")
            } else {
                LabeledContent("In the Book") {
                    Text(included == state.bookChapters.count ? "All \(included)" : "\(included) of \(state.bookChapters.count)")
                        .monospacedDigit()
                }
                ForEach(Array(state.bookChapters.enumerated()), id: \.element) { index, path in
                    Toggle(isOn: Binding(
                        get: { !excluded.contains(path) },
                        set: { on in
                            guard var draft = layout.book else { return }
                            draft.include(path, on)
                            layout.apply(draft)
                        }
                    )) {
                        HStack(spacing: 8) {
                            Text("\(index + 1)")
                                .monospacedDigit()
                                .foregroundStyle(.secondary)
                                .frame(minWidth: 18, alignment: .trailing)
                            Text(path.split(separator: "/").last.map(String.init) ?? path)
                                .lineLimit(1)
                                .truncationMode(.middle)
                                .foregroundStyle(excluded.contains(path) ? .secondary : .primary)
                            if path == state.docPath {
                                Image(systemName: "pencil")
                                    .foregroundStyle(.secondary)
                                    .help("The document you are writing in")
                            }
                        }
                    }
                    .toggleStyle(.checkbox)
                }
                if !excluded.isEmpty {
                    Button("Include Every Chapter") {
                        guard var draft = layout.book else { return }
                        draft.excluded = []
                        layout.apply(draft)
                    }
                }
            }
        } footer: {
            FinishingNote("In the order the file tree shows: drag documents in the tree to reorder the book. A chapter left out still prints on its own.")
        }
    }

    /* ---------------- chapter headings ---------------- */

    @ViewBuilder
    private func headingsSection(_ book: BookDraft) -> some View {
        FinishingSection("Chapter Headings", id: FinishingSectionID.headings) {
            Picker("Number Chapters", selection: binding(\.numbering)) {
                Text("No, Use Their Own Headings").tag(ChapterNumberStyle.none)
                Divider()
                Text("One, Two, Three").tag(ChapterNumberStyle.words)
                Text("1, 2, 3").tag(ChapterNumberStyle.numerals)
                Text("I, II, III").tag(ChapterNumberStyle.roman)
            }
            if book.numbering != .none {
                CommitTextField("Before the Number", text: binding(\.numberPrefix), prompt: "Chapter")
                Toggle("Keep Each Chapter’s Title", isOn: binding(\.numberIncludesTitle))
                LabeledContent("Heading") {
                    VStack(alignment: .trailing, spacing: 1) {
                        Text(Self.label(3, book))
                        if book.numberIncludesTitle {
                            Text("The Chapter’s Title").foregroundStyle(.secondary)
                        }
                    }
                    .font(.system(.callout, design: .serif))
                }
            }
        } footer: {
            FinishingNote(book.numbering == .none
                ? "Each chapter prints under its own first heading."
                : "The number replaces a chapter’s opening Heading 1, and its title goes under the number. A chapter without one is titled by its document’s name.")
        }
    }

    /// The heading chapter `n` gets, as `bookMatter.ts` writes it.
    static func label(_ n: Int, _ book: BookDraft) -> String {
        let number = switch book.numbering {
        case .none: ""
        case .words: Self.words(n)
        case .numerals: String(n)
        case .roman: RunningPreviewContext.roman(n)
        }
        let prefix = book.numberPrefix.trimmingCharacters(in: .whitespaces)
        return prefix.isEmpty ? number : "\(prefix) \(number)"
    }

    /// "Three", "Forty-Two": spelled as `numberToWords` in bookMatter.ts spells it.
    static func words(_ n: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .spellOut
        formatter.locale = Locale(identifier: "en_US")
        let spelled = formatter.string(from: NSNumber(value: n)) ?? String(n)
        return spelled.split(separator: " ").map { word in
            word.split(separator: "-").map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined(separator: "-")
        }.joined(separator: " ")
    }

    /* ---------------- front and back matter ---------------- */

    @ViewBuilder
    private func frontMatterSection(_ book: BookDraft) -> some View {
        FinishingSection("Front Matter", id: FinishingSectionID.frontMatter) {
            Toggle("Half-Title Page", isOn: binding(\.halfTitle))
                .help("A page with the title alone, before the title page")
            Toggle("Contents", isOn: binding(\.contents))
                .help("A table of contents with each chapter’s page number")
            CommitTextEditor("Copyright Page", text: binding(\.copyright), prompt: "Copyright © Year Author. All rights reserved.")
            if book.copyright.isEmpty {
                Button("Use the Usual Wording") {
                    guard var draft = model.pageLayout.book else { return }
                    draft.copyright = BookDraft.suggestedCopyright(title: draft.title, author: draft.author.isEmpty ? (model.pageLayout.state?.author?.byline ?? "") : draft.author)
                    model.pageLayout.apply(draft)
                }
                .controlSize(.small)
            }
            CommitTextEditor("Dedication", text: binding(\.dedication), prompt: "For…")
            CommitTextEditor("Epigraph", text: binding(\.epigraph))
            if !book.epigraph.isEmpty {
                CommitTextField("Epigraph By", text: binding(\.epigraphSource), prompt: "Who said it")
            }
        } footer: {
            FinishingNote("Printed before the first chapter, each on a page of its own and unnumbered. The title page is set on the Page tab. Leave a box empty to leave its page out.")
        }
    }

    @ViewBuilder
    private func backMatterSection(_ book: BookDraft) -> some View {
        FinishingSection("Back Matter", id: FinishingSectionID.backMatter) {
            CommitTextEditor("Acknowledgements", text: binding(\.acknowledgements))
            CommitTextEditor("About the Author", text: binding(\.aboutTheAuthor))
            CommitTextEditor("Also by the Author", text: binding(\.alsoBy), prompt: "One title per line")
        } footer: {
            FinishingNote("Printed after the last chapter, each under its own heading, and listed in the contents.")
        }
    }

    /* ---------------- page setup ---------------- */

    @ViewBuilder
    private func setupSection(_ state: PageLayoutState) -> some View {
        let layout = model.pageLayout
        FinishingSection("Page Setup", id: FinishingSectionID.bookSetup) {
            if state.bookSetupActive {
                LabeledContent("Every chapter prints in") {
                    Text(layout.format(state.book.pageSetup?.formatId)?.label ?? "The book’s own setup")
                        .foregroundStyle(.secondary)
                }
                Button("Edit the Book’s Setup") {
                    if state.scope == .document { layout.setScope(.folder) }
                    model.showPageSetup()
                }
                Button("Let Each Chapter Use Its Own", role: .destructive) { layout.clearBookSetup() }
            } else {
                FinishingNote("Each chapter shows its own setup on screen; printed as a book, every chapter takes the first chapter’s. Give the book a setup of its own to print them all alike.")
                Button("Use This Document’s Setup for the Book") { layout.useSetupForBook() }
                    .disabled(state.docPath == nil)
            }
        }
    }
}
