import AppKit
import SwiftUI

/// The window: the native file tree, the document surface, the native sidebar.
///
/// There is no titlebar row. The page's own toolbar is the top of the window, the
/// traffic lights float over the file tree (or, with the tree hidden, over the start of
/// the page's toolbar — the shell tells the page how much room to leave), and each
/// sidebar has its own glass toggle in its top corner. See `setTitlebarInset`.
struct ContentView: View {
    @Environment(AppModel.self) private var model
    @State private var columns: NavigationSplitViewVisibility = .all
    @State private var fullScreen = false

    /// The traffic lights' span from the window's leading edge, plus a little air.
    private static let trafficLightsInset: Double = 78

    var body: some View {
        @Bindable var sidebar = model.sidebar
        NavigationSplitView(columnVisibility: $columns) {
            FileTreeSidebar(isPresented: Binding(
                get: { columns != .detailOnly },
                set: { columns = $0 ? .all : .detailOnly }))
                .navigationSplitViewColumnWidth(min: 180, ideal: 220, max: 320)
                .toolbar(removing: .sidebarToggle)
        } detail: {
            EditorWebView(controller: model.web)
                .overlay { NotePreviewOverlay() }
                .overlay(alignment: .topTrailing) {
                    // With a sidebar closed, the way back to it floats where its own
                    // button was. The page leaves room for both (see sendInset).
                    if !sidebar.isPresented {
                        SidebarToggleButton(edge: .trailing, isPresented: $sidebar.isPresented)
                            .padding(.top, SidebarToggleButton.topInset)
                            .padding(.trailing, 12)
                            .transition(.opacity.combined(with: .scale(scale: 0.8)))
                    }
                }
                .overlay(alignment: .topLeading) {
                    if columns == .detailOnly {
                        SidebarToggleButton(edge: .leading, isPresented: Binding(
                            get: { false }, set: { if $0 { columns = .all } }))
                            .padding(.top, SidebarToggleButton.topInset)
                            .padding(.leading, fullScreen ? 12 : Self.trafficLightsInset)
                            .transition(.opacity.combined(with: .scale(scale: 0.8)))
                    }
                }
                .ignoresSafeArea(.all, edges: [.top, .bottom])
        }
        .inspector(isPresented: $sidebar.isPresented) {
            InspectorView()
                .inspectorColumnWidth(min: 260, ideal: 310, max: 520)
        }
        .toolbar(removing: .title)
        .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
        .onChange(of: columns, initial: true) { sendInset() }
        .animation(.spring(duration: 0.3), value: columns)
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

    /// Room for the traffic lights only when they are over the page: the file tree is
    /// hidden, and the window is not full screen (which has none).
    private func sendInset() {
        // Hidden tree: the traffic lights (unless full screen) and then its toggle.
        let toggle = Double(SidebarToggleButton.size) + 12
        let treeShowing = columns != .detailOnly
        let leading = treeShowing ? 0 : (fullScreen ? 12 : Self.trafficLightsInset) + toggle
        let trailing: Double = model.sidebar.isPresented ? 0 : toggle + 12
        model.bridge.send(.setTitlebarInset(SetTitlebarInsetCommand(leading: leading, trailing: trailing)))
    }
}
