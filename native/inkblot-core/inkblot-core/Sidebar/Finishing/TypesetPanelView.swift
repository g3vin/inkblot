import SwiftUI

/// The Typeset tab: turning a manuscript into a book's pages, in the order a book
/// designer works.
///
/// What is in the book — and in what order — is the Book navigator's, in the left
/// sidebar; this tab starts with the page selected there, then the book, the page it
/// is set on, the body type, how chapters open, the running heads and the title page.
/// Print and Export are the next tab's: this one ends by pointing there.
struct TypesetPanelView: View {
    @Environment(AppModel.self) private var model
    @AppStorage(LengthUnit.storageKey) private var unitsRaw = LengthUnit.defaultForLocale.rawValue

    private var selectedRow: BookRow? {
        guard let state = model.pageLayout.state, let id = state.selectedBookItem else { return nil }
        return state.bookItems?.first { $0.id == id }
    }

    var body: some View {
        FinishingPanel(needsDocument: false, showsActions: false) {
            if let row = selectedRow {
                ThisPageSection(row: row)
            }
            BookSections(.info)
            // While the e-book is showing, its options are what the panel is for.
            if model.pageLayout.typesetView == .digital { BookSections(.digital) }
            StyleGallerySection()
            PageSetupSections(.format, .page)
            PageSetupSections(.typography, .textFlow)
            ProofSection()
            TextStylesSection()
            ChapterOpeningsSection(unit: LengthUnit(rawValue: unitsRaw) ?? .inches)
            PartsSection()
            BookSections(.notes)
            PageSetupSections(.headerFooter, .titlePage)
            BookSections(.setup)
            if model.pageLayout.typesetView != .digital { BookSections(.digital) }
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
