import SwiftUI

/// The Finishing layout's Publish tab: getting the writing out.
///
/// Print and Export are in the header, as on every Finishing tab; here is what shapes
/// them — for now, printing sheets to fold and bind by hand, which stays out of the way
/// until it is switched on.
struct PublishPanelView: View {
    @Environment(AppModel.self) private var model
    @AppStorage(LengthUnit.storageKey) private var unitsRaw = LengthUnit.defaultForLocale.rawValue

    private var units: LengthUnit { LengthUnit(rawValue: unitsRaw) ?? .inches }

    var body: some View {
        FinishingPanel {
            if let state = model.pageLayout.state, let book = model.pageLayout.book {
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
