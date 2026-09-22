import AppKit
import SwiftUI

/// The window: the native file tree, the document surface, the native sidebar.
///
/// There is no titlebar row. The page's own toolbar is the top of the window, the
/// traffic lights float over the file tree (or, with the tree hidden, over the start of
/// the page's toolbar — the shell tells the page how much room to leave), and the right
/// sidebar has its own glass toggle at its top. See `setTitlebarInset`.
struct ContentView: View {
    @Environment(AppModel.self) private var model
    @State private var columns: NavigationSplitViewVisibility = .all
    @State private var fullScreen = false

    /// The traffic lights' span from the window's leading edge, plus a little air.
    private static let trafficLightsInset: Double = 78

    var body: some View {
        @Bindable var sidebar = model.sidebar
        NavigationSplitView(columnVisibility: $columns) {
            FileTreeSidebar()
                .navigationSplitViewColumnWidth(min: 180, ideal: 220, max: 320)
                .toolbar(removing: .sidebarToggle)
        } detail: {
            EditorWebView(controller: model.web)
                .overlay { NotePreviewOverlay() }
                .overlay(alignment: .topTrailing) {
                    // With the sidebar closed, the way back to it floats where its own
                    // button was. The page leaves room for it (see sendInset).
                    if !sidebar.isPresented {
                        SidebarToggleButton(isPresented: $sidebar.isPresented)
                            .padding(.top, 10)
                            .padding(.trailing, 12)
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
        let treeShowing = columns != .detailOnly
        let leading = treeShowing || fullScreen ? 0 : Self.trafficLightsInset
        let trailing: Double = model.sidebar.isPresented ? 0 : 56
        model.bridge.send(.setTitlebarInset(SetTitlebarInsetCommand(leading: leading, trailing: trailing)))
    }
}
