import SwiftUI

/// The Typeset tab: turning a manuscript into a book's pages, in the order a book
/// designer works.
///
/// What is in the book first, then the page it is set on, the body type, how chapters
/// open, the running heads and the title page, and the pages before and after the
/// chapters. Print and Export are the next tab's: this one ends by pointing there.
struct TypesetPanelView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        FinishingPanel(needsDocument: false, showsActions: false) {
            BookSections(.info, .chapters)
            PageSetupSections(.format, .page)
            PageSetupSections(.typography, .textFlow)
            BookSections(.headings)
            PageSetupSections(.headerFooter, .titlePage)
            BookSections(.frontMatter, .backMatter, .setup)
            Section {
                Button {
                    model.showPublish()
                } label: {
                    Label("Next: Print & Export", systemImage: "arrow.right")
                        .frame(maxWidth: .infinity)
                }
                .controlSize(.large)
            } footer: {
                FinishingNote("Proof the pages in the editor first — the Typeset pages are what prints.")
            }
        }
    }
}
