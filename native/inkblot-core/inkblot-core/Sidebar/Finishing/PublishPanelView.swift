import SwiftUI

/// The Finishing layout's Publish tab: getting the writing out.
///
/// Print and Export are in the header, as on every Finishing tab; here is what shapes
/// them: the book checked against a print-on-demand service — its pages, spine and
/// anything the service would reject, each with a fix — and printing sheets to fold
/// and bind by hand, which stays out of the way until it is switched on. Writing
/// statistics are the Stats tab's; these are the figures of the printed thing.
struct PublishPanelView: View {
    @Environment(AppModel.self) private var model
    @AppStorage(LengthUnit.storageKey) private var unitsRaw = LengthUnit.defaultForLocale.rawValue

    private var units: LengthUnit { LengthUnit(rawValue: unitsRaw) ?? .inches }

    var body: some View {
        FinishingPanel {
            if let state = model.pageLayout.state, let book = model.pageLayout.book {
                // Only for a screenplay or a play: a novelist never sees it.
                if let script = state.script {
                    ScriptProductionSection(script: script)
                }
                publishingSection(state, book)
                bindingSection(state, book)
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

    /* ---------------- publishing ---------------- */

    @ViewBuilder
    private func publishingSection(_ state: PageLayoutState, _ book: BookDraft) -> some View {
        let layout = model.pageLayout
        let report = state.publishing
        FinishingSection("Publishing", id: FinishingSectionID.publishing) {
            Picker("Printed By", selection: binding(\.service)) {
                Text("Not Chosen").tag(PublishingService.none)
                Divider()
                Text("Amazon KDP").tag(PublishingService.kdp)
                Text("IngramSpark").tag(PublishingService.ingramSpark)
            }
            Picker("Paper", selection: binding(\.paper)) {
                Text("Cream").tag(PaperStock.cream)
                Text("White").tag(PaperStock.white)
                Text("Colour").tag(PaperStock.color)
            }
            LabeledContent("Pages") {
                HStack(spacing: 8) {
                    if let report, report.pageCount > 0 {
                        Text("\(report.pageCount)\(report.measured ? "" : " on screen")").monospacedDigit()
                    } else {
                        Text("Not counted").foregroundStyle(.secondary)
                    }
                    MeasureButton(report: report, measure: layout.measure)
                }
            }
            if let report, report.words > 0 {
                LabeledContent("Words") { Text(report.words.formatted()).monospacedDigit() }
                LabeledContent("Reading Time") { Text(Self.duration(Int(report.readingMinutes))) }
            }
            if let report, report.pageCount > 0 {
                LabeledContent("Spine") {
                    Text(units.describe(report.spineWidthMm)).monospacedDigit()
                }
                FinishingNote(report.spineText
                    ? "Wide enough for the title on the spine. Check the service’s cover calculator before the cover goes out."
                    : "Under 80 pages the spine is too thin for text. Check the service’s cover calculator before the cover goes out.")
            }
            if book.service != PublishingService.none {
                let issues = report?.issues ?? []
                if issues.isEmpty {
                    Label(report?.pageCount ?? 0 > 0 ? "Ready for the printer." : "The setup passes. Count the pages to check the rest.", systemImage: "checkmark.seal")
                        .foregroundStyle(.green)
                } else {
                    ForEach(issues, id: \.id) { issue in
                        PreflightRow(issue: issue) { layout.fix(issue) }
                    }
                }
            }
        } footer: {
            FinishingNote(state.scope == .document
                ? "For this document. Choose Book in the header to check the whole book."
                : "For the whole book, at its page setup. Count the pages after changing the text or the setup.")
        }
    }

    static func duration(_ minutes: Int) -> String {
        guard minutes >= 60 else { return "\(max(1, minutes)) min" }
        let hours = minutes / 60
        let rest = minutes % 60
        return rest == 0 ? "\(hours) hr" : "\(hours) hr \(rest) min"
    }

    /* ---------------- binding ---------------- */

    @ViewBuilder
    private func bindingSection(_ state: PageLayoutState, _ book: BookDraft) -> some View {
        let layout = model.pageLayout
        let presets = layout.catalog?.presets ?? []
        FinishingSection("Hand Binding", id: FinishingSectionID.binding) {
            Toggle("Print for Hand Binding", isOn: Binding(
                get: { book.binding != BindingType.none },
                set: { binding(\.binding).wrappedValue = $0 ? .signatures : BindingType.none }))
            if book.binding != BindingType.none {
                Picker("Binding", selection: binding(\.binding)) {
                    Text("Sewn Signatures").tag(BindingType.signatures)
                    Text("Saddle Stitch (Booklet)").tag(BindingType.saddle)
                    Text("Perfect Bound").tag(BindingType.perfect)
                }
                if book.binding == .signatures {
                    Picker("Signature", selection: binding(\.sheetsPerSignature)) {
                        ForEach(1...8, id: \.self) { n in
                            Text("\(n) sheet\(n == 1 ? "" : "s") · \(n * 4) pages").tag(n)
                        }
                    }
                    if let advice = layout.catalog?.signatureAdvice.first(where: { Int($0.sheets) == book.sheetsPerSignature }) {
                        FinishingNote(advice.label)
                    }
                }
                Picker("Sheet", selection: binding(\.sheetPresetId)) {
                    ForEach(["letter", "a4", "legal", "tabloid", "a3"], id: \.self) { id in
                        Text(presets.first { $0.id == id }?.label ?? id).tag(id)
                    }
                }
                Picker("Pages on the Sheet", selection: binding(\.sheetFit)) {
                    Text("Actual Size, with Crop Marks").tag(SheetFit.actualSize)
                    Text("Scaled to Fit").tag(SheetFit.fit)
                }
                Picker("Double-Sided", selection: binding(\.duplex)) {
                    Text("Printer Does Both Sides").tag(DuplexMode.automatic)
                    Text("By Hand: Fronts, Then Backs").tag(DuplexMode.manual)
                }
                LengthField(
                    "Paper Thickness", millimeters: binding(\.paperThicknessMm), unit: units,
                    fractionDigits: units == .inches ? 4 : 2)
                Toggle("Crop and Fold Marks", isOn: binding(\.cropMarks))
                Toggle("Add a Folding Guide", isOn: binding(\.includeGuide))
                HStack {
                    Button("Print for Binding…") { layout.print(bindingScope(state), bound: true) }
                    Button("Export PDF…") { layout.export(.pdf, scope: bindingScope(state), bound: true) }
                }
            }
        } footer: {
            FinishingNote(book.binding == BindingType.none
                ? "Lays the book’s pages out on sheets to fold, nest and sew or staple — for making a book at home."
                : "Printed double-sided (flip on the short edge), folded and nested, the sheets read in order. Paper thickness moves inner pages toward the spine to allow for creep.")
        }
    }

    /// Binding is for a book: the document's folder unless the whole project is chosen.
    private func bindingScope(_ state: PageLayoutState) -> PrintScope {
        state.scope == .project ? .project : .folder
    }
}

/// Count the pages: spins until the new count arrives.
private struct MeasureButton: View {
    let report: PublishingReport?
    let measure: () -> Void
    @State private var counting = false

    var body: some View {
        Group {
            if counting {
                ProgressView().controlSize(.small)
            } else {
                Button(report?.measured == true ? "Recount" : "Count") {
                    counting = true
                    measure()
                }
                .controlSize(.small)
                .help("Lay out everything Print covers, as it would print, to count its pages and words")
            }
        }
        .onChange(of: report) { counting = false }
        .task(id: counting) {
            // Never spin for ever: a count that failed says so in the header.
            guard counting else { return }
            try? await Task.sleep(for: .seconds(120))
            counting = false
        }
    }
}

/// One preflight finding: how much it matters, what it is, and its fix.
private struct PreflightRow: View {
    let issue: PreflightIssue
    let fix: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label {
                Text(issue.message).fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: symbol).foregroundStyle(tint)
            }
            if let label = issue.fixLabel, issue.fixedSetup != nil {
                Button(label, action: fix)
                    .controlSize(.small)
                    .padding(.leading, 26)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var symbol: String {
        switch issue.severity {
        case .error: "xmark.octagon.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .note: "info.circle.fill"
        }
    }

    private var tint: Color {
        switch issue.severity {
        case .error: .red
        case .warning: .orange
        case .note: .secondary
        }
    }
}
