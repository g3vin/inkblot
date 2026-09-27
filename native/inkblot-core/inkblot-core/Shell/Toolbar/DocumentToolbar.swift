import AppKit
import SwiftUI

/// A document's toolbar: the formatting controls, in the window's own toolbar.
///
/// It renders the `ToolbarState` the page pushes and sends `NativeCommand`s, and never
/// asks the document anything. Every command names the editor the state came from (`toolbar.target`), so a
/// state drawn a frame ago cannot apply itself to an editor elected since. With no live
/// editor — a canvas with no card open, an empty pane — `target` is absent and the
/// controls are disabled rather than stale.
///
/// Customizable (`ToolbarID.document`): the items below in order are the default set,
/// and the ones marked `.defaultCustomization(.hidden)` start in the Customize Toolbar
/// palette only. See `ToolbarItemID` before adding one.
///
/// Font lists match the page's: the installed families from the core, with the user's
/// pinned and recent fonts first, stored under the same preference keys
/// (`systemFonts.js`) so the Tauri app and this one share them.
struct DocumentToolbar: CustomizableToolbarContent {
    let model: AppModel

    var body: some CustomizableToolbarContent {
        ToolbarItem(id: ToolbarItemID.editorMode.id) { EditorModePicker(model: model) }

        ToolbarSpacer(.fixed)

        ToolbarItem(id: ToolbarItemID.font.id) { FontMenu(model: model) }
        ToolbarItem(id: ToolbarItemID.fontSize.id) { FontSizeMenu(model: model) }

        ToolbarSpacer(.fixed)

        ToolbarItem(id: ToolbarItemID.textStyle.id) {
            ControlGroup {
                MarkToggle(model: model, mark: .bold, symbol: "bold", title: "Bold", isOn: \.bold)
                MarkToggle(model: model, mark: .italic, symbol: "italic", title: "Italic", isOn: \.italic)
                MarkToggle(model: model, mark: .underline, symbol: "underline", title: "Underline", isOn: \.underline)
                MarkToggle(model: model, mark: .strike, symbol: "strikethrough", title: "Strikethrough", isOn: \.strike)
            } label: {
                Label("Text Style", systemImage: "bold.italic.underline")
            }
        }

        ToolbarSpacer(.fixed)

        ToolbarItem(id: ToolbarItemID.textColor.id) { TextColorPicker(model: model) }
        ToolbarItem(id: ToolbarItemID.highlight.id) { HighlightColorPicker(model: model) }
        ToolbarItem(id: ToolbarItemID.alignment.id) { AlignmentMenu(model: model) }

        ToolbarSpacer(.fixed)

        ToolbarItem(id: ToolbarItemID.insertTable.id) {
            Button("Insert Table", systemImage: "tablecells") {
                guard let target = model.bridge.toolbar?.target else { return }
                model.bridge.send(.insertTable(InsertTableCommand(target: target, rows: 3, cols: 3, withHeaderRow: true)))
            }
            .help("Insert table")
            .disabled(model.bridge.toolbar?.target == nil)
        }
        ToolbarItem(id: ToolbarItemID.insertConversation.id) {
            Button("Insert Conversation", systemImage: "text.bubble") {
                guard let target = model.bridge.toolbar?.target else { return }
                model.bridge.send(.insertConversationTile(TargetOnly(target: target)))
            }
            .help("Insert text conversation")
            .disabled(model.bridge.toolbar?.target == nil)
        }

        /* palette only */

        ToolbarItem(id: ToolbarItemID.paragraphStyle.id) { ParagraphStyleMenu(model: model) }
            .defaultCustomization(.hidden)
        ToolbarItem(id: ToolbarItemID.namedTextStyle.id) { TextStyleMenu(model: model) }
            .defaultCustomization(.hidden)
        ToolbarItem(id: ToolbarItemID.bulletedList.id) {
            ListToggle(model: model, list: .bullet, symbol: "list.bullet", title: "Bulleted List", isOn: \.bulletList)
        }
        .defaultCustomization(.hidden)
        ToolbarItem(id: ToolbarItemID.numberedList.id) {
            ListToggle(model: model, list: .ordered, symbol: "list.number", title: "Numbered List", isOn: \.orderedList)
        }
        .defaultCustomization(.hidden)

        ToolbarItem(id: ToolbarItemID.documentHistory.id) {
            let state = model.bridge.toolbar
            ControlGroup {
                Button("Undo", systemImage: "arrow.uturn.backward") { history(.undo) }
                    .help("Undo (⌘Z)")
                    .disabled(!(state?.canUndo ?? false))
                Button("Redo", systemImage: "arrow.uturn.forward") { history(.redo) }
                    .help("Redo (⇧⌘Z)")
                    .disabled(!(state?.canRedo ?? false))
            } label: {
                Label("Undo/Redo", systemImage: "arrow.uturn.backward")
            }
            .disabled(state?.target == nil)
        }
        .defaultCustomization(.hidden)

        ToolbarItem(id: ToolbarItemID.focusMode.id) {
            let on = model.bridge.viewOptions.focusMode
            Toggle(isOn: Binding(
                get: { on },
                set: { open in model.bridge.send(.setFocusMode(SetFocusModeCommand(open: open))) })) {
                Label("Focus Mode", systemImage: "scope")
            }
            .help(on ? "Leave focus mode" : "Focus mode")
            .disabled(model.bridge.toolbar?.target == nil && !on)
        }
        .defaultCustomization(.hidden)

        ToolbarItem(id: ToolbarItemID.wordCount.id) {
            let on = model.bridge.viewOptions.wordCountVisible
            Toggle(isOn: Binding(
                get: { on },
                set: { visible in
                    model.bridge.send(.setWordCountVisible(SetWordCountVisibleCommand(visible: visible)))
                })) {
                Label("Word Count", systemImage: "number")
            }
            .help(on ? "Hide the word count" : "Show the word count")
        }
        .defaultCustomization(.hidden)

        ToolbarItem(id: ToolbarItemID.pasteAndMatchStyle.id) {
            Button("Paste and Match Style", systemImage: "doc.on.clipboard") { model.pasteAndMatchStyle() }
                .help("Paste and match style (⌥⇧⌘V)")
                .disabled(model.target == nil)
        }
        .defaultCustomization(.hidden)

        SharedToolbarItems(model: model)
    }

    private func history(_ action: HistoryAction) {
        guard let target = model.bridge.toolbar?.target else { return }
        model.bridge.send(.editorHistory(EditorHistoryCommand(target: target, action: action)))
    }
}

/* ---------------- marks ---------------- */

private struct MarkToggle: View {
    let model: AppModel
    let mark: MarkKind
    let symbol: String
    let title: String
    let isOn: KeyPath<ActiveMarks, Bool>

    var body: some View {
        let state = model.bridge.toolbar
        Toggle(isOn: Binding(
            get: { state?.activeMarks[keyPath: isOn] ?? false },
            set: { _ in
                guard let target = state?.target else { return }
                model.bridge.send(.applyMark(ApplyMarkCommand(target: target, mark: mark)))
            })) {
            Label(title, systemImage: symbol)
        }
        .help(title)
        .disabled(state?.target == nil)
    }
}

/* ---------------- blocks ---------------- */

/// Body or a heading, for the blocks the selection touches — or, in a script, its
/// elements: a scene heading, action, a character, dialogue…
private struct ParagraphStyleMenu: View {
    let model: AppModel

    static let prose: [(BlockType, String)] = [
        (.paragraph, "Body"),
        (.heading1, "Heading 1"),
        (.heading2, "Heading 2"),
        (.heading3, "Heading 3"),
    ]

    /// In the order ⌥⌘1 to ⌥⌘8 choose them in the page (`ScriptElement.ts`).
    static let screenplay: [(BlockType, String)] = [
        (.sceneHeading, "Scene Heading"),
        (.action, "Action"),
        (.character, "Character"),
        (.parenthetical, "Parenthetical"),
        (.dialogue, "Dialogue"),
        (.transition, "Transition"),
        (.shot, "Shot"),
        (.centered, "Centered"),
    ]

    static let stageplay: [(BlockType, String)] = [
        (.actHeading, "Act"),
        (.sceneTitle, "Scene"),
        (.stageDirection, "Stage Direction"),
        (.stageCharacter, "Character"),
        (.parenthetical, "Parenthetical"),
        (.stageDialogue, "Dialogue"),
    ]

    static func options(_ format: WritingFormat) -> [(BlockType, String)] {
        switch format {
        case .prose: prose
        case .screenplay: screenplay
        case .stageplay: stageplay
        }
    }

    var body: some View {
        let state = model.bridge.toolbar
        let format = state?.writingFormat ?? .prose
        Picker(selection: Binding(
            get: { state?.blockType ?? .paragraph },
            set: { block in
                guard let target = state?.target else { return }
                model.bridge.send(.setBlockType(SetBlockTypeCommand(target: target, block: block)))
            })) {
            ForEach(Array(Self.options(format).enumerated()), id: \.element.0) { index, option in
                Text(format == .prose ? option.1 : "\(option.1)  ⌥⌘\(index + 1)").tag(option.0)
            }
        } label: {
            Label(format == .prose ? "Paragraph Style" : "Script Element", systemImage: "textformat.size")
        }
        .pickerStyle(.menu)
        .help(format == .prose ? "Paragraph style" : "Script element — Enter and Tab move between them")
        .disabled(state?.target == nil)
    }
}

private struct ListToggle: View {
    let model: AppModel
    let list: ListKind
    let symbol: String
    let title: String
    let isOn: KeyPath<ActiveMarks, Bool>

    var body: some View {
        let state = model.bridge.toolbar
        Toggle(isOn: Binding(
            get: { state?.activeMarks[keyPath: isOn] ?? false },
            set: { _ in
                guard let target = state?.target else { return }
                model.bridge.send(.toggleList(ToggleListCommand(target: target, list: list)))
            })) {
            Label(title, systemImage: symbol)
        }
        .help(title)
        .disabled(state?.target == nil)
    }
}

/* ---------------- fonts ---------------- */

/// Pinned and recent fonts, in the page's preference keys.
@MainActor
enum FontPreferences {
    static let pinnedKey = "inkblot.fonts.pinned"
    static let recentKey = "inkblot.fonts.recent"
    static let maxRecent = 5

    static func read(_ key: String, core: CoreService) -> [String] {
        guard let raw = try? core.core.preferencesGet(scope: "app", key: key),
              let fonts = try? JSONDecoder().decode([String].self, from: Data(raw.utf8))
        else { return [] }
        return fonts
    }

    static func write(_ fonts: [String], _ key: String, core: CoreService) {
        guard let data = try? JSONEncoder().encode(fonts) else { return }
        try? core.core.preferencesSet(scope: "app", key: key, value: String(decoding: data, as: UTF8.self))
    }

    static func remember(_ font: String, core: CoreService) {
        let recent = [font] + read(recentKey, core: core).filter { $0 != font }
        write(Array(recent.prefix(maxRecent)), recentKey, core: core)
    }

    static func togglePin(_ font: String, core: CoreService) {
        var pinned = read(pinnedKey, core: core)
        if let index = pinned.firstIndex(of: font) { pinned.remove(at: index) } else { pinned.append(font) }
        write(pinned, pinnedKey, core: core)
    }

    /// Installed families, read once: enumerating fonts is slow and they rarely change
    /// while the app is open.
    static let installed: [String] = (try? listSystemFonts()) ?? []
}

private struct FontMenu: View {
    let model: AppModel
    /// Bumped after a pin or a pick so the menu re-reads the lists.
    @State private var revision = 0

    var body: some View {
        let state = model.bridge.toolbar
        let current = state?.font ?? "Georgia"
        let _ = revision
        let pinned = FontPreferences.read(FontPreferences.pinnedKey, core: model.core)
        let recent = FontPreferences.read(FontPreferences.recentKey, core: model.core).filter { !pinned.contains($0) }

        Menu {
            if !pinned.isEmpty {
                Section("Pinned") { fontButtons(pinned, current: current) }
            }
            if !recent.isEmpty {
                Section("Recent") { fontButtons(recent, current: current) }
            }
            Section("All Fonts") {
                fontButtons(FontPreferences.installed.filter { !pinned.contains($0) && !recent.contains($0) },
                            current: current)
            }
            Divider()
            Button(pinned.contains(current) ? "Unpin “\(current)”" : "Pin “\(current)”",
                   systemImage: pinned.contains(current) ? "pin.slash" : "pin") {
                FontPreferences.togglePin(current, core: model.core)
                revision += 1
            }
        } label: {
            Text(current)
                .font(.custom(current, size: 13))
                .frame(minWidth: 96, alignment: .leading)
        }
        .help("Font: \(current)")
        .disabled(state?.target == nil)
    }

    @ViewBuilder
    private func fontButtons(_ fonts: [String], current: String) -> some View {
        ForEach(fonts, id: \.self) { font in
            Button {
                guard let target = model.bridge.toolbar?.target else { return }
                FontPreferences.remember(font, core: model.core)
                revision += 1
                model.bridge.send(.setFontFamily(SetFontFamilyCommand(target: target, family: font)))
            } label: {
                if font == current { Label(font, systemImage: "checkmark") } else { Text(font) }
            }
        }
    }
}

private struct FontSizeMenu: View {
    let model: AppModel
    /// The page's sizes, in the page's units.
    static let sizes = ["14px", "16px", "18px", "20px", "24px", "28px", "32px", "36px"]

    var body: some View {
        let state = model.bridge.toolbar
        let current = state?.fontSize ?? "18px"
        Picker("Font Size", selection: Binding(
            get: { current },
            set: { size in
                guard let target = state?.target else { return }
                model.bridge.send(.setFontSize(SetFontSizeCommand(target: target, size: size)))
            })) {
            ForEach(Self.sizes, id: \.self) { size in
                Text(size.replacingOccurrences(of: "px", with: "")).tag(size)
            }
            if !Self.sizes.contains(current) {
                Text(current.replacingOccurrences(of: "px", with: "")).tag(current)
            }
        }
        .pickerStyle(.menu)
        .help("Font size")
        .disabled(state?.target == nil)
    }
}

/* ---------------- colour and alignment ---------------- */

private struct TextColorPicker: View {
    let model: AppModel

    var body: some View {
        let state = model.bridge.toolbar
        ColorPicker(selection: Binding(
            get: { Color(hex: state?.color ?? "#000000") ?? .primary },
            set: { color in
                guard let target = state?.target, let hex = color.hexString else { return }
                model.bridge.send(.setColor(SetColorCommand(target: target, color: hex)))
            }), supportsOpacity: false) {
            Label("Text Color", systemImage: "character")
        }
        .help("Text color")
        .disabled(state?.target == nil)
    }
}

private struct HighlightColorPicker: View {
    let model: AppModel

    var body: some View {
        let state = model.bridge.toolbar
        ColorPicker(selection: Binding(
            get: { Color(hex: state?.highlight ?? state?.lastHighlightColor ?? "#ffff00") ?? .yellow },
            set: { color in
                guard let target = state?.target, let hex = color.hexString else { return }
                // Remembered, as the page's picker did: the context menu's "Highlight"
                // offers the last colour chosen here.
                model.bridge.send(.setHighlight(SetHighlightCommand(target: target, color: hex, remember: true)))
            }), supportsOpacity: false) {
            Label("Highlight", systemImage: "highlighter")
        }
        .help("Highlight color")
        .disabled(state?.target == nil)
    }
}

private struct AlignmentMenu: View {
    let model: AppModel

    private static let options: [(Alignment, String, String)] = [
        (.left, "text.alignleft", "Align Left"),
        (.center, "text.aligncenter", "Center"),
        (.right, "text.alignright", "Align Right"),
    ]

    var body: some View {
        let state = model.bridge.toolbar
        let current = state?.alignment ?? .left
        let symbol = Self.options.first { $0.0 == current }?.1 ?? "text.alignleft"
        Menu {
            ForEach(Self.options, id: \.0) { option in
                Button {
                    guard let target = state?.target else { return }
                    model.bridge.send(.setAlignment(SetAlignmentCommand(target: target, alignment: option.0)))
                } label: {
                    Label(option.2, systemImage: option.0 == current ? "checkmark" : option.1)
                }
            }
        } label: {
            Label("Alignment", systemImage: symbol)
        }
        .help("Alignment")
        .disabled(state?.target == nil)
    }
}

extension Color {
    /// `#rrggbb`, as the page stores colours.
    var hexString: String? {
        guard let rgb = NSColor(self).usingColorSpace(.sRGB) else { return nil }
        let channel = { (value: CGFloat) in Int((min(max(value, 0), 1) * 255).rounded()) }
        return String(format: "#%02x%02x%02x", channel(rgb.redComponent), channel(rgb.greenComponent), channel(rgb.blueComponent))
    }
}
