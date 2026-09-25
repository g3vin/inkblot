#if !os(macOS)
import SwiftUI

/// The window on iPadOS and iOS: the same three columns as the Mac, laid out the way
/// the platform lays them out.
///
/// The Mac's window has no titlebar row and floats its own toggles over the page (see
/// `WindowChrome`). Here `NavigationSplitView` brings the platform's own: a sidebar
/// button that also collapses to a single column on a phone, and the inspector as a
/// sheet in compact width. The page is told the traffic lights cover nothing, because
/// there are none, and it keeps the safe area — the status bar is not the page's.
struct ContentView: View {
    @Environment(AppModel.self) private var model
    @State private var columns: NavigationSplitViewVisibility = .automatic

    var body: some View {
        @Bindable var sidebar = model.sidebar
        NavigationSplitView(columnVisibility: $columns) {
            FileTreeSidebar()
        } detail: {
            EditorWebView(controller: model.web)
                .overlay { NotePreviewOverlay() }
                .ignoresSafeArea(.container, edges: .bottom)
                // Above the keyboard: SwiftUI lifts bottom insets clear of it.
                .safeAreaInset(edge: .bottom, spacing: 0) { FormattingAccessory() }
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            sidebar.isPresented.toggle()
                        } label: {
                            Label("Inspector", systemImage: "sidebar.right")
                        }
                    }
                }
                .toolbar(removing: .title)
        }
        .inspector(isPresented: $sidebar.isPresented) {
            InspectorView()
        }
        .onAppear(perform: sendInset)
        .onChange(of: model.bridge.project.projectName) { sendInset() }
    }

    private func sendInset() {
        model.bridge.send(.setTitlebarInset(SetTitlebarInsetCommand(leading: 0, trailing: 0)))
    }
}
#endif
