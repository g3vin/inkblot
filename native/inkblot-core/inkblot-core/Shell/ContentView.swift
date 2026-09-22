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
    @State private var fullScreen = false
    @State private var chromeKeeper: WindowChrome.Keeper?

    var body: some View {
        @Bindable var sidebar = model.sidebar
        NavigationSplitView(columnVisibility: $columns) {
            FileTreeSidebar()
                .navigationSplitViewColumnWidth(min: 200, ideal: 240, max: 340)
                .toolbar(removing: .sidebarToggle)
                .overlay(alignment: .topLeading) {
                    SidebarToggleButton(edge: .leading, isPresented: treeBinding)
                        .padding(.leading, WindowChrome.leadingToggleX)
                        .padding(.top, WindowChrome.toggleInset)
                        .ignoresSafeArea(.container, edges: .top)
                }
        } detail: {
            EditorWebView(controller: model.web)
                .overlay { NotePreviewOverlay() }
                .overlay(alignment: .topLeading) {
                    if columns == .detailOnly {
                        SidebarToggleButton(edge: .leading, isPresented: treeBinding)
                            .padding(.leading, fullScreen ? WindowChrome.trafficLightsLeading : WindowChrome.leadingToggleX)
                            .padding(.top, WindowChrome.toggleInset)
                            .transition(.opacity)
                    }
                }
                .overlay(alignment: .topTrailing) {
                    if !sidebar.isPresented {
                        SidebarToggleButton(edge: .trailing, isPresented: $sidebar.isPresented)
                            .padding(.trailing, 16)
                            .padding(.top, WindowChrome.toggleInset)
                            .transition(.opacity)
                    }
                }
                .ignoresSafeArea(.all, edges: [.top, .bottom])
        }
        .inspector(isPresented: $sidebar.isPresented) {
            InspectorView()
                .inspectorColumnWidth(min: 260, ideal: 310, max: 520)
        }
        .background(WindowAccessor { window in
            chromeKeeper = WindowChrome.Keeper(window: window)
        })
        .onChange(of: columns, initial: true) { sendInset() }
        .onChange(of: fullScreen) { sendInset() }
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didEnterFullScreenNotification)) { _ in
            fullScreen = true
        }
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didExitFullScreenNotification)) { _ in
            fullScreen = false
        }
        .onChange(of: model.bridge.project.projectName) { sendInset() }
        .onChange(of: model.sidebar.isPresented) { sendInset() }
    }

    private var treeBinding: Binding<Bool> {
        Binding(get: { columns != .detailOnly },
                set: { visible in withAnimation(.spring(duration: 0.3)) { columns = visible ? .all : .detailOnly } })
    }

    /// What the floating controls cover of the page's top row.
    private func sendInset() {
        let gap: Double = 12
        let toggleEnd = Double(fullScreen ? WindowChrome.trafficLightsLeading : WindowChrome.leadingToggleX)
            + Double(WindowChrome.toggleSize)
        let leading = columns == .detailOnly ? toggleEnd + gap : 0
        let trailing = model.sidebar.isPresented ? 0 : 16 + Double(WindowChrome.toggleSize) + gap
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
