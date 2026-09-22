import SwiftUI

@main
struct InkblotApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        // `Window`, not `WindowGroup` — see `AppModel` on why there is one page.
        Window("Inkblot", id: "main") {
            ContentView()
                .environment(model)
                .frame(minWidth: 760, minHeight: 480)
        }
        .defaultSize(width: 1200, height: 800)
        // No title and no toolbar row — see WindowChrome for why not a real toolbar, and
        // for how the traffic lights still get a toolbar window's placement.
        .windowStyle(.hiddenTitleBar)
        .commands {
            // View ▸ Show/Hide Sidebar and Show/Hide Inspector, beside the toolbar toggles.
            SidebarCommands()
            InspectorCommands()
            InkblotCommands(model: model)
        }
    }
}

/// The menu bar.
///
/// Format items carry no key equivalents on purpose. ⌘B, ⌘I and ⌘U already reach the
/// editor as keystrokes — `WKWebView` offers a key equivalent to the page before the
/// menu sees it — and a menu shortcut as well would toggle twice, which is no change
/// at all. The menu is there to be found and to show state, not to add a second path.
struct InkblotCommands: Commands {
    let model: AppModel

    var body: some Commands {
        CommandGroup(after: .pasteboard) {
            Button("Paste and Match Style") { model.pasteAndMatchStyle() }
                .keyboardShortcut("v", modifiers: [.command, .option, .shift])
                .disabled(model.target == nil)
        }

        CommandMenu("Format") {
            markToggle("Bold", .bold, \.bold)
            markToggle("Italic", .italic, \.italic)
            markToggle("Underline", .underline, \.underline)
            markToggle("Strikethrough", .strike, \.strike)
            Divider()
            alignmentToggle("Align Left", .left)
            alignmentToggle("Center", .center)
            alignmentToggle("Align Right", .right)
        }

        // The page's own View items — theme, accent color, word count. Still the page's
        // to run (it owns those settings); drawn here because the menu bar is ours.
        CommandGroup(after: .sidebar) {
            if !model.menus.viewMenuItems.isEmpty {
                Divider()
                WebMenuItems(items: model.menus.viewMenuItems) { rid in model.menus.activate?(rid) }
            }
        }
    }

    private func markToggle(_ title: String, _ mark: MarkKind, _ isOn: KeyPath<ActiveMarks, Bool>) -> some View {
        Toggle(title, isOn: Binding(
            get: { model.bridge.toolbar?.activeMarks[keyPath: isOn] ?? false },
            set: { _ in model.toggle(mark) }))
            .disabled(model.target == nil)
    }

    private func alignmentToggle(_ title: String, _ alignment: Alignment) -> some View {
        Toggle(title, isOn: Binding(
            get: { model.bridge.toolbar?.alignment == alignment },
            set: { _ in model.align(alignment) }))
            .disabled(model.target == nil)
    }
}

/// A page-built menu tree as menu-bar content.
private struct WebMenuItems: View {
    let items: [WebMenus.Item]
    let activate: (Int) -> Void

    var body: some View {
        ForEach(items) { item in
            if item.isSeparator {
                Divider()
            } else if !item.items.isEmpty {
                Menu(item.text) {
                    AnyView(WebMenuItems(items: item.items, activate: activate))
                }
                .disabled(!item.enabled)
            } else if item.kind == "Check" {
                Toggle(item.text, isOn: Binding(get: { item.checked }, set: { _ in activate(item.rid) }))
                    .disabled(!item.enabled)
            } else {
                Button(item.text) { activate(item.rid) }
                    .disabled(!item.enabled)
            }
        }
    }
}
