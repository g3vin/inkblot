import SwiftUI

/// Controls the Finishing tabs share.
///
/// **Every field commits when it goes away.** The inspector rebuilds a tab each time it
/// is switched to or swiped past, and a field being torn down does not reliably hear
/// that it lost focus — so a running head typed and then swiped away from would be
/// lost. Each field here keeps its own text and applies it on return, on losing focus,
/// and on disappearing.

/* ---------------- units ---------------- */

/// Units for the Finishing tabs. Stored in millimeters always; shown in the author's.
enum LengthUnit: String, CaseIterable, Identifiable {
    case inches = "in", millimeters = "mm", centimeters = "cm", points = "pt"
    var id: String { rawValue }

    /// Where the choice is kept: one for every Finishing tab.
    static let storageKey = "inkblot.pageUnits"

    var label: String {
        switch self {
        case .inches: "Inches"
        case .millimeters: "Millimeters"
        case .centimeters: "Centimeters"
        case .points: "Points"
        }
    }

    private var perMm: Double {
        switch self {
        case .inches: 1 / 25.4
        case .millimeters: 1
        case .centimeters: 0.1
        case .points: 72 / 25.4
        }
    }

    /// Enough places to type a paper thickness (0.004 in), and no more.
    var fractionDigits: Int {
        switch self {
        case .inches: 3
        case .millimeters, .points: 1
        case .centimeters: 2
        }
    }

    func fromMm(_ mm: Double) -> Double { mm * perMm }
    func toMm(_ value: Double) -> Double { value / perMm }

    func describe(_ mm: Double, fractionDigits: Int? = nil) -> String {
        let value = fromMm(mm)
        return "\(value.formatted(.number.precision(.fractionLength(0...(fractionDigits ?? self.fractionDigits))))) \(rawValue)"
    }

    /// Inches where the paper is Letter, millimeters everywhere else.
    static var defaultForLocale: LengthUnit {
        Locale.current.measurementSystem == .us ? .inches : .millimeters
    }
}

/// The widths every number field and its unit take, so a column of them lines up.
enum FinishingMetrics {
    static let numberWidth: CGFloat = 64
    static let unitWidth: CGFloat = 22
}

/* ---------------- text that commits ---------------- */

/// A number typed as text and applied when committed — return, focus leaving, or the
/// field going away — rather than on every keystroke. Text that is not a number puts
/// the last value back.
struct CommittingNumberText: View {
    @Binding var value: Double
    var fractionDigits = 2
    var prompt = ""

    @State private var draft = ""
    @FocusState private var focused: Bool

    var body: some View {
        TextField(prompt, text: $draft)
            .focused($focused)
            .multilineTextAlignment(.trailing)
            .onAppear { draft = formatted(value) }
            .onChange(of: value) { if !focused { draft = formatted(value) } }
            .onSubmit(commit)
            .onChange(of: focused) { if !focused { commit() } }
            .onDisappear(perform: commit)
    }

    private func formatted(_ number: Double) -> String {
        number.formatted(.number.precision(.fractionLength(0...fractionDigits)))
    }

    private func commit() {
        guard let parsed = try? Double(draft.trimmingCharacters(in: .whitespaces), format: .number), parsed.isFinite else {
            draft = formatted(value)
            return
        }
        // Compare as shown, so a value the field cannot show in full is not "changed"
        // by being committed untouched.
        if formatted(parsed) != formatted(value) { value = parsed }
        draft = formatted(parsed)
    }
}

/// A text field that applies what was typed when it is committed — return, focus
/// leaving it, or the field going away — rather than on every keystroke.
struct CommitTextField: View {
    let title: String
    @Binding var text: String
    var prompt: String?

    @State private var draft = ""
    @FocusState private var focused: Bool

    init(_ title: String, text: Binding<String>, prompt: String? = nil) {
        self.title = title
        self._text = text
        self.prompt = prompt
    }

    var body: some View {
        TextField(title, text: $draft, prompt: prompt.map { Text($0) })
            .focused($focused)
            .onAppear { draft = text }
            .onChange(of: text) { if !focused { draft = text } }
            .onSubmit(commit)
            .onChange(of: focused) { if !focused { commit() } }
            .onDisappear(perform: commit)
    }

    private func commit() {
        if draft != text { text = draft }
    }
}

/// Paragraphs of text — a dedication, a copyright page — typed in a box that grows
/// with them, and applied when the box lets go, as `CommitTextField` does. Return is a
/// new line here, not a commit.
struct CommitTextEditor: View {
    let title: String
    @Binding var text: String
    var prompt = ""

    @State private var draft = ""
    @FocusState private var focused: Bool

    init(_ title: String, text: Binding<String>, prompt: String = "") {
        self.title = title
        self._text = text
        self.prompt = prompt
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
            TextEditor(text: $draft)
                .focused($focused)
                .font(.body)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 54, maxHeight: 140)
                .padding(4)
                .background(.background, in: .rect(cornerRadius: 5))
                .overlay {
                    RoundedRectangle(cornerRadius: 5)
                        .strokeBorder(focused ? Color.accentColor.opacity(0.6) : Color.secondary.opacity(0.3))
                }
                .overlay(alignment: .topLeading) {
                    if draft.isEmpty && !prompt.isEmpty {
                        Text(prompt)
                            .foregroundStyle(.tertiary)
                            .padding(.horizontal, 9)
                            .padding(.vertical, 4)
                            .allowsHitTesting(false)
                    }
                }
                .accessibilityLabel(title)
        }
        .onAppear { draft = text }
        .onChange(of: text) { if !focused { draft = text } }
        .onChange(of: focused) { if !focused { commit() } }
        .onDisappear(perform: commit)
    }

    private func commit() {
        if draft != text { text = draft }
    }
}

/* ---------------- lengths and numbers ---------------- */

/// A length in a form row: its label leading, the number and its unit trailing, at the
/// same width as every other so they line up down the form.
struct LengthField: View {
    let title: String
    @Binding var millimeters: Double
    let unit: LengthUnit
    var fractionDigits: Int?

    init(_ title: String, millimeters: Binding<Double>, unit: LengthUnit, fractionDigits: Int? = nil) {
        self.title = title
        self._millimeters = millimeters
        self.unit = unit
        self.fractionDigits = fractionDigits
    }

    var body: some View {
        LabeledContent(title) {
            LengthInput(millimeters: $millimeters, unit: unit, fractionDigits: fractionDigits)
        }
    }
}

/// The number and its unit, without a label: for the margin editor's cross.
struct LengthInput: View {
    @Binding var millimeters: Double
    let unit: LengthUnit
    var fractionDigits: Int?

    var body: some View {
        HStack(spacing: 4) {
            CommittingNumberText(
                value: Binding(get: { unit.fromMm(millimeters) }, set: { millimeters = max(0, unit.toMm($0)) }),
                fractionDigits: fractionDigits ?? unit.fractionDigits)
                .frame(width: FinishingMetrics.numberWidth)
            Text(unit.rawValue)
                .foregroundStyle(.secondary)
                .frame(width: FinishingMetrics.unitWidth, alignment: .leading)
        }
    }
}

/// A whole number that may be large (a starting page of 245): typed, or stepped.
struct NumberField: View {
    let title: String
    @Binding var value: Int
    let range: ClosedRange<Int>

    init(_ title: String, value: Binding<Int>, in range: ClosedRange<Int>) {
        self.title = title
        self._value = value
        self.range = range
    }

    var body: some View {
        LabeledContent(title) {
            HStack(spacing: 4) {
                CommittingNumberText(
                    value: Binding(get: { Double(value) }, set: { value = range.clamped(Int($0.rounded())) }),
                    fractionDigits: 0)
                    .frame(width: FinishingMetrics.numberWidth)
                Stepper("", value: $value, in: range)
                    .labelsHidden()
                    .frame(width: FinishingMetrics.unitWidth)
            }
        }
    }
}

/* ---------------- sections ---------------- */

/// A Finishing section that can be folded away, remembering whether it was: the
/// inspector rebuilds its tabs, and a section the author closed should stay closed.
struct FinishingSection<Content: View, Footer: View>: View {
    @Environment(AppModel.self) private var model
    let id: String
    let title: String
    @ViewBuilder var content: Content
    @ViewBuilder var footer: Footer

    init(_ title: String, id: String, @ViewBuilder content: () -> Content, @ViewBuilder footer: () -> Footer) {
        self.title = title
        self.id = id
        self.content = content()
        self.footer = footer()
    }

    // A collapsible section takes no footer, so the note goes in as its last row —
    // folded away with the rest.
    var body: some View {
        Section(isExpanded: model.pageLayout.expansion(id)) {
            content
            footer
        } header: {
            Text(title)
        }
    }
}

extension FinishingSection where Footer == EmptyView {
    init(_ title: String, id: String, @ViewBuilder content: () -> Content) {
        self.init(title, id: id, content: content, footer: { EmptyView() })
    }
}

/// A caution under a control: what it will do that the author may not expect.
struct FinishingCaution: View {
    let text: String
    var body: some View {
        Label(text, systemImage: "exclamationmark.triangle.fill")
            .font(.caption)
            .foregroundStyle(.orange)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// A line of explanation beneath a control.
struct FinishingNote: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }
}
