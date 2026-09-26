import SwiftUI

/// The Finishing layout's Page tab: how the pages look.
///
/// Format first — a whole setup by name, which is all most writers need — then the
/// parts of it: the page and its margins, the header and footer, and how text flows
/// across pages. Under the Book scope it edits the setup every chapter prints in.
///
/// Every control edits the model's draft and sends the whole value back. A choice (a
/// picker, a toggle) applies at once; typed text applies when it is committed, so a
/// running head typed letter by letter is one undo step in the document, not twenty.
struct PagePanelView: View {
    @Environment(AppModel.self) private var model
    @AppStorage(LengthUnit.storageKey) private var unitsRaw = LengthUnit.defaultForLocale.rawValue

    @State private var editingAuthor = false

    private var units: LengthUnit { LengthUnit(rawValue: unitsRaw) ?? .inches }

    var body: some View {
        FinishingPanel {
            if let state = model.pageLayout.state, let setup = model.pageLayout.setup {
                formatSection(state, setup)
                pageSection(state, setup)
                headerFooterSection(state, setup)
                TypographySection(
                    setup: setup, unit: units,
                    defaultTypography: model.pageLayout.catalog?.defaultTypography,
                    apply: model.pageLayout.apply)
                TitlePageSection(setup: setup, apply: model.pageLayout.apply) { editingAuthor = true }
                textFlowSection(setup)
            }
        }
        .sheet(isPresented: $editingAuthor) {
            AuthorProfileSheet(profile: model.pageLayout.state?.author ?? AuthorProfile.empty) { model.pageLayout.setAuthor($0) }
        }
    }

    /* ---------------- bindings that apply ---------------- */

    /// A binding into the setup draft that sends the result when it changes.
    private func binding<T: Equatable>(_ keyPath: WritableKeyPath<PageSetupDraft, T>) -> Binding<T> {
        let layout = model.pageLayout
        return Binding(
            get: { layout.setup?[keyPath: keyPath] ?? PageSetupDraft(DefaultSetup.value)[keyPath: keyPath] },
            set: { value in
                guard var draft = layout.setup, draft[keyPath: keyPath] != value else { return }
                draft[keyPath: keyPath] = value
                layout.apply(draft)
            })
    }

    private func edit(_ change: (inout PageSetupDraft) -> Void) {
        guard var draft = model.pageLayout.setup else { return }
        change(&draft)
        model.pageLayout.apply(draft)
    }

    /* ---------------- format ---------------- */

    @ViewBuilder
    private func formatSection(_ state: PageLayoutState, _ setup: PageSetupDraft) -> some View {
        let layout = model.pageLayout
        let formats = layout.catalog?.formats ?? []
        let current = layout.editsBook ? layout.format(setup.formatId) : layout.format(state.formatId)
        Section {
            if layout.editsBook {
                Label("Editing the setup every chapter of the book prints in.", systemImage: "books.vertical")
                    .font(.callout)
                    .foregroundStyle(.tint)
            }
            Picker("Format", selection: Binding(
                get: { current?.id ?? "custom" },
                set: { id in if id != "custom" { layout.applyFormat(id) } }
            )) {
                ForEach(PageLayoutModel.grouped(formats, by: \.group), id: \.0) { group, items in
                    Section(group) {
                        ForEach(items, id: \.id) { Text($0.label).tag($0.id) }
                    }
                }
                if current == nil { Text("Custom").tag("custom") }
            }
            if let current {
                // The page reports "modified" for the setup it resolved: the book's own
                // when that is what the document shows, the document's otherwise.
                let modified = !layout.editsBook || state.setupSource == .book ? state.formatModified : false
                if modified {
                    LabeledContent("Changed from the format") {
                        Button("Reset") { layout.applyFormat(current.id) }
                    }
                } else {
                    FinishingNote(current.summary)
                }
            }
            if !layout.editsBook && state.bookSetupActive {
                FinishingNote("This book prints every chapter in a setup of its own. This one shows on screen and when the document is printed alone.")
                Button("Edit the Book’s Setup") { layout.setScope(.folder) }
            }
        }
    }

    /* ---------------- page and margins ---------------- */

    @ViewBuilder
    private func pageSection(_ state: PageLayoutState, _ setup: PageSetupDraft) -> some View {
        let presets = model.pageLayout.catalog?.presets ?? []
        FinishingSection("Page", id: FinishingSectionID.pageSize) {
            Picker("Size", selection: Binding(
                get: { setup.presetId },
                set: { id in
                    guard let preset = presets.first(where: { $0.id == id }) else { return }
                    edit { $0.choose(preset) }
                })
            ) {
                ForEach(PageLayoutModel.grouped(presets, by: \.group), id: \.0) { group, items in
                    Section(group) {
                        ForEach(items, id: \.id) { Text($0.label).tag($0.id) }
                    }
                }
                Text("Custom").tag("custom")
            }
            LengthField("Width", millimeters: sizeBinding(\.widthMm, presets), unit: units)
            LengthField("Height", millimeters: sizeBinding(\.heightMm, presets), unit: units)
            Picker("Orientation", selection: binding(\.landscape)) {
                Label("Portrait", systemImage: "rectangle.portrait").tag(false)
                Label("Landscape", systemImage: "rectangle").tag(true)
            }
            .pickerStyle(.segmented)

            VStack(alignment: .leading, spacing: 8) {
                Text("Margins")
                MarginEditor(
                    setup: setup,
                    unit: units,
                    top: marginBinding(\.topMm),
                    bottom: marginBinding(\.bottomMm),
                    inside: marginBinding(\.insideMm),
                    outside: marginBinding(\.outsideMm))
            }
            Toggle("Mirror for Facing Pages", isOn: binding(\.mirrorMargins))
                .help("Swap the left and right margins on left-hand pages, as a printed book does")
            LengthField("Gutter", millimeters: marginBinding(\.gutterMm), unit: units)
            let suggested = state.suggestedInsideMarginMm
            if state.pageCount > 0 && setup.insideMm + setup.gutterMm + 0.05 < suggested {
                VStack(alignment: .leading, spacing: 6) {
                    FinishingCaution(text: "For \(state.pageCount) pages, binders suggest at least \(units.describe(suggested)) on the inside.")
                    Button("Widen the Gutter to Fit") { edit { $0.gutterMm = max(0, suggested - $0.insideMm) } }
                        .controlSize(.small)
                }
            }

            Picker("Columns", selection: binding(\.columns)) {
                Text("1").tag(1)
                Text("2").tag(2)
                Text("3").tag(3)
            }
            .pickerStyle(.segmented)
            if setup.columns > 1 {
                LengthField("Space Between", millimeters: marginBinding(\.columnGapMm), unit: units)
                FinishingNote("You write in one running column; the columns sit side by side when printed or exported as PDF.")
            }
        } footer: {
            FinishingNote("The gutter is added to the inside margin, where the binding takes up paper.")
        }
    }

    private func marginBinding(_ keyPath: WritableKeyPath<PageSetupDraft, Double>) -> Binding<Double> {
        binding(keyPath)
    }

    /// Width and height edit the portrait size; a typed size is a custom one unless it
    /// matches a preset.
    private func sizeBinding(_ keyPath: WritableKeyPath<PageSetupDraft, Double>, _ presets: [PageSizeOption]) -> Binding<Double> {
        Binding(
            get: { model.pageLayout.setup?[keyPath: keyPath] ?? 0 },
            set: { value in
                edit { draft in
                    draft[keyPath: keyPath] = value
                    let match = presets.first { abs($0.widthMm - draft.widthMm) < 0.5 && abs($0.heightMm - draft.heightMm) < 0.5 }
                    draft.presetId = match?.id ?? "custom"
                }
            })
    }

    /* ---------------- header and footer ---------------- */

    @ViewBuilder
    private func headerFooterSection(_ state: PageLayoutState, _ setup: PageSetupDraft) -> some View {
        let tokens = model.pageLayout.catalog?.tokens ?? []
        let context = RunningPreviewContext(state: state, setup: setup)
        FinishingSection("Header & Footer", id: FinishingSectionID.headerFooter) {
            RunningTextEditor(
                title: setup.versoDiffers ? "Header, Right-Hand Pages" : "Header",
                value: binding(\.header), tokens: tokens, preview: context)
            RunningTextEditor(
                title: setup.versoDiffers ? "Footer, Right-Hand Pages" : "Footer",
                value: binding(\.footer), tokens: tokens, preview: context)
            Toggle("Different on Left-Hand Pages", isOn: binding(\.versoDiffers))
            if setup.versoDiffers {
                RunningTextEditor(title: "Header, Left-Hand Pages", value: binding(\.versoHeader), tokens: tokens, preview: context.verso)
                RunningTextEditor(title: "Footer, Left-Hand Pages", value: binding(\.versoFooter), tokens: tokens, preview: context.verso)
            }
            Toggle("None on a Chapter’s First Page", isOn: binding(\.differentFirstPage))
            LengthField("Header from Top Edge", millimeters: binding(\.headerDistanceMm), unit: units)
            LengthField("Footer from Bottom Edge", millimeters: binding(\.footerDistanceMm), unit: units)
            Picker("Page Numbers", selection: binding(\.pageNumberFormat)) {
                Text("1, 2, 3").tag(PageNumberFormat.arabic)
                Text("i, ii, iii").tag(PageNumberFormat.lowerRoman)
                Text("I, II, III").tag(PageNumberFormat.upperRoman)
            }
            NumberField("First Page Number", value: binding(\.pageNumberStart), in: PageSetupDraft.pageNumberRange)
        } footer: {
            FinishingNote("Insert page numbers, the title, the chapter, the author, the word count or the date with the ＋ menu. The chapter is the most recent Heading 1. Header and footer stay within their margins.")
        }
    }

    /* ---------------- text flow ---------------- */

    @ViewBuilder
    private func textFlowSection(_ setup: PageSetupDraft) -> some View {
        let layout = model.pageLayout
        FinishingSection("Text Flow", id: FinishingSectionID.textFlow) {
            Picker("Widow & Orphan Control", selection: binding(\.widowOrphanLines)) {
                Text("Off").tag(1)
                ForEach(2...5, id: \.self) { Text("\($0) Lines").tag($0) }
            }
            .help("The fewest lines of a paragraph left alone at the foot or the head of a page")
            Toggle("Chapters Start on a Right-Hand Page", isOn: binding(\.chapterStartsOnRecto))
            LabeledContent("Insert") {
                Menu("Break") {
                    Button("Page Break") { layout.insertBreak(.page, target: model.target) }
                    Button("Column Break") { layout.insertBreak(.column, target: model.target) }
                    Button("Break to Next Right-Hand Page") { layout.insertBreak(.recto, target: model.target) }
                }
                .fixedSize()
                .disabled(model.target == nil)
            }
        }
    }
}

/// A setup for bindings to fall back on while there is none: the page's default.
private enum DefaultSetup {
    static let value = PageSetup(
        presetId: "letter", widthMm: 215.9, heightMm: 279.4, orientation: .portrait,
        margins: PageMargins(topMm: 25.4, bottomMm: 25.4, insideMm: 25.4, outsideMm: 25.4, gutterMm: 0),
        mirrorMargins: false, columns: 1, columnGapMm: 6.35,
        header: RunningText(left: "", center: "", right: ""),
        footer: RunningText(left: "", center: "{page}", right: ""),
        versoHeader: nil, versoFooter: nil, headerDistanceMm: 12.7, footerDistanceMm: 12.7,
        differentFirstPage: false, pageNumberStart: 1, pageNumberFormat: .arabic,
        widowOrphanLines: 2, chapterStartsOnRecto: false, formatId: nil, typography: nil, titlePage: nil)
}

/* ---------------- margins ---------------- */

/// The four margins as a cross around a drawing of the page, each field where its margin
/// is. Mirrored, the drawing is a spread and the sides read Inside and Outside.
private struct MarginEditor: View {
    let setup: PageSetupDraft
    let unit: LengthUnit
    @Binding var top: Double
    @Binding var bottom: Double
    @Binding var inside: Double
    @Binding var outside: Double

    var body: some View {
        Grid(horizontalSpacing: 8, verticalSpacing: 6) {
            GridRow {
                Color.clear.gridCellUnsizedAxes([.horizontal, .vertical])
                labeled("Top") { LengthInput(millimeters: $top, unit: unit) }
                Color.clear.gridCellUnsizedAxes([.horizontal, .vertical])
            }
            GridRow {
                labeled(setup.mirrorMargins ? "Inside" : "Left") { LengthInput(millimeters: $inside, unit: unit) }
                MarginDiagram(setup: setup)
                    .frame(width: 64, height: 76)
                labeled(setup.mirrorMargins ? "Outside" : "Right") { LengthInput(millimeters: $outside, unit: unit) }
            }
            GridRow {
                Color.clear.gridCellUnsizedAxes([.horizontal, .vertical])
                labeled("Bottom") { LengthInput(millimeters: $bottom, unit: unit) }
                Color.clear.gridCellUnsizedAxes([.horizontal, .vertical])
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func labeled<Field: View>(_ title: String, @ViewBuilder field: () -> Field) -> some View {
        VStack(spacing: 2) {
            field()
            Text(title).font(.caption2).foregroundStyle(.secondary)
        }
    }
}

/// The page to scale, its text block, and the gutter shaded where the binding goes.
/// Display only: nothing here takes a drag, which would fight the inspector's swipe.
private struct MarginDiagram: View {
    let setup: PageSetupDraft

    var body: some View {
        Canvas { context, size in
            let pageW = setup.landscape ? setup.heightMm : setup.widthMm
            let pageH = setup.landscape ? setup.widthMm : setup.heightMm
            guard pageW > 0, pageH > 0 else { return }
            let scale = min(size.width / pageW, size.height / pageH)
            let page = CGRect(
                x: (size.width - pageW * scale) / 2, y: (size.height - pageH * scale) / 2,
                width: pageW * scale, height: pageH * scale)
            context.fill(Path(page), with: .color(.white))
            context.stroke(Path(page), with: .color(.secondary.opacity(0.6)), lineWidth: 0.5)

            // A recto: the inside (and gutter) on the left.
            let gutter = CGRect(x: page.minX + setup.insideMm * scale, y: page.minY, width: setup.gutterMm * scale, height: page.height)
            if setup.gutterMm > 0 { context.fill(Path(gutter), with: .color(.accentColor.opacity(0.25))) }
            let text = CGRect(
                x: page.minX + (setup.insideMm + setup.gutterMm) * scale,
                y: page.minY + setup.topMm * scale,
                width: max(0, page.width - (setup.insideMm + setup.gutterMm + setup.outsideMm) * scale),
                height: max(0, page.height - (setup.topMm + setup.bottomMm) * scale))
            // Lines of text, so the block reads as the page's writing.
            var y = text.minY + 2
            while y < text.maxY - 1 {
                context.fill(Path(CGRect(x: text.minX, y: y, width: text.width, height: 1)), with: .color(.secondary.opacity(0.45)))
                y += 3.5
            }
        }
        .accessibilityLabel("Page margins")
    }
}

/* ---------------- running text ---------------- */

/// What a running head's tokens stand for in the preview under its fields.
struct RunningPreviewContext {
    var page: Int
    var pages: Int
    var title: String
    var author: String
    var words: String
    var format: PageNumberFormat

    init(state: PageLayoutState, setup: PageSetupDraft) {
        let first = setup.pageNumberStart
        page = max(Int(state.currentPage), 1) - 1 + first
        pages = max(Int(state.pageCount), 1) - 1 + first
        let docName = state.docPath?.split(separator: "/").last.map(String.init) ?? "Title"
        title = state.scope == .document ? docName : (state.book.title.isEmpty ? docName : state.book.title)
        let name = state.scope != .document && !state.book.author.isEmpty ? state.book.author : state.author?.byline ?? ""
        author = name.isEmpty ? "Author" : name
        words = Self.describeWordCount(Int(state.wordCount ?? 0))
        format = setup.pageNumberFormat
    }

    /// The same, on a left-hand page — which has an even number.
    var verso: RunningPreviewContext {
        var copy = self
        if copy.page % 2 == 1 { copy.page += 1 }
        return copy
    }

    func resolve(_ template: String) -> String {
        template
            .replacingOccurrences(of: "{page}", with: number(page))
            .replacingOccurrences(of: "{pages}", with: number(pages))
            .replacingOccurrences(of: "{title}", with: title)
            .replacingOccurrences(of: "{chapter}", with: "Chapter")
            .replacingOccurrences(of: "{author}", with: author)
            .replacingOccurrences(of: "{surname}", with: author.split(separator: " ").last.map(String.init) ?? author)
            .replacingOccurrences(of: "{words}", with: words)
            .replacingOccurrences(of: "{date}", with: Date.now.formatted(date: .long, time: .omitted))
    }

    /// As a manuscript gives it (`roundWordCount` in pageSetup.ts): to the nearest ten,
    /// hundred or thousand by length.
    static func describeWordCount(_ words: Int) -> String {
        let step = words < 100 ? 10 : words < 17_500 ? 100 : 1000
        let rounded = Int((Double(max(0, words)) / Double(step)).rounded()) * step
        return "about \(rounded.formatted()) words"
    }

    private func number(_ n: Int) -> String {
        switch format {
        case .arabic: String(n)
        case .upperRoman: Self.roman(n)
        case .lowerRoman: Self.roman(n).lowercased()
        }
    }

    static func roman(_ value: Int) -> String {
        guard value > 0 else { return String(value) }
        let table: [(Int, String)] = [(1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"),
                                      (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")]
        var n = value
        var out = ""
        for (v, s) in table {
            while n >= v { out += s; n -= v }
        }
        return out
    }
}

/// A running head or foot: left, center and right, a menu to insert a token into
/// whichever was typed in last, and a preview of the line as it will print.
///
/// It keeps its own drafts rather than using `CommitTextField`, so a token inserted into
/// a field still being typed in joins what was typed instead of being overwritten by it
/// when the field lets go.
private struct RunningTextEditor: View {
    let title: String
    @Binding var value: RunningTextDraft
    let tokens: [RunningToken]
    let preview: RunningPreviewContext

    private enum Slot: Hashable { case left, center, right }
    @FocusState private var focused: Slot?
    @State private var lastSlot: Slot = .center
    @State private var draft = RunningTextDraft(nil)

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title)
                Spacer()
                Menu {
                    ForEach(tokens, id: \.token) { token in
                        Button(token.label) { insert(token.token) }
                    }
                } label: {
                    Image(systemName: "plus.circle")
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
                .help("Insert a page number, the title, the chapter or the author")
            }
            HStack(spacing: 6) {
                TextField("Left", text: $draft.left, prompt: Text("Left")).focused($focused, equals: .left)
                TextField("Center", text: $draft.center, prompt: Text("Center")).focused($focused, equals: .center)
                TextField("Right", text: $draft.right, prompt: Text("Right")).focused($focused, equals: .right)
            }
            .textFieldStyle(.roundedBorder)
            .labelsHidden()
            .onSubmit(commit)
            if !draft.isEmpty {
                HStack {
                    Text(preview.resolve(draft.left)).frame(maxWidth: .infinity, alignment: .leading)
                    Text(preview.resolve(draft.center)).frame(maxWidth: .infinity, alignment: .center)
                    Text(preview.resolve(draft.right)).frame(maxWidth: .infinity, alignment: .trailing)
                }
                .font(.system(size: 10, design: .serif))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(.background.secondary, in: .rect(cornerRadius: 4))
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Preview")
            }
        }
        .onAppear { draft = value }
        .onChange(of: value) { if focused == nil { draft = value } }
        .onChange(of: focused) { old, new in
            if let new { lastSlot = new }
            // Moving between the three fields is still typing the one line; leaving
            // them is when it applies.
            if new == nil, old != nil { commit() }
        }
        .onDisappear(perform: commit)
    }

    private func insert(_ token: String) {
        switch lastSlot {
        case .left: draft.left += token
        case .center: draft.center += token
        case .right: draft.right += token
        }
        commit()
    }

    private func commit() {
        if draft != value { value = draft }
    }
}
