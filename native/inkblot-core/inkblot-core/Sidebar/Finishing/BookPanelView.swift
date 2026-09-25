import SwiftUI

/// The Finishing layout's Book tab: what goes into the book.
///
/// A book is a folder of documents, in the order the file tree shows — the active
/// document's folder, or the whole project. Its title and author go on the running
/// heads, the EPUB and the PDF; its own page setup, when it has one, is what every
/// chapter prints in.
struct BookPanelView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        FinishingPanel(needsDocument: false) {
            if let state = model.pageLayout.state, let book = model.pageLayout.book {
                infoSection(state, book)
                chaptersSection(state)
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
        } footer: {
            FinishingNote("The title and author go on the running heads, the EPUB and the PDF. The language is what an e-reader reads it in.")
        }
    }

    private func folderLabel(_ folder: String) -> String {
        let name = folder.split(separator: "/").last.map(String.init)
        return name.map { "The “\($0)” Folder" } ?? "The Project’s Top Folder"
    }

    /* ---------------- chapters ---------------- */

    @ViewBuilder
    private func chaptersSection(_ state: PageLayoutState) -> some View {
        FinishingSection("Chapters", id: FinishingSectionID.chapters) {
            if state.bookChapters.isEmpty {
                FinishingNote("There are no documents in this book yet.")
            } else {
                ForEach(Array(state.bookChapters.enumerated()), id: \.element) { index, path in
                    HStack(spacing: 8) {
                        Text("\(index + 1)")
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                            .frame(minWidth: 18, alignment: .trailing)
                        Text(path.split(separator: "/").last.map(String.init) ?? path)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer(minLength: 0)
                        if path == state.docPath {
                            Image(systemName: "pencil")
                                .foregroundStyle(.secondary)
                                .help("The document you are writing in")
                        }
                    }
                }
            }
        } footer: {
            FinishingNote("In the order the file tree shows. Drag documents in the tree to reorder the book.")
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
