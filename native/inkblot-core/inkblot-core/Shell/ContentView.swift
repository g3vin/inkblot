import AppKit
import SwiftUI

/// The window: the native file tree, the document surface, the native sidebar.
///
/// No title and no toolbar row. The page's own toolbar is the top of the window; the
/// traffic lights and the two sidebar toggles float on the same line over it, placed by
/// `WindowChrome` to macOS 26's toolbar-window metrics. The page is told how much of its
/// top row they cover (`setTitlebarInset`): with the file tree showing, the lights and
/// the left toggle are over the tree and cover nothing of the page.
struct ContentView: View {
    @Environment(AppModel.self) private var model
    @State private var columns: NavigationSplitViewVisibility = .all
    @State private var chromeKeeper: WindowChrome.Keeper?

    var body: some View {
        @Bindable var sidebar = model.sidebar
        NavigationSplitView(columnVisibility: $columns) {
            FileTreeSidebar()
                .navigationSplitViewColumnWidth(min: 200, ideal: 240, max: 340)
                .toolbar(removing: .sidebarToggle)
        } detail: {
            EditorWebView(controller: model.web)
                .overlay { NotePreviewOverlay() }
                .ignoresSafeArea(.all, edges: [.top, .bottom])
        }
        .inspector(isPresented: $sidebar.isPresented) {
            InspectorView()
                .inspectorColumnWidth(min: 260, ideal: 310, max: 520)
        }
        // The toggles belong to the window, not to the panels they open: they stay put in
        // the top corners whether their sidebar is open or closed.
        .overlay(alignment: .topLeading) {
            SidebarToggleButton(edge: .leading, isPresented: treeBinding)
                .padding(.leading, WindowChrome.leadingToggleX)
                .padding(.top, WindowChrome.toggleInset)
                .ignoresSafeArea(.container, edges: .top)
        }
        .overlay(alignment: .topTrailing) {
            SidebarToggleButton(edge: .trailing, isPresented: $sidebar.isPresented)
                .padding(.trailing, WindowChrome.trailingToggleInset)
                .padding(.top, WindowChrome.toggleInset)
                .ignoresSafeArea(.container, edges: .top)
        }
        .background(WindowAccessor { window in
            chromeKeeper = WindowChrome.Keeper(window: window)
        })
        .onChange(of: columns, initial: true) { sendInset() }
        .onChange(of: model.bridge.project.projectName) { sendInset() }
        .onChange(of: model.sidebar.isPresented) { sendInset() }
    }

    private var treeBinding: Binding<Bool> {
        Binding(get: { columns != .detailOnly },
                set: { visible in withAnimation(.spring(duration: 0.3)) { columns = visible ? .all : .detailOnly } })
    }

    /// What the floating controls cover of the page's top row. The toggles never move, so
    /// this only changes with which sidebars are open: an open sidebar is under its own
    /// toggle (and the lights), a closed one leaves them over the page.
    private func sendInset() {
        let gap: Double = 12
        let leading = columns == .detailOnly
            ? Double(WindowChrome.leadingToggleX + WindowChrome.toggleSize) + gap
            : 0
        let trailing = model.sidebar.isPresented
            ? 0
            : Double(WindowChrome.trailingToggleInset + WindowChrome.toggleSize) + gap
        model.bridge.send(.setTitlebarInset(SetTitlebarInsetCommand(leading: leading, trailing: trailing)))
    }
}

/// Hands the hosting window to SwiftUI code once it exists.
private struct WindowAccessor: NSViewRepresentable {
    let onWindow: (NSWindow) -> Void

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async { [weak view] in
            if let window = view?.window { onWindow(window) }
        }
        return view
    }

    func updateNSView(_ view: NSView, context: Context) {}
}
