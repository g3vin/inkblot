import SwiftUI

/// The window: the native file tree beside the document surface.
///
/// The page draws the middle — the formatting toolbar, the panes, the tab dock — until
/// each of those moves too. Both sidebars are native. What it
/// no longer draws is the file tree and the titlebar chrome it used to fake (traffic
/// light spacing, drag strip, fullscreen guessing); see `EditorWebController.nativeChrome`.
struct ContentView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var sidebar = model.sidebar
        NavigationSplitView {
            FileTreeSidebar()
                .navigationSplitViewColumnWidth(min: 180, ideal: 220, max: 320)
        } detail: {
            EditorWebView(controller: model.web)
                .ignoresSafeArea(.container, edges: .bottom)
        }
        .navigationSubtitle(subtitle)
        .inspector(isPresented: $sidebar.isPresented) {
            InspectorView()
                .inspectorColumnWidth(min: 260, ideal: 310, max: 520)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Reload", systemImage: "arrow.clockwise") { model.web.reload() }
                    .help("Reload the editor (autosave has already saved your work)")
            }
            ToolbarItem(placement: .primaryAction) {
                Button("Sidebar", systemImage: "sidebar.right") { sidebar.isPresented.toggle() }
                    .help(sidebar.isPresented ? "Hide the sidebar" : "Show the sidebar")
            }
        }
    }

    private var subtitle: String {
        guard let path = model.bridge.activeEditor?.docPath else { return "" }
        return docDisplayName(path: path)
    }
}
