#if os(macOS)
import AppKit
#endif
import SwiftUI

/// The Swift app: a SwiftUI shell around the editor bundle (`dist/`), which runs
/// unmodified in a `WKWebView` (`EditorWebView`). The shell draws the file tree, the
/// inspector, the toolbar and the menu bar natively, and talks to the page over the
/// bridge protocol (`ShellBridge`) and the Tauri API shim (`TauriHost`). Domain logic
/// and models come from Rust through `inkblot-ffi` (`CoreService`, `ModelService`).
@main
struct InkblotApp: App {
    @State private var model = AppModel()

    #if os(macOS)
    init() {
        // The tabs are the window's own (`DocumentTabBar`), not AppKit's: with automatic
        // tabbing on, AppKit would add its Show Tab Bar and Merge All Windows beside ours.
        NSWindow.allowsAutomaticWindowTabbing = false
    }
    #endif

    var body: some Scene {
        #if os(macOS)
        mac
        #else
        // iOS and iPadOS have no single-window scene. One scene is still the rule (see
        // `AppModel`); the Info.plist does not enable multiple scenes, so this is one.
        WindowGroup {
            ContentView()
                .environment(model)
        }
        .commands {
            InkblotCommands(model: model)
        }
        #endif
    }

    #if os(macOS)
    @SceneBuilder
    private var mac: some Scene {
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
        // `Window`, not `WindowGroup` — see `AppModel` on why there is one page. The tabs
        // are drawn in it, over the page column, as Xcode's editor tabs are.
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

        Settings {
            InkblotSettingsView()
                .environment(model)
        }

        // SwiftUI writes this binding back as it updates the scene, changed or not. The
        // guard is what keeps that from being a loop: a write saves the config, the
        // config is observed by this scene, and the scene updating writes it again.
        MenuBarExtra(isInserted: Binding(
            get: { model.stats.config.menuBarExtra },
            set: { shown in
                guard shown != model.stats.config.menuBarExtra else { return }
                model.stats.config.menuBarExtra = shown
                model.saveStatsConfig()
            })
        ) {
            StatsMenuBarPanel()
                .environment(model)
        } label: {
            StatsMenuBarLabel(model: model)
        }
        .menuBarExtraStyle(.window)
    }
    #endif
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
        #if os(macOS)
        // File ▸ New Tab and Close Tab. ⌘W closes the tab in the editor window, and the
        // window anywhere else or once no tab is left (`TabsModel.closeFromMenu`).
        CommandGroup(after: .newItem) {
            Button("New Tab") { model.tabs.newTab() }
                .keyboardShortcut("t", modifiers: .command)
                .disabled(model.bridge.project.projectName == nil)
        }
        CommandGroup(replacing: .saveItem) {
            Button(model.tabs.editorIsKey && model.tabs.hasTabs ? "Close Tab" : "Close") {
                model.tabs.closeFromMenu()
            }
            .keyboardShortcut("w", modifiers: .command)
            Button("Close Window") { NSApp.keyWindow?.performClose(nil) }
                .keyboardShortcut("w", modifiers: [.command, .shift])
        }

        // Window ▸ the next and previous tab, where Safari and Xcode put them.
        CommandGroup(before: .windowList) {
            Button("Show Previous Tab") { model.tabs.selectAdjacent(-1) }
                .keyboardShortcut(.tab, modifiers: [.control, .shift])
                .disabled(!model.tabs.canCycle)
            Button("Show Next Tab") { model.tabs.selectAdjacent(1) }
                .keyboardShortcut(.tab, modifiers: .control)
                .disabled(!model.tabs.canCycle)
            Divider()
        }
        #endif

        CommandGroup(after: .pasteboard) {
            Button("Paste and Match Style") { model.pasteAndMatchStyle() }
                .keyboardShortcut("v", modifiers: [.command, .option, .shift])
                .disabled(model.target == nil)
        }

        // File ▸ Page Setup, Print and Export. The keys are these items' own: with the
        // Finishing tabs drawn natively the page leaves ⌘P and ⌥⌘P alone (so one press
        // is one print), and a key the page does not take comes back to the menu.
        CommandGroup(replacing: .printItem) {
            Button("Page Setup…") { model.showPageSetup() }
                .keyboardShortcut("p", modifiers: [.command, .shift])
            Button("Book Settings…") { model.showBook() }
            Button("Publish…") { model.showPublish() }
            Divider()
            Button("Print…") { model.pageLayout.print(.document) }
                .keyboardShortcut("p", modifiers: .command)
                .disabled(!model.pageLayout.hasDocument)
            Button("Print Book…") { model.pageLayout.print(.folder) }
                .disabled(!model.pageLayout.hasDocument)
            Button("Print Whole Project…") { model.pageLayout.print(.project) }
                .disabled(!model.pageLayout.hasDocument)
            Button("Print Book for Binding…") { model.pageLayout.print(.folder, bound: true) }
                .disabled(!model.pageLayout.hasDocument || !model.pageLayout.bindingEnabled)
        }
        CommandGroup(after: .importExport) {
            Button(model.pageLayout.lastExport.map { "Export Again: \(URL(fileURLWithPath: $0.path).lastPathComponent)" } ?? "Export Again") {
                model.pageLayout.exportAgain()
            }
            .keyboardShortcut("e", modifiers: [.command, .shift])
            .disabled(model.pageLayout.lastExport == nil || !model.pageLayout.hasDocument)
            Button("Import Fountain Script…") { model.pageLayout.importScript() }
                .disabled(!model.hasProject)
            Menu("Export") {
                exportItems(.document)
            }
            .disabled(!model.pageLayout.hasDocument)
            Menu("Export Book") {
                exportItems(.folder)
                if model.pageLayout.bindingEnabled {
                    Divider()
                    Button("PDF for Binding…") { model.pageLayout.export(.pdf, scope: .folder, bound: true) }
                }
            }
            .disabled(!model.pageLayout.hasDocument)
            Menu("Export Whole Project") {
                exportItems(.project)
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

        CommandMenu("Timer") {
            TimerMenuItems(model: model)
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
            Divider()
            // Prose, or a script: its lines become scene headings, action, dialogue…
            Picker("Write As", selection: Binding(
                get: { model.bridge.toolbar?.writingFormat ?? .prose },
                set: { format in
                    guard let target = model.bridge.toolbar?.target else { return }
                    model.bridge.send(.setWritingFormat(SetWritingFormatCommand(target: target, format: format)))
                })) {
                Text("Prose").tag(WritingFormat.prose)
                Text("Screenplay").tag(WritingFormat.screenplay)
                Text("Stage Play").tag(WritingFormat.stageplay)
            }
            .disabled(model.bridge.toolbar?.target == nil)
        }

        // View ▸ beside Customize Toolbar…: the inspector's two layouts.
        CommandGroup(after: .toolbar) {
            Button("Switch to \(model.sidebar.layout.other.title) Layout") {
                model.sidebar.isPresented = true
                model.sidebar.switchLayout()
            }
            Button("Customize Inspector Layout…") { model.sidebar.isCustomizingLayout = true }
        }

        // The page's own View items — theme, accent color, word count. Still the page's
        // to run (it owns those settings); drawn here because the menu bar is ours.
        CommandGroup(after: .sidebar) {
            #if os(macOS)
            Divider()
            Button(model.tabs.showsTabBar ? "Hide Tab Bar" : "Show Tab Bar") {
                model.tabs.showsTabBar.toggle()
            }
            .keyboardShortcut("t", modifiers: [.command, .shift])
            // Split view: a second document beside the tab's own, or below it. Xcode's
            // keys for its editors. With the split open, the other one turns it.
            Button("Split Right") { model.tabs.openSplit(.columns) }
                .keyboardShortcut("t", modifiers: [.command, .control])
                .disabled(!model.tabs.canSplit || model.tabs.split == .columns)
            Button("Split Down") { model.tabs.openSplit(.rows) }
                .keyboardShortcut("t", modifiers: [.command, .control, .option])
                .disabled(!model.tabs.canSplit || model.tabs.split == .rows)
            Button("Close Split") { model.tabs.closeSplit() }
                .keyboardShortcut("w", modifiers: [.command, .control, .shift])
                .disabled(model.tabs.split == nil)
            #endif
            Divider()
            // The window's mode. ⌥⌘P, the key Print Layout had: Typeset is where pages are.
            Picker("Mode", selection: Binding(
                get: { model.pageLayout.mode },
                set: { model.pageLayout.setMode($0) })) {
                Text("Write").tag(EditorMode.write)
                Text("Typeset").tag(EditorMode.typeset)
            }
            .pickerStyle(.inline)
            .disabled(!model.hasProject)
            Button(model.pageLayout.mode == .typeset ? "Back to Write" : "Typeset the Book") {
                model.pageLayout.setMode(model.pageLayout.mode == .typeset ? .write : .typeset)
            }
            .keyboardShortcut("p", modifiers: [.command, .option])
            .disabled(!model.hasProject)
            Toggle("E-book Preview", isOn: Binding(
                get: { model.pageLayout.typesetView == .digital },
                set: { model.pageLayout.setTypesetView($0 ? .digital : .print) }))
                .disabled(model.pageLayout.mode != .typeset)
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
        Button("Word (.docx)…") { model.pageLayout.export(.docx, scope: scope) }
        Button("EPUB…") { model.pageLayout.export(.epub, scope: scope) }
        Divider()
        Button("Markdown…") { model.pageLayout.export(.markdown, scope: scope) }
        Button("HTML…") { model.pageLayout.export(.html, scope: scope) }
        Button("Plain Text…") { model.pageLayout.export(.plainText, scope: scope) }
        if model.isScript {
            Divider()
            Button("Fountain…") { model.pageLayout.export(.fountain, scope: scope) }
            Button("Final Draft (.fdx)…") { model.pageLayout.export(.fdx, scope: scope) }
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
