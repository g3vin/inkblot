import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// The Typeset tab's Style section: whole designs for the book, one click each.
///
/// Each card is drawn from the style itself — its face, its number and title as a
/// chapter would open — so what is picked is what the pages show. The book remembers
/// the style it came from; changed since, it says so and offers it back.
struct StyleGallerySection: View {
    @Environment(AppModel.self) private var model

    private let columns = [GridItem(.adaptive(minimum: 104), spacing: 8)]

    var body: some View {
        let styles = model.pageLayout.catalog?.bookStyles ?? []
        let design = model.pageLayout.book?.chapterDesign
        let current = styles.first { $0.id == design?.styleId }
        FinishingSection("Style", id: FinishingSectionID.style) {
            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(styles, id: \.id) { style in
                    StyleCard(style: style, isCurrent: style.id == current?.id) {
                        model.pageLayout.applyStyle(style.id)
                    }
                }
            }
            .padding(.vertical, 4)
            if let current, let design, design != current.design {
                HStack {
                    Text("Changed from \(current.label)").foregroundStyle(.secondary)
                    Spacer()
                    Button("Reset") { model.pageLayout.applyStyle(current.id) }
                }
                .font(.callout)
            }
        } footer: {
            FinishingNote("A style sets the book’s type, how its chapters open and its running heads. Everything below fine-tunes it.")
        }
    }
}

private struct StyleCard: View {
    let style: BookStyleOption
    let isCurrent: Bool
    let choose: () -> Void

    var body: some View {
        Button(action: choose) {
            VStack(spacing: 3) {
                preview
                    .frame(maxWidth: .infinity, minHeight: 64)
                    .padding(6)
                    .background(.white, in: .rect(cornerRadius: 4))
                    .foregroundStyle(.black)
                    .overlay {
                        RoundedRectangle(cornerRadius: 4)
                            .strokeBorder(isCurrent ? Color.accentColor : .secondary.opacity(0.3), lineWidth: isCurrent ? 2 : 0.5)
                    }
                Text(style.label).font(.caption).lineLimit(1)
            }
        }
        .buttonStyle(.plain)
        .help(style.description)
        .accessibilityLabel("\(style.label) style")
        .accessibilityAddTraits(isCurrent ? .isSelected : [])
    }

    private var preview: some View {
        let d = style.design
        let face = CSSFamily.primary(d.headingFont ?? style.typography.fontFamily)
        let align: HorizontalAlignment = d.alignment == .left ? .leading : d.alignment == .right ? .trailing : .center
        return VStack(alignment: align, spacing: 2) {
            if d.ornament == .glyph, d.ornamentPosition == .above { Text(d.ornamentGlyph).font(.custom(face, size: 11)) }
            if d.showNumber {
                Text(cased(d.numberSizePt > 20 ? "1" : "Chapter One", d.numberCase))
                    .font(.custom(face, size: min(22, max(7, d.numberSizePt * 0.55))))
            }
            if d.ornament == .rule, d.ornamentPosition == .between { Rectangle().frame(width: 18, height: 0.5) }
            if d.showTitle {
                Text(cased("The Road", d.titleCase))
                    .font(.custom(face, size: min(13, max(8, d.titleSizePt * 0.5))))
                    .italic(d.titleCase == .italic)
            }
            if d.ornament == .glyph, d.ornamentPosition == .below { Text(d.ornamentGlyph).font(.custom(face, size: 10)) }
            Text("It was late when").font(.custom(CSSFamily.primary(style.typography.fontFamily), size: 7)).opacity(0.7)
        }
        .frame(maxWidth: .infinity, alignment: SwiftUI.Alignment(horizontal: align, vertical: .center))
    }

    private func cased(_ text: String, _ headCase: HeadCase) -> String {
        headCase == .upper ? text.uppercased() : text
    }
}

/// The first family of a CSS font list, unquoted: what SwiftUI can name.
enum CSSFamily {
    static func primary(_ list: String) -> String {
        let first = list.split(separator: ",").first.map(String.init) ?? list
        return first.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
    }
}

/// The Typeset tab's Chapter Openings section: how every chapter's head is set, and
/// what it shows — its number, title, subtitle, an ornament or a picture — with where
/// each chapter starts and how its first paragraph opens.
struct ChapterOpeningsSection: View {
    @Environment(AppModel.self) private var model
    let unit: LengthUnit

    var body: some View {
        if let book = model.pageLayout.book {
            let design = ChapterDesignDraft(book.chapterDesign)
            FinishingSection("Chapter Openings", id: FinishingSectionID.headings) {
                Picker("Chapters Start", selection: bind(\.chapterBreak)) {
                    Text("On a New Page").tag(ChapterBreak.newPage)
                    Text("On a Right-Hand Page").tag(ChapterBreak.newRightPage)
                    Text("Straight On, Where There’s Room").tag(ChapterBreak.continue)
                }
                Toggle("Number", isOn: Binding(
                    get: { design.showNumber },
                    set: { on in
                        // A number needs a way of being written: words, until chosen.
                        if on, var draft = model.pageLayout.book, draft.numbering == .none {
                            draft.numbering = .words
                            model.pageLayout.apply(draft)
                        }
                        edit { $0.showNumber = on }
                    }))
                if design.showNumber { numbering(book) }
                Toggle("Title", isOn: bind(\.showTitle))
                Toggle("Subtitle", isOn: bind(\.showSubtitle))
                Toggle("Each Chapter’s Picture", isOn: bind(\.showImage))
                Picker("Alignment", selection: bind(\.alignment)) {
                    Label("Left", systemImage: "text.alignleft").tag(HeadAlignment.left)
                    Label("Centre", systemImage: "text.aligncenter").tag(HeadAlignment.center)
                    Label("Right", systemImage: "text.alignright").tag(HeadAlignment.right)
                }
                .pickerStyle(.segmented)
                if design.showNumber {
                    casePicker("Number Set In", bind(\.numberCase))
                    points("Number Size", bind(\.numberSizePt))
                }
                if design.showTitle {
                    casePicker("Title Set In", bind(\.titleCase))
                    points("Title Size", bind(\.titleSizePt))
                }
                Toggle("A Face of Its Own", isOn: Binding(
                    get: { design.headingFont != nil },
                    set: { on in edit { $0.headingFont = on ? (model.pageLayout.setup?.typography?.fontFamily ?? "Georgia, serif") : nil } }))
                if let face = design.headingFont {
                    LabeledContent("Heading Face") {
                        FontFamilyPopUp(selection: CSSFamily.primary(face)) { name in
                            edit { $0.headingFont = TypographyDraft.cssFamily(name) }
                        }
                    }
                }
                ornament(design)
                opening()
            } footer: {
                FinishingNote("Every chapter opens this way, in the Typeset pages, in print and in every export. A chapter’s own subtitle, picture and epigraph are under This Page.")
            }
        }
    }

    /* ---------------- the pieces ---------------- */

    @ViewBuilder
    private func numbering(_ book: BookDraft) -> some View {
        Picker("Numbered", selection: bookBinding(\.numbering)) {
            Text("One, Two, Three").tag(ChapterNumberStyle.words)
            Text("1, 2, 3").tag(ChapterNumberStyle.numerals)
            Text("I, II, III").tag(ChapterNumberStyle.roman)
        }
        CommitTextField("Before the Number", text: bookBinding(\.numberPrefix), prompt: "Chapter")
        Picker("First Chapter", selection: bookBinding(\.startAt)) {
            Text("1").tag(1)
            Text("0").tag(0)
        }
        .pickerStyle(.segmented)
        LabeledContent("Heading") {
            Text(BookSections.label(max(book.startAt, 0) == 0 ? 0 : 3, book))
                .font(.system(.callout, design: .serif))
        }
    }

    @ViewBuilder
    private func ornament(_ design: ChapterDesignDraft) -> some View {
        Picker("Ornament", selection: bind(\.ornament)) {
            Text("None").tag(OrnamentKind.none)
            Text("A Rule").tag(OrnamentKind.rule)
            Text("A Glyph").tag(OrnamentKind.glyph)
            Text("A Picture").tag(OrnamentKind.image)
        }
        if design.ornament == .glyph {
            LabeledContent("Glyph") {
                HStack(spacing: 4) {
                    CommitTextField("Glyph", text: bind(\.ornamentGlyph), prompt: "❦")
                        .labelsHidden()
                        .multilineTextAlignment(.center)
                        .frame(width: FinishingMetrics.numberWidth + 20)
                    Menu {
                        ForEach(Self.glyphs, id: \.self) { glyph in Button(glyph) { edit { $0.ornamentGlyph = glyph } } }
                    } label: { Image(systemName: "chevron.up.chevron.down") }
                        .menuStyle(.borderlessButton)
                        .menuIndicator(.hidden)
                        .fixedSize()
                }
            }
        }
        if design.ornament == .image {
            LabeledContent("Picture") {
                HStack(spacing: 8) {
                    if let file = model.pageLayout.state?.ornamentImageFile, let image = NSImage(contentsOfFile: file) {
                        Image(nsImage: image).resizable().aspectRatio(contentMode: .fit).frame(width: 40, height: 24)
                    }
                    Button(design.ornamentImage == nil ? "Choose…" : "Change…") { choose(.ornament) }
                    if design.ornamentImage != nil {
                        Button("Remove", role: .destructive) { model.pageLayout.setHeadImage(.ornament, url: nil) }
                    }
                }
            }
        }
        if design.ornament != .none || design.showImage {
            Picker("Ornament and Picture", selection: bind(\.ornamentPosition)) {
                Text("Above the Number").tag(OrnamentPosition.above)
                Text("Between Number and Title").tag(OrnamentPosition.between)
                Text("Below the Title").tag(OrnamentPosition.below)
            }
            LabeledContent("Picture Width") {
                HStack(spacing: 4) {
                    CommittingNumberText(value: bind(\.imageWidthPct), fractionDigits: 0)
                        .frame(width: FinishingMetrics.numberWidth)
                    Text("%").foregroundStyle(.secondary).frame(width: FinishingMetrics.unitWidth, alignment: .leading)
                }
            }
        }
    }

    /// How the first paragraph opens and how far down the head sits: the type's, so only
    /// with type set for print.
    @ViewBuilder
    private func opening() -> some View {
        let layout = model.pageLayout
        if let setup = layout.setup, let t = setup.typography {
            Picker("First Paragraph", selection: Binding(
                get: { t.chapterOpening },
                set: { value in edit(setup) { $0.chapterOpening = value } })) {
                Text("Plain").tag(ChapterOpening.plain)
                Text("Drop Cap").tag(ChapterOpening.dropCap)
                Text("Small Caps").tag(ChapterOpening.smallCaps)
                Text("Drop Cap & Small Caps").tag(ChapterOpening.dropCapAndSmallCaps)
            }
            LengthField("Head Down the Page", millimeters: Binding(
                get: { t.chapterSinkMm },
                set: { value in edit(setup) { $0.chapterSinkMm = value } }), unit: unit)
                .help("How far down its page a chapter’s head sits, from the top margin")
        } else {
            FinishingNote("Set type for print, under Body Text, for a drop cap and to set how far down the page each chapter opens.")
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

    private func points(_ title: String, _ value: Binding<Double>) -> some View {
        LabeledContent(title) {
            HStack(spacing: 4) {
                CommittingNumberText(value: value, fractionDigits: 1)
                    .frame(width: FinishingMetrics.numberWidth)
                Text("pt").foregroundStyle(.secondary).frame(width: FinishingMetrics.unitWidth, alignment: .leading)
            }
        }
    }

    static let glyphs = ["❦", "❧", "⁂", "✦", "❖", "§", "~", "* * *"]

    /* ---------------- editing ---------------- */

    private func edit(_ change: (inout ChapterDesignDraft) -> Void) {
        guard var book = model.pageLayout.book else { return }
        var design = ChapterDesignDraft(book.chapterDesign)
        change(&design)
        guard design.design != book.chapterDesign else { return }
        book.chapterDesign = design.design
        model.pageLayout.apply(book)
    }

    private func edit(_ setup: PageSetupDraft, _ change: (inout TypographyDraft) -> Void) {
        guard var t = setup.typography else { return }
        change(&t)
        var draft = setup
        draft.typography = t
        model.pageLayout.apply(draft)
    }

    private func bind<T: Equatable>(_ keyPath: WritableKeyPath<ChapterDesignDraft, T>) -> Binding<T> {
        Binding(
            get: { ChapterDesignDraft(model.pageLayout.book?.chapterDesign)[keyPath: keyPath] },
            set: { value in edit { $0[keyPath: keyPath] = value } })
    }

    private func bookBinding<T: Equatable>(_ keyPath: WritableKeyPath<BookDraft, T>) -> Binding<T> {
        let layout = model.pageLayout
        return Binding(
            get: { layout.book?[keyPath: keyPath] ?? BookDraft(layout.state!.book)[keyPath: keyPath] },
            set: { value in
                guard var draft = layout.book, draft[keyPath: keyPath] != value else { return }
                draft[keyPath: keyPath] = value
                layout.apply(draft)
            })
    }

    private func choose(_ target: HeadImageTarget) {
        Self.choosePicture(message: target == .ornament ? "Choose a picture every chapter’s head carries" : "Choose a picture for this chapter’s head") {
            model.pageLayout.setHeadImage(target, url: $0)
        }
    }

    static func choosePicture(message: String, then use: (URL) -> Void) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = false
        panel.message = message
        panel.prompt = "Use Picture"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        use(url)
    }
}

/// A `ChapterDesign` as something controls can write to; a book with none reads as the
/// page's default design.
struct ChapterDesignDraft: Equatable {
    var showNumber = false
    var showTitle = true
    var showSubtitle = true
    var showImage = true
    var ornament = OrnamentKind.none
    var ornamentGlyph = ""
    var ornamentImage: String?
    var ornamentPosition = OrnamentPosition.above
    var imageWidthPct = 40.0
    var alignment = HeadAlignment.center
    var numberCase = HeadCase.asWritten
    var titleCase = HeadCase.asWritten
    var headingFont: String?
    var numberSizePt = 12.0
    var titleSizePt = 20.0
    var chapterBreak = ChapterBreak.newPage
    var styleId: String?

    init(_ d: ChapterDesign?) {
        guard let d else { return }
        showNumber = d.showNumber
        showTitle = d.showTitle
        showSubtitle = d.showSubtitle
        showImage = d.showImage
        ornament = d.ornament
        ornamentGlyph = d.ornamentGlyph
        ornamentImage = d.ornamentImage
        ornamentPosition = d.ornamentPosition
        imageWidthPct = d.imageWidthPct
        alignment = d.alignment
        numberCase = d.numberCase
        titleCase = d.titleCase
        headingFont = d.headingFont
        numberSizePt = d.numberSizePt
        titleSizePt = d.titleSizePt
        chapterBreak = d.chapterBreak
        styleId = d.styleId
    }

    var design: ChapterDesign {
        ChapterDesign(
            showNumber: showNumber, showTitle: showTitle, showSubtitle: showSubtitle, showImage: showImage,
            ornament: ornament, ornamentGlyph: ornamentGlyph, ornamentImage: ornamentImage,
            ornamentPosition: ornamentPosition, imageWidthPct: min(100, max(5, imageWidthPct)),
            alignment: alignment, numberCase: numberCase, titleCase: titleCase, headingFont: headingFont,
            numberSizePt: min(96, max(5, numberSizePt)), titleSizePt: min(96, max(5, titleSizePt)),
            chapterBreak: chapterBreak, styleId: styleId)
    }
}
