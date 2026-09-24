import SwiftUI

@main
struct InkblotApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        // What Inkblot opens with: the project picker. The editor window opens once a
        // project is chosen (`ProjectPickerView.open`).
        Window("Welcome to Inkblot", id: ProjectPickerView.windowID) {
            ProjectPickerView()
                .environment(model)
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(ProjectPickerView.size)
        .windowResizability(.contentMinSize)
        .defaultPosition(.center)
        .defaultLaunchBehavior(.presented)
        .restorationBehavior(.disabled)
        .keyboardShortcut("1", modifiers: [.command, .shift])

        // `Window`, not `WindowGroup` — see `AppModel` on why there is one page.
        Window("Inkblot", id: "main") {
            ContentView()
                .environment(model)
                .frame(minWidth: 760, minHeight: 480)
        }
        .defaultSize(width: 1200, height: 800)
        // Never on its own: at launch the picker comes first, and a restored editor
        // window would be a page with no project in it.
        .defaultLaunchBehavior(.suppressed)
        .restorationBehavior(.disabled)
        // A real toolbar at the regular unified height, without the title: a band of
        // glass holding the formatting controls and the sidebar toggles — see ContentView.
        .windowToolbarStyle(.unified(showsTitle: false))
        .commands {
            // View ▸ Show/Hide Sidebar and Show/Hide Inspector, beside the toolbar toggles,
            // and View ▸ Customize Toolbar….
            SidebarCommands()
            InspectorCommands()
            ToolbarCommands()
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

        // File ▸ Page Setup, Print and Export. ⌘P and ⌥⌘P are the page's too (it handles
        // them as keystrokes, like the Format keys above), so these carry none.
        CommandGroup(replacing: .printItem) {
            Button("Page Setup…") { model.showPageSetup() }
            Button("Print…  ⌘P") { model.pageLayout.print(.document) }
                .disabled(!model.pageLayout.hasDocument)
            Button("Print Book…") { model.pageLayout.print(.folder) }
                .disabled(!model.pageLayout.hasDocument)
            Button("Print Book for Binding…") { model.pageLayout.print(.folder, bound: true) }
                .disabled(!model.pageLayout.hasDocument)
        }
        CommandGroup(after: .importExport) {
            Menu("Export") {
                exportItems(.document)
            }
            .disabled(!model.pageLayout.hasDocument)
            Menu("Export Book") {
                exportItems(.folder)
                Button("PDF for Binding…") { model.pageLayout.export(.pdf, scope: .folder, bound: true) }
            }
            .disabled(!model.pageLayout.hasDocument)
        }

        CommandMenu("Insert") {
            Button("Page Break  ⌘↩") { model.pageLayout.insertBreak(.page, target: model.target) }
            Button("Column Break  ⇧⌘↩") { model.pageLayout.insertBreak(.column, target: model.target) }
            Button("Break to Next Right-Hand Page") { model.pageLayout.insertBreak(.recto, target: model.target) }
            Divider()
            // References. The page's editor has no use for these chords (⌥⌘C is its code
            // block, ⇧⌘R its align-right), so they reach the menu.
            Button("Add Reference…") { model.sidebar.beginQuickAdd(cite: false) }
                .keyboardShortcut("r", modifiers: [.command, .option])
                .disabled(model.sidebar.projectName == nil)
            Button("Insert Citation…") { model.sidebar.beginQuickAdd(cite: true) }
                .keyboardShortcut("k", modifiers: [.command, .option])
                .disabled(model.target == nil)
            Button("Insert Bibliography") { model.sidebar.insertBibliography() }
                .disabled(model.target == nil)
            Menu("Citation Style") {
                ForEach(model.sidebar.referenceSchema?.styles ?? [], id: \.id) { style in
                    Toggle(style.label, isOn: Binding(
                        get: { model.sidebar.references?.style == style.id },
                        set: { if $0 { model.sidebar.setCitationStyle(style.id) } }))
                }
                Divider()
                Button("Next Style") { model.sidebar.cycleCitationStyle(by: 1) }
                    .keyboardShortcut("]", modifiers: [.command, .control])
                Button("Previous Style") { model.sidebar.cycleCitationStyle(by: -1) }
                    .keyboardShortcut("[", modifiers: [.command, .control])
            }
            .disabled(model.sidebar.references == nil)
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
            Divider()
            Toggle("Print Layout  ⌥⌘P", isOn: Binding(
                get: { model.pageLayout.isEnabled },
                set: { model.pageLayout.setPrintLayout($0) }))
                .disabled(!model.pageLayout.hasDocument)
            Menu("Page Zoom") {
                Button("Fit Width") { model.pageLayout.fit(.width) }
                Button("Fit Page") { model.pageLayout.fit(.page) }
                Button("Actual Size") { model.pageLayout.fit(.actual) }
                Divider()
                Button("100%") { model.pageLayout.zoom(1) }
            }
            .disabled(!model.pageLayout.isEnabled)
            if !model.menus.viewMenuItems.isEmpty {
                Divider()
                WebMenuItems(items: model.menus.viewMenuItems) { rid in model.menus.activate?(rid) }
            }
        }
    }

    @ViewBuilder
    private func exportItems(_ scope: PrintScope) -> some View {
        Button("PDF…") { model.pageLayout.export(.pdf, scope: scope) }
        Button("EPUB…") { model.pageLayout.export(.epub, scope: scope) }
        Button("Markdown…") { model.pageLayout.export(.markdown, scope: scope) }
        Button("HTML…") { model.pageLayout.export(.html, scope: scope) }
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
