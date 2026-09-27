import SwiftUI

/// The Typeset tab's Parts section: how a part's divider page is set — "Part One" and
/// its title, alone on a page — when the book is in parts.
///
/// Without a design of its own a part is set as the chapters' heads are, larger; with
/// one, it has its own number and title cases, ornament, alignment and sizes, and
/// starts on a right-hand page or any. Parts are added in the Book navigator (＋ ▸ Part),
/// or come from a folder's subfolders.
struct PartsSection: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let book = model.pageLayout.book {
            FinishingSection("Parts", id: FinishingSectionID.parts) {
                Toggle("A Design of Their Own", isOn: Binding(
                    get: { book.partDesign != nil },
                    set: { on in
                        guard var draft = model.pageLayout.book else { return }
                        if on {
                            var part = ChapterDesignDraft(draft.chapterDesign)
                            part.showNumber = true
                            part.showTitle = true
                            part.chapterBreak = .newRightPage
                            part.titleSizePt = max(part.titleSizePt, 24)
                            part.numberCase = .upper
                            draft.partDesign = part.design
                        } else {
                            draft.partDesign = nil
                        }
                        model.pageLayout.apply(draft)
                    }))
                if book.partDesign != nil {
                    Picker("Parts Start", selection: bind(\.chapterBreak)) {
                        Text("On a New Page").tag(ChapterBreak.newPage)
                        Text("On a Right-Hand Page").tag(ChapterBreak.newRightPage)
                    }
                    Picker("Alignment", selection: bind(\.alignment)) {
                        Label("Left", systemImage: "text.alignleft").tag(HeadAlignment.left)
                        Label("Centre", systemImage: "text.aligncenter").tag(HeadAlignment.center)
                        Label("Right", systemImage: "text.alignright").tag(HeadAlignment.right)
                    }
                    .pickerStyle(.segmented)
                    casePicker("Number Set In", bind(\.numberCase))
                    casePicker("Title Set In", bind(\.titleCase))
                    Picker("Ornament", selection: bind(\.ornament)) {
                        Text("None").tag(OrnamentKind.none)
                        Text("A Rule").tag(OrnamentKind.rule)
                        Text("A Glyph").tag(OrnamentKind.glyph)
                    }
                    if ChapterDesignDraft(book.partDesign).ornament == .glyph {
                        CommitTextField("Glyph", text: bind(\.ornamentGlyph), prompt: "❦")
                    }
                    Stepper(value: bind(\.titleSizePt), in: 10...72, step: 1) {
                        LabeledContent("Title Size", value: "\(Int(ChapterDesignDraft(book.partDesign).titleSizePt)) pt")
                    }
                }
            } footer: {
                FinishingNote("Add a part from the Book navigator’s ＋ menu. Parts are numbered “Part One”, “Part Two” in the chapters’ style, and listed in the contents.")
            }
        }
    }

    private func casePicker(_ title: String, _ selection: Binding<HeadCase>) -> some View {
        Picker(title, selection: selection) {
            Text("As Written").tag(HeadCase.asWritten)
            Text("Capitals").tag(HeadCase.upper)
            Text("Small Capitals").tag(HeadCase.smallCaps)
            Text("Italic").tag(HeadCase.italic)
        }
    }

    private func bind<T: Equatable>(_ keyPath: WritableKeyPath<ChapterDesignDraft, T>) -> Binding<T> {
        Binding(
            get: { ChapterDesignDraft(model.pageLayout.book?.partDesign)[keyPath: keyPath] },
            set: { value in
                guard var book = model.pageLayout.book, book.partDesign != nil else { return }
                var design = ChapterDesignDraft(book.partDesign)
                design[keyPath: keyPath] = value
                guard design.design != book.partDesign else { return }
                book.partDesign = design.design
                model.pageLayout.apply(book)
            })
    }
}
