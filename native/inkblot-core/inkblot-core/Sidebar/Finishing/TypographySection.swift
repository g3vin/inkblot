import AppKit
import SwiftUI

/// The Page tab's Typography section: the type the text prints in.
///
/// Off, a page prints in the editor's own font, as it always has. On, the setup carries
/// its own font, size, spacing, indents and scene breaks, and Print Layout shows the
/// pages in them — which is what makes a manuscript double-spaced Courier and a novel
/// justified Palatino without touching the draft.
struct TypographySection: View {
    let setup: PageSetupDraft
    let unit: LengthUnit
    let defaultTypography: PrintTypography?
    let apply: (PageSetupDraft) -> Void

    var body: some View {
        FinishingSection("Typography", id: FinishingSectionID.typography) {
            Toggle("Set Type for Print", isOn: Binding(
                get: { setup.typography != nil },
                set: { on in
                    var draft = setup
                    draft.typography = on ? defaultTypography.map(TypographyDraft.init) : nil
                    apply(draft)
                }))
                .disabled(defaultTypography == nil && setup.typography == nil)
            if let t = setup.typography {
                controls(t)
            }
        } footer: {
            FinishingNote(setup.typography == nil
                ? "Pages print in the editor’s font. Set type for print to choose a font, spacing and scene breaks for the page alone."
                : "A horizontal rule prints as the scene break. The chapter opening applies to the first paragraph after each Heading 1.")
        }
    }

    private func edit(_ change: (inout TypographyDraft) -> Void) {
        guard var t = setup.typography else { return }
        change(&t)
        guard t != setup.typography else { return }
        var draft = setup
        draft.typography = t
        apply(draft)
    }

    private func binding<T: Equatable>(_ keyPath: WritableKeyPath<TypographyDraft, T>) -> Binding<T> {
        Binding(
            get: { setup.typography?[keyPath: keyPath] ?? TypographyDraft(Self.fallback)[keyPath: keyPath] },
            set: { value in edit { $0[keyPath: keyPath] = value } })
    }

    @ViewBuilder
    private func controls(_ t: TypographyDraft) -> some View {
        LabeledContent("Font") {
            FontFamilyPopUp(selection: t.primaryFamily) { name in
                edit { $0.fontFamily = TypographyDraft.cssFamily(name) }
            }
        }
        LabeledContent("Size") {
            HStack(spacing: 4) {
                CommittingNumberText(value: binding(\.fontSizePt), fractionDigits: 1)
                    .frame(width: FinishingMetrics.numberWidth)
                Text("pt").foregroundStyle(.secondary).frame(width: FinishingMetrics.unitWidth, alignment: .leading)
            }
        }
        Picker("Line Spacing", selection: binding(\.lineSpacing)) {
            Text("Single").tag(LineSpacing.single)
            Text("1.5 Lines").tag(LineSpacing.oneAndAHalf)
            Text("Double").tag(LineSpacing.double)
            Divider()
            Text("Multiple").tag(LineSpacing.multiple)
            Text("Exactly").tag(LineSpacing.exact)
        }
        if t.lineSpacing == .multiple || t.lineSpacing == .exact {
            LabeledContent(t.lineSpacing == .exact ? "Line Height" : "Multiple") {
                HStack(spacing: 4) {
                    CommittingNumberText(value: binding(\.lineValue), fractionDigits: 2)
                        .frame(width: FinishingMetrics.numberWidth)
                    Text(t.lineSpacing == .exact ? "pt" : "×")
                        .foregroundStyle(.secondary)
                        .frame(width: FinishingMetrics.unitWidth, alignment: .leading)
                }
            }
        }
        Picker("Alignment", selection: binding(\.alignment)) {
            Label("Left", systemImage: "text.alignleft").tag(PrintAlignment.left)
            Label("Justified", systemImage: "text.justify").tag(PrintAlignment.justify)
        }
        .pickerStyle(.segmented)
        Toggle("Hyphenate", isOn: binding(\.hyphenate))
        LengthField("First-Line Indent", millimeters: binding(\.firstLineIndentMm), unit: unit)
        LabeledContent("Space After Paragraph") {
            HStack(spacing: 4) {
                CommittingNumberText(value: binding(\.paragraphSpacingPt), fractionDigits: 1)
                    .frame(width: FinishingMetrics.numberWidth)
                Text("pt").foregroundStyle(.secondary).frame(width: FinishingMetrics.unitWidth, alignment: .leading)
            }
        }
        Toggle("No Indent After a Heading or Break", isOn: binding(\.noIndentAfterBreak))
        LabeledContent("Scene Break") {
            HStack(spacing: 4) {
                CommitTextField("Scene Break", text: binding(\.sceneBreak), prompt: "* * *")
                    .labelsHidden()
                    .multilineTextAlignment(.center)
                    .frame(width: FinishingMetrics.numberWidth + 20)
                Menu {
                    ForEach(Self.sceneBreaks, id: \.self) { glyph in
                        Button(glyph) { edit { $0.sceneBreak = glyph } }
                    }
                } label: {
                    Image(systemName: "chevron.up.chevron.down")
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
                .help("Common scene breaks")
            }
        }
        Picker("Chapter Opening", selection: binding(\.chapterOpening)) {
            Text("Plain").tag(ChapterOpening.plain)
            Text("Drop Cap").tag(ChapterOpening.dropCap)
            Text("Small Caps").tag(ChapterOpening.smallCaps)
            Text("Drop Cap & Small Caps").tag(ChapterOpening.dropCapAndSmallCaps)
        }
        LengthField("Chapter Title Drop", millimeters: binding(\.chapterSinkMm), unit: unit)
            .help("How far down its page a chapter's title sits, from the top margin")
    }

    static let sceneBreaks = ["* * *", "#", "⁂", "❧", "~", "• • •"]

    /// Only for bindings to read while the section redraws without type set.
    private static let fallback = PrintTypography(
        fontFamily: "Georgia, serif", fontSizePt: 12, lineSpacing: .single, lineValue: 1,
        firstLineIndentMm: 0, paragraphSpacingPt: 0, alignment: .left, hyphenate: false,
        sceneBreak: "* * *", chapterOpening: .plain, chapterSinkMm: 0, noIndentAfterBreak: false)
}

/// The fonts the font menu offers: a few that print well first, then every family
/// installed. Read once — the list is long and does not change while the tab is open.
@MainActor
final class FontFamilies {
    static let shared = FontFamilies()

    let all: [String]
    let suggested: [String]
    private let installed: Set<String>

    private init() {
        let families = NSFontManager.shared.availableFontFamilies.filter { !$0.hasPrefix(".") }.sorted()
        let installed = Set(families)
        all = families
        self.installed = installed
        let wanted = ["Courier Prime", "Courier New", "Courier", "Times New Roman", "Palatino", "Baskerville",
                      "Garamond", "EB Garamond", "Hoefler Text", "Georgia", "Iowan Old Style", "Charter"]
        suggested = wanted.filter { installed.contains($0) }
    }

    func contains(_ family: String) -> Bool { installed.contains(family) }
}

/// The font menu: AppKit's pop-up rather than a SwiftUI `Picker`, which made a view for
/// every installed family — hundreds — and diffed them all each time the Page tab
/// appeared or the setup changed. The menu is built once per control and only its
/// selection follows the setup after that.
struct FontFamilyPopUp: NSViewRepresentable {
    let selection: String
    let choose: (String) -> Void

    func makeNSView(context: Context) -> NSPopUpButton {
        let button = NSPopUpButton(frame: .zero, pullsDown: false)
        button.target = context.coordinator
        button.action = #selector(Coordinator.changed(_:))
        button.setContentHuggingPriority(.defaultLow, for: .horizontal)
        button.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return button
    }

    func updateNSView(_ button: NSPopUpButton, context: Context) {
        context.coordinator.parent = self
        let item = { button.menu?.items.first { $0.representedObject as? String == selection } }
        if item() == nil { button.menu = Self.menu(including: selection) }
        button.select(item())
    }

    /// The suggested families, each in its own face, then every family — with the setup's
    /// own first when it is not installed, so the menu still names it.
    private static func menu(including current: String) -> NSMenu {
        let families = FontFamilies.shared
        let menu = NSMenu()
        func add(_ family: String, face: Bool = false) {
            let item = NSMenuItem(title: family, action: nil, keyEquivalent: "")
            item.representedObject = family
            if face, let font = NSFont(name: family, size: 13) ?? NSFontManager.shared.font(withFamily: family, traits: [], weight: 5, size: 13) {
                item.attributedTitle = NSAttributedString(string: family, attributes: [.font: font])
            }
            menu.addItem(item)
        }
        if !families.contains(current) {
            add(current)
            menu.addItem(.separator())
        }
        menu.addItem(.sectionHeader(title: "Suggested"))
        families.suggested.forEach { add($0, face: true) }
        menu.addItem(.separator())
        menu.addItem(.sectionHeader(title: "All Fonts"))
        families.all.forEach { add($0) }
        return menu
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject {
        var parent: FontFamilyPopUp

        init(_ parent: FontFamilyPopUp) { self.parent = parent }

        @objc func changed(_ button: NSPopUpButton) {
            guard let family = button.selectedItem?.representedObject as? String else { return }
            parent.choose(family)
        }
    }
}

/* ---------------- the title page ---------------- */

/// A page before the text, printed and exported but never shown in Print Layout: a
/// manuscript's contact block and word count, a book's title and author, or a script's.
struct TitlePageSection: View {
    let setup: PageSetupDraft
    let apply: (PageSetupDraft) -> Void
    let editAuthor: () -> Void

    var body: some View {
        FinishingSection("Title Page", id: FinishingSectionID.titlePage) {
            Toggle("Add a Title Page", isOn: Binding(
                get: { setup.titlePage != nil },
                set: { on in
                    var draft = setup
                    draft.titlePage = on ? TitlePageDraft(style: .manuscript) : nil
                    apply(draft)
                }))
            if let page = setup.titlePage {
                Picker("Style", selection: Binding(
                    get: { page.style },
                    set: { style in update { $0 = TitlePageDraft(style: style) } }
                )) {
                    Text("Manuscript").tag(TitlePageStyle.manuscript)
                    Text("Book").tag(TitlePageStyle.book)
                    Text("Screenplay").tag(TitlePageStyle.screenplay)
                }
                Toggle("Contact Details", isOn: Binding(
                    get: { page.showContact },
                    set: { on in update { $0.showContact = on } }))
                if page.style == .manuscript {
                    Toggle("Word Count", isOn: Binding(
                        get: { page.showWordCount },
                        set: { on in update { $0.showWordCount = on } }))
                }
                LabeledContent("Author") {
                    Button("Edit Author Details…", action: editAuthor)
                }
            }
        } footer: {
            FinishingNote("The title page prints and exports ahead of the text, unnumbered. Contact details come from your author details.")
        }
    }

    private func update(_ change: (inout TitlePageDraft) -> Void) {
        guard var page = setup.titlePage else { return }
        change(&page)
        guard page != setup.titlePage else { return }
        var draft = setup
        draft.titlePage = page
        apply(draft)
    }
}

/* ---------------- the author ---------------- */

/// The writer's name and contact details, for title pages and the `{author}` and
/// `{surname}` tokens. One for the whole app: it is who is writing, not what.
struct AuthorProfileSheet: View {
    let profile: AuthorProfile
    let save: (AuthorProfile) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var byline = ""
    @State private var legalName = ""
    @State private var address = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var agent = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Form {
                Section {
                    TextField("Byline", text: $byline, prompt: Text("The name on the cover"))
                    TextField("Legal Name", text: $legalName, prompt: Text("If different, for contracts"))
                } header: {
                    Text("Author")
                }
                Section {
                    TextField("Address", text: $address, prompt: Text("Street, city, postcode"), axis: .vertical)
                        .lineLimit(2...4)
                    TextField("Email", text: $email)
                    TextField("Phone", text: $phone)
                    TextField("Agent", text: $agent, prompt: Text("Agent and agency"))
                } header: {
                    Text("Contact")
                } footer: {
                    Text("Printed on manuscript and screenplay title pages. Kept on this Mac only.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .formStyle(.grouped)
            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Save") {
                    save(AuthorProfile(byline: byline, legalName: legalName, address: address, email: email, phone: phone, agent: agent))
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
            }
            .padding()
        }
        .frame(width: 420)
        .onAppear {
            byline = profile.byline
            legalName = profile.legalName
            address = profile.address
            email = profile.email
            phone = profile.phone
            agent = profile.agent
        }
    }
}
