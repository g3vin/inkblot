import AppKit
import SwiftUI

/// The formatting toolbar, in the window's own toolbar.
///
/// This is `Toolbar.jsx`'s end state, and the reason Phase 4 inverted it: it renders the
/// `ToolbarState` the page pushes and sends `NativeCommand`s, and never asks the document
/// anything. Every command names the editor the state came from (`toolbar.target`), so a
/// state drawn a frame ago cannot apply itself to an editor elected since. With no live
/// editor — a canvas with no card open, an empty pane — `target` is absent and the
/// controls are disabled rather than stale.
///
/// Font lists match the page's: the installed families from the core, with the user's
/// pinned and recent fonts first, stored under the same preference keys
/// (`systemFonts.js`) so the Tauri app and this one share them.
struct FormattingToolbar: ToolbarContent {
    let model: AppModel

    var body: some ToolbarContent {
        ToolbarItemGroup(placement: .automatic) {
            FontMenu(model: model)
            FontSizeMenu(model: model)
        }

        ToolbarItemGroup(placement: .automatic) {
            MarkToggle(model: model, mark: .bold, symbol: "bold", title: "Bold", isOn: \.bold)
            MarkToggle(model: model, mark: .italic, symbol: "italic", title: "Italic", isOn: \.italic)
            MarkToggle(model: model, mark: .underline, symbol: "underline", title: "Underline", isOn: \.underline)
            MarkToggle(model: model, mark: .strike, symbol: "strikethrough", title: "Strikethrough", isOn: \.strike)
        }

        ToolbarItemGroup(placement: .automatic) {
            TextColorPicker(model: model)
            HighlightColorPicker(model: model)
            AlignmentMenu(model: model)
        }

        ToolbarItemGroup(placement: .automatic) {
            Button("Insert Table", systemImage: "tablecells") {
                guard let target = model.bridge.toolbar?.target else { return }
                model.bridge.send(.insertTable(InsertTableCommand(target: target, rows: 3, cols: 3, withHeaderRow: true)))
            }
            .help("Insert table")
            .disabled(model.bridge.toolbar?.target == nil)

            Button("Insert Conversation", systemImage: "text.bubble") {
                guard let target = model.bridge.toolbar?.target else { return }
                model.bridge.send(.insertConversationTile(TargetOnly(target: target)))
            }
            .help("Insert text conversation")
            .disabled(model.bridge.toolbar?.target == nil)
        }
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
