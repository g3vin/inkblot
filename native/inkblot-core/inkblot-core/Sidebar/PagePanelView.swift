import SwiftUI

/// The inspector's Page tab: Print Layout's view controls, the document's page setup,
/// and the book it belongs to — its metadata, how it is bound, and printing and export.
///
/// Every control edits a draft of what the page published and sends the whole value
/// back. A choice (a picker, a toggle) applies at once; typed text applies when it is
/// committed, so a running head typed letter by letter is one undo step in the
/// document, not twenty.
struct PagePanelView: View {
    @Environment(AppModel.self) private var model
    @AppStorage("inkblot.pageUnits") private var unitsRaw = LengthUnit.defaultForLocale.rawValue
    @State private var setup: PageSetupDraft?
    @State private var book: BookDraft?
    @State private var goTo = 1

    private var units: LengthUnit { LengthUnit(rawValue: unitsRaw) ?? .inches }

    var body: some View {
        let layout = model.pageLayout
        Group {
            if let state = layout.state, state.docPath != nil {
                Form {
                    // Print Layout itself is switched on and off from the editor's
                    // bottom-left corner (`PrintLayoutControls`).
                    if state.enabled { viewSection(state) }
                    if setup != nil { pageSections(state) }
                    if book != nil { bookSections(state) }
                    printSection(state)
                }
                .formStyle(.grouped)
            } else {
                ContentUnavailableView(
                    "No Document",
                    systemImage: "doc.richtext",
                    description: Text("Open a document to set up its pages, print it, or export it."))
            }
        }
        .onAppear(perform: sync)
        .onChange(of: layout.state?.setup) { sync() }
        .onChange(of: layout.state?.book) { sync() }
        .onChange(of: layout.state?.docPath) { sync() }
    }

    private func sync() {
        guard let state = model.pageLayout.state else { return }
        setup = PageSetupDraft(state.setup)
        book = BookDraft(state.book)
    }

    /* ---------------- bindings that apply ---------------- */

    /// A binding into the setup draft that sends the result when it changes.
    private func setupBinding<T: Equatable>(_ keyPath: WritableKeyPath<PageSetupDraft, T>) -> Binding<T> {
        Binding(
            get: { setup?[keyPath: keyPath] ?? PageSetupDraft(model.pageLayout.state!.setup)[keyPath: keyPath] },
            set: { value in
                guard var draft = setup, draft[keyPath: keyPath] != value else { return }
                draft[keyPath: keyPath] = value
                setup = draft
                model.pageLayout.apply(draft)
            })
    }

    private func bookBinding<T: Equatable>(_ keyPath: WritableKeyPath<BookDraft, T>) -> Binding<T> {
        Binding(
            get: { book?[keyPath: keyPath] ?? BookDraft(model.pageLayout.state!.book)[keyPath: keyPath] },
            set: { value in
                guard var draft = book, draft[keyPath: keyPath] != value else { return }
                draft[keyPath: keyPath] = value
                book = draft
                model.pageLayout.apply(draft)
            })
    }

    private func length(_ keyPath: WritableKeyPath<PageSetupDraft, Double>) -> Binding<Double> {
        let mm = setupBinding(keyPath)
        return Binding(get: { units.fromMm(mm.wrappedValue) }, set: { mm.wrappedValue = units.toMm($0) })
    }

    /* ---------------- sections ---------------- */

    @ViewBuilder
    private func viewSection(_ state: PageLayoutState) -> some View {
        let layout = model.pageLayout
        Section {
            LabeledContent("Pages", value: "\(state.pageCount)")
            HStack {
                Text("Zoom")
                Spacer()
                Menu("\(Int((state.zoom * 100).rounded()))%") {
                    Button("Fit Width") { layout.fit(.width) }
                    Button("Fit Page") { layout.fit(.page) }
                    Button("Actual Size") { layout.fit(.actual) }
                    Divider()
                    ForEach([0.5, 0.75, 1, 1.25, 1.5, 2, 3], id: \.self) { z in
                        Button("\(Int(z * 100))%") { layout.zoom(z) }
                    }
                }
                .fixedSize()
            }
            HStack {
                Text("Go to Page")
                Spacer()
                TextField("", value: $goTo, format: .number)
                    .frame(width: 56)
                    .multilineTextAlignment(.trailing)
                    .onSubmit { layout.goToPage(goTo) }
                Button("Go") { layout.goToPage(goTo) }
            }
        } footer: {
            Text("100% is the page at its printed size in CSS inches. Actual Size matches a ruler held to this display.")
        }
    }

    @ViewBuilder
    private func pageSections(_ state: PageLayoutState) -> some View {
        Section("Page") {
            Picker("Size", selection: Binding(
                get: { setup?.presetId ?? "custom" },
                set: { id in
                    guard var draft = setup, let preset = state.presets.first(where: { $0.id == id }) else { return }
                    draft.choose(preset)
                    setup = draft
                    model.pageLayout.apply(draft)
                })
            ) {
                ForEach(groupedPresets(state.presets), id: \.0) { group, presets in
                    Section(group) {
                        ForEach(presets, id: \.id) { preset in
                            Text("\(preset.label) — \(units.describe(preset.widthMm)) × \(units.describe(preset.heightMm))").tag(preset.id)
                        }
                    }
                }
                Text("Custom").tag("custom")
            }
            HStack {
                LengthField("Width", value: sizeBinding(\.widthMm), unit: units)
                LengthField("Height", value: sizeBinding(\.heightMm), unit: units)
            }
            Picker("Orientation", selection: setupBinding(\.landscape)) {
                Text("Portrait").tag(false)
                Text("Landscape").tag(true)
            }
            .pickerStyle(.segmented)
            Picker("Units", selection: $unitsRaw) {
                ForEach(LengthUnit.allCases) { Text($0.label).tag($0.rawValue) }
            }
            Button("Set Up as a Book") {
                guard var draft = setup else { return }
                draft.makeBook()
                setup = draft
                model.pageLayout.apply(draft)
            }
            .help("Mirrored margins with a gutter, the title and chapter as running heads, chapters opening on a right-hand page.")
        }

        Section {
            HStack {
                LengthField("Top", value: length(\.topMm), unit: units)
                LengthField("Bottom", value: length(\.bottomMm), unit: units)
            }
            HStack {
                LengthField(setup?.mirrorMargins == true ? "Inside" : "Left", value: length(\.insideMm), unit: units)
                LengthField(setup?.mirrorMargins == true ? "Outside" : "Right", value: length(\.outsideMm), unit: units)
            }
            LengthField("Gutter", value: length(\.gutterMm), unit: units)
            Toggle("Mirror Margins", isOn: setupBinding(\.mirrorMargins))
            let suggested = state.suggestedInsideMarginMm
            let inside = (setup?.insideMm ?? 0) + (setup?.gutterMm ?? 0)
            if state.pageCount > 0 && inside + 0.05 < suggested {
                HStack {
                    Label("For \(state.pageCount) pages, binders suggest at least \(units.describe(suggested)) inside.", systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(.orange)
                    Button("Use") {
                        guard var draft = setup else { return }
                        draft.gutterMm = max(0, suggested - draft.insideMm)
                        setup = draft
                        model.pageLayout.apply(draft)
                    }
                }
            }
        } header: {
            Text("Margins")
        } footer: {
            Text("The gutter is added to the inside margin, where the binding takes up paper.")
        }

        Section("Columns") {
            Stepper("\(setup?.columns ?? 1) column\(setup?.columns == 1 ? "" : "s")", value: setupBinding(\.columns), in: 1...3)
            if (setup?.columns ?? 1) > 1 {
                LengthField("Gap", value: length(\.columnGapMm), unit: units)
                Text("Pages are edited as a single running column; Print, Export PDF and binding set the columns side by side.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }

        Section {
            RunningTextEditor(title: setup?.versoDiffers == true ? "Header (right-hand pages)" : "Header", value: setupBinding(\.header))
            RunningTextEditor(title: setup?.versoDiffers == true ? "Footer (right-hand pages)" : "Footer", value: setupBinding(\.footer))
            Toggle("Different on Left-Hand Pages", isOn: setupBinding(\.versoDiffers))
            if setup?.versoDiffers == true {
                RunningTextEditor(title: "Header (left-hand pages)", value: setupBinding(\.versoHeader))
                RunningTextEditor(title: "Footer (left-hand pages)", value: setupBinding(\.versoFooter))
            }
            Toggle("None on a Chapter's First Page", isOn: setupBinding(\.differentFirstPage))
            HStack {
                LengthField("From Top", value: length(\.headerDistanceMm), unit: units)
                LengthField("From Bottom", value: length(\.footerDistanceMm), unit: units)
            }
            Picker("Numbers", selection: setupBinding(\.pageNumberFormat)) {
                Text("1, 2, 3").tag(PageNumberFormat.arabic)
                Text("i, ii, iii").tag(PageNumberFormat.lowerRoman)
                Text("I, II, III").tag(PageNumberFormat.upperRoman)
            }
            Stepper("Start at \(setup?.pageNumberStart ?? 1)", value: setupBinding(\.pageNumberStart), in: 0...9999)
        } header: {
            Text("Header & Footer")
        } footer: {
            Text("Use {page}, {pages}, {title}, {chapter} and {author}. The chapter is the most recent Heading 1.")
        }

        Section("Text Flow") {
            Stepper(widowLabel, value: setupBinding(\.widowOrphanLines), in: 1...5)
            Toggle("Chapters Open on a Right-Hand Page", isOn: setupBinding(\.chapterStartsOnRecto))
            HStack {
                Button("Page Break") { model.pageLayout.insertBreak(.page, target: model.target) }
                Button("Column Break") { model.pageLayout.insertBreak(.column, target: model.target) }
                Button("Next Right-Hand") { model.pageLayout.insertBreak(.recto, target: model.target) }
            }
            .disabled(model.target == nil)
        }
    }

    private var widowLabel: String {
        let n = setup?.widowOrphanLines ?? 2
        return n <= 1 ? "Widows & orphans allowed" : "Keep at least \(n) lines together"
    }

    /// Width and height edit the portrait size; a typed size is a custom one unless it
    /// matches a preset.
    private func sizeBinding(_ keyPath: WritableKeyPath<PageSetupDraft, Double>) -> Binding<Double> {
        Binding(
            get: { units.fromMm(setup?[keyPath: keyPath] ?? 0) },
            set: { value in
                guard var draft = setup else { return }
                draft[keyPath: keyPath] = units.toMm(value)
                let match = model.pageLayout.state?.presets.first {
                    abs($0.widthMm - draft.widthMm) < 0.5 && abs($0.heightMm - draft.heightMm) < 0.5
                }
                draft.presetId = match?.id ?? "custom"
                setup = draft
                model.pageLayout.apply(draft)
            })
    }

    @ViewBuilder
    private func bookSections(_ state: PageLayoutState) -> some View {
        Section {
            CommitTextField("Title", text: bookBinding(\.title))
            CommitTextField("Author", text: bookBinding(\.author))
            CommitTextField("Language", text: bookBinding(\.language))
            LabeledContent("Chapters", value: "\(state.bookChapters.count) document\(state.bookChapters.count == 1 ? "" : "s")")
        } header: {
            Text("Book")
        } footer: {
            Text("A book is this document's folder, its documents in the order the file tree shows. Title and author go on the running heads, the EPUB and the PDF.")
        }

        Section {
            Picker("Binding", selection: bookBinding(\.binding)) {
                Text("Sewn Signatures").tag(BindingType.signatures)
                Text("Saddle Stitch (Booklet)").tag(BindingType.saddle)
                Text("Perfect Bound").tag(BindingType.perfect)
                Text("None").tag(BindingType.none)
            }
            if book?.binding == .signatures {
                Stepper(
                    "\(book?.sheetsPerSignature ?? 4) sheets · \((book?.sheetsPerSignature ?? 4) * 4) pages per signature",
                    value: bookBinding(\.sheetsPerSignature), in: 1...8)
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(state.signatureAdvice, id: \.sheets) { advice in
                        Text(advice.label)
                            .font(.caption)
                            .foregroundStyle(Int(advice.sheets) == book?.sheetsPerSignature ? .primary : .secondary)
                    }
                }
            }
            if book?.binding != BindingType.none {
                Picker("Sheet", selection: bookBinding(\.sheetPresetId)) {
                    ForEach(["letter", "a4", "legal", "tabloid", "a3"], id: \.self) { id in
                        Text(state.presets.first { $0.id == id }?.label ?? id).tag(id)
                    }
                }
                Picker("Pages on the Sheet", selection: bookBinding(\.sheetFit)) {
                    Text("Actual Size, with Crop Marks").tag(SheetFit.actualSize)
                    Text("Scale to Fit").tag(SheetFit.fit)
                }
                Picker("Double-Sided", selection: bookBinding(\.duplex)) {
                    Text("Printer Does Both Sides").tag(DuplexMode.automatic)
                    Text("Manual: Fronts, Then Backs").tag(DuplexMode.manual)
                }
                LabeledContent("Paper Thickness") {
                    TextField("", value: bookBinding(\.paperThicknessMm), format: .number.precision(.fractionLength(0...3)))
                        .frame(width: 64)
                        .multilineTextAlignment(.trailing)
                    Text("mm").foregroundStyle(.secondary)
                }
                Toggle("Crop and Fold Marks", isOn: bookBinding(\.cropMarks))
                Toggle("Print a Folding Guide", isOn: bookBinding(\.includeGuide))
            }
        } header: {
            Text("Binding")
        } footer: {
            Text("Pages are laid two to a sheet side in the order that, printed double-sided (flip on the short edge), folded and nested, reads in sequence. Paper thickness moves inner pages toward the spine to allow for creep.")
        }
    }

    @ViewBuilder
    private func printSection(_ state: PageLayoutState) -> some View {
        let layout = model.pageLayout
        Section("Print & Export") {
            Button("Print…") { layout.print(.document) }
            Button("Print Book…") { layout.print(.folder) }
            Button("Print Book for Binding…") { layout.print(.folder, bound: true) }
                .disabled(book?.binding == BindingType.none)
            Menu("Export") {
                Button("PDF…") { layout.export(.pdf, scope: .document) }
                Button("EPUB…") { layout.export(.epub, scope: .document) }
                Button("Markdown…") { layout.export(.markdown, scope: .document) }
                Button("HTML…") { layout.export(.html, scope: .document) }
            }
            Menu("Export Book") {
                Button("PDF…") { layout.export(.pdf, scope: .folder) }
                Button("PDF for Binding…") { layout.export(.pdf, scope: .folder, bound: true) }
                Button("EPUB…") { layout.export(.epub, scope: .folder) }
                Button("Markdown…") { layout.export(.markdown, scope: .folder) }
                Button("HTML…") { layout.export(.html, scope: .folder) }
            }
        }
    }

    private func groupedPresets(_ presets: [PageSizeOption]) -> [(String, [PageSizeOption])] {
        var order: [String] = []
        var groups: [String: [PageSizeOption]] = [:]
        for preset in presets {
            if groups[preset.group] == nil { order.append(preset.group) }
            groups[preset.group, default: []].append(preset)
        }
        return order.map { ($0, groups[$0] ?? []) }
    }
}

/* ---------------- controls ---------------- */

/// Units for the Page tab. Stored in millimetres always; shown in the author's.
enum LengthUnit: String, CaseIterable, Identifiable {
    case inches = "in", millimetres = "mm", centimetres = "cm", points = "pt"
    var id: String { rawValue }

    var label: String {
        switch self {
        case .inches: "Inches"
        case .millimetres: "Millimetres"
        case .centimetres: "Centimetres"
        case .points: "Points"
        }
    }

    private var perMm: Double {
        switch self {
        case .inches: 1 / 25.4
        case .millimetres: 1
        case .centimetres: 0.1
        case .points: 72 / 25.4
        }
    }

    func fromMm(_ mm: Double) -> Double { mm * perMm }
    func toMm(_ value: Double) -> Double { value / perMm }

    func describe(_ mm: Double) -> String {
        let value = fromMm(mm)
        let digits = self == .inches ? 3 : (self == .points ? 1 : 1)
        return "\(value.formatted(.number.precision(.fractionLength(0...digits)))) \(rawValue)"
    }

    /// Inches where the paper is Letter, millimetres everywhere else.
    static var defaultForLocale: LengthUnit {
        Locale.current.measurementSystem == .us ? .inches : .millimetres
    }
}

private struct LengthField: View {
    let title: String
    @Binding var value: Double
    let unit: LengthUnit

    init(_ title: String, value: Binding<Double>, unit: LengthUnit) {
        self.title = title
        self._value = value
        self.unit = unit
    }

    var body: some View {
        LabeledContent(title) {
            HStack(spacing: 4) {
                TextField("", value: $value, format: .number.precision(.fractionLength(0...3)))
                    .frame(width: 60)
                    .multilineTextAlignment(.trailing)
                Text(unit.rawValue).foregroundStyle(.secondary)
            }
        }
    }
}

/// A text field that applies what was typed when it is committed — return, or focus
/// leaving it — rather than on every keystroke.
private struct CommitTextField: View {
    let title: String
    @Binding var text: String
    @State private var draft = ""
    @FocusState private var focused: Bool

    init(_ title: String, text: Binding<String>) {
        self.title = title
        self._text = text
    }

    var body: some View {
        TextField(title, text: $draft)
            .focused($focused)
            .onAppear { draft = text }
            .onChange(of: text) { if !focused { draft = text } }
            .onSubmit { text = draft }
            .onChange(of: focused) { if !focused && draft != text { text = draft } }
    }
}

private struct RunningTextEditor: View {
    let title: String
    @Binding var value: RunningTextDraft

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            HStack(spacing: 6) {
                CommitTextField("Left", text: $value.left)
                CommitTextField("Centre", text: $value.center)
                CommitTextField("Right", text: $value.right)
            }
            .textFieldStyle(.roundedBorder)
            .labelsHidden()
        }
    }
}
