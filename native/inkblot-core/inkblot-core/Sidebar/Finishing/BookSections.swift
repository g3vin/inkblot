import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// The book's sections of the Typeset tab: the book itself, and the setup it prints in.
///
/// A book is a folder of documents — the active document's folder, or the whole
/// project. Its title and author go on the running heads, the EPUB and the PDF; its own
/// page setup, when it has one, is what every chapter prints in. What is in it, and in
/// what order, is the Book navigator's; how its chapters open is Chapter Openings'.
struct BookSections: View {
    enum Kind: Hashable {
        case info, setup
    }

    let kinds: [Kind]

    @Environment(AppModel.self) private var model

    init(_ kinds: Kind...) {
        self.kinds = kinds
    }

    var body: some View {
        if let state = model.pageLayout.state, let book = model.pageLayout.book {
            ForEach(kinds, id: \.self) { kind in
                switch kind {
                case .info: infoSection(state, book)
                case .setup: setupSection(state)
                }
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
                    if let file = state.cover?.sets.first(where: { $0.id == state.cover?.active })?.frontFile, let image = NSImage(contentsOfFile: file) {
                        Image(nsImage: image)
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(width: 34, height: 48)
                            .clipShape(.rect(cornerRadius: 2))
                            .shadow(radius: 1, y: 1)
                            .accessibilityLabel("The cover")
                    }
                    Button("Show the Cover") { layout.showCover() }
                }
            }
        } footer: {
            FinishingNote("The title and author go on the running heads, the EPUB and the PDF. The language is what an e-reader reads it in; the cover is the EPUB’s.")
        }
    }

    private func folderLabel(_ folder: String) -> String {
        let name = folder.split(separator: "/").last.map(String.init)
        return name.map { "The “\($0)” Folder" } ?? "The Project’s Top Folder"
    }

    /* ---------------- chapter headings ---------------- */

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
