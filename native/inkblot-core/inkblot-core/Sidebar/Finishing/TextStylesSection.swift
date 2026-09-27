import SwiftUI

/// The Typeset tab's Text Styles section: how the book sets its named styles — a
/// letter, a text message, verse, a sign — and styles of its own.
///
/// A paragraph carries only its style's name (Format ▸ Text Style, or the toolbar's
/// menu); the look is the book's, so changing it here changes every letter in the book
/// at once, on the pages, in the EPUB and in Word.
struct TextStylesSection: View {
    @Environment(AppModel.self) private var model
    @State private var open: String?

    var body: some View {
        let layout = model.pageLayout
        FinishingSection("Text Styles", id: FinishingSectionID.textStyles) {
            ForEach(layout.textStyles, id: \.id) { look in
                DisclosureGroup(isExpanded: Binding(
                    get: { open == look.id },
                    set: { open = $0 ? look.id : nil }
                )) {
                    TextStyleEditor(draft: TextStyleDraft(look), isBuiltin: Self.builtins.contains(look.id)) { edited in
                        save(edited)
                    } reset: {
                        remove(look.id)
                    }
                } label: {
                    HStack {
                        Text(look.name)
                            .italic(look.italic)
                            .font(look.smallCaps ? .body.smallCaps() : .body)
                        Spacer()
                        if layout.paragraph?.styleName == look.id {
                            Image(systemName: "text.cursor").foregroundStyle(.secondary).help("The caret is in one")
                        }
                    }
                }
            }
            Button("Add a Style", systemImage: "plus") {
                let id = "custom-\(UUID().uuidString.prefix(8).lowercased())"
                save(TextStyleDraft(TextStyleLook(id: id, name: "New Style", fontFamily: nil, size: 1, italic: false, smallCaps: false, align: .inherit, indentEm: 0, flush: false, spaceLines: 1, boxed: false)))
                open = id
            }
        } footer: {
            FinishingNote("Give a paragraph a style from Format ▸ Text Style. In Write it shows as a faint rule beside the text; here it is set as the book sets it.")
        }
    }

    /// The app's own styles: reset, not deleted.
    static let builtins: Set<String> = ["letter", "textMessage", "email", "verse", "blockQuote", "journal", "sign", "centered", "flushLeft"]

    private func save(_ draft: TextStyleDraft) {
        guard var book = model.pageLayout.book else { return }
        var looks = book.textStyles
        if let i = looks.firstIndex(where: { $0.id == draft.id }) { looks[i] = draft.look } else { looks.append(draft.look) }
        book.textStyles = looks
        model.pageLayout.apply(book)
    }

    private func remove(_ id: String) {
        guard var book = model.pageLayout.book else { return }
        book.textStyles.removeAll { $0.id == id }
        model.pageLayout.apply(book)
        if open == id { open = nil }
    }
}

/// A look, editable (the generated struct's fields are fixed).
struct TextStyleDraft: Equatable {
    var id: String
    var name: String
    var fontFamily: String?
    var size: Double
    var italic: Bool
    var smallCaps: Bool
    var align: TextStyleAlign
    var indentEm: Double
    var flush: Bool
    var spaceLines: Double
    var boxed: Bool

    init(_ l: TextStyleLook) {
        id = l.id; name = l.name; fontFamily = l.fontFamily; size = l.size; italic = l.italic
        smallCaps = l.smallCaps; align = l.align; indentEm = l.indentEm; flush = l.flush
        spaceLines = l.spaceLines; boxed = l.boxed
    }

    var look: TextStyleLook {
        TextStyleLook(id: id, name: name, fontFamily: fontFamily, size: min(3, max(0.5, size)), italic: italic,
                      smallCaps: smallCaps, align: align, indentEm: min(12, max(0, indentEm)), flush: flush,
                      spaceLines: min(4, max(0, spaceLines)), boxed: boxed)
    }
}

private struct TextStyleEditor: View {
    let draft: TextStyleDraft
    let isBuiltin: Bool
    let save: (TextStyleDraft) -> Void
    let reset: () -> Void

    private func binding<T: Equatable>(_ keyPath: WritableKeyPath<TextStyleDraft, T>) -> Binding<T> {
        Binding(get: { draft[keyPath: keyPath] }, set: { value in
            var next = draft
            next[keyPath: keyPath] = value
            if next != draft { save(next) }
        })
    }

    var body: some View {
        if !isBuiltin {
            CommitTextField("Name", text: binding(\.name))
        }
        Toggle("Its Own Font", isOn: Binding(
            get: { draft.fontFamily != nil },
            set: { on in
                var next = draft
                next.fontFamily = on ? TypographyDraft.cssFamily("Helvetica Neue") : nil
                save(next)
            }))
        if let family = draft.fontFamily {
            let primary = family.split(separator: ",").first.map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "\"' ")) } ?? family
            FontFamilyPopUp(selection: primary) { name in
                var next = draft
                next.fontFamily = TypographyDraft.cssFamily(name)
                save(next)
            }
        }
        Stepper(value: binding(\.size), in: 0.5...3, step: 0.05) {
            LabeledContent("Size", value: "\(Int((draft.size * 100).rounded()))%")
        }
        Toggle("Italic", isOn: binding(\.italic))
        Toggle("Small Capitals", isOn: binding(\.smallCaps))
        Picker("Alignment", selection: binding(\.align)) {
            Text("As the Text").tag(TextStyleAlign.inherit)
            Text("Left").tag(TextStyleAlign.left)
            Text("Centered").tag(TextStyleAlign.center)
            Text("Right").tag(TextStyleAlign.right)
            Text("Justified").tag(TextStyleAlign.justify)
        }
        Stepper(value: binding(\.indentEm), in: 0...12, step: 0.5) {
            LabeledContent("Indent Both Sides", value: String(format: "%.1f em", draft.indentEm))
        }
        Toggle("No First-Line Indent", isOn: binding(\.flush))
        Stepper(value: binding(\.spaceLines), in: 0...4, step: 0.5) {
            LabeledContent("Space Around", value: String(format: "%.1f lines", draft.spaceLines))
        }
        Toggle("Ruled Box", isOn: binding(\.boxed))
        Button(isBuiltin ? "Reset to the App’s Look" : "Delete Style", role: isBuiltin ? nil : .destructive, action: reset)
            .controlSize(.small)
    }
}

/// Format ▸ Text Style, and the toolbars' menu: the book's styles, the paragraph's checked.
struct TextStyleMenu: View {
    let model: AppModel

    var body: some View {
        let layout = model.pageLayout
        let current = layout.paragraph?.styleName
        Menu {
            Button {
                layout.setTextStyle(nil)
            } label: {
                if current == nil { Label("Body Text", systemImage: "checkmark") } else { Text("Body Text") }
            }
            Divider()
            ForEach(layout.textStyles, id: \.id) { look in
                Button {
                    layout.setTextStyle(look.id)
                } label: {
                    if current == look.id { Label(look.name, systemImage: "checkmark") } else { Text(look.name) }
                }
            }
        } label: {
            Label("Text Style", systemImage: "text.quote")
        }
        .help("Set the paragraph as a letter, a text message, verse… — how each looks is the book’s")
        .disabled(model.bridge.toolbar?.target == nil)
    }
}
