import SwiftUI

/// The window: the native file tree, the document surface under a native toolbar, and
/// the native sidebar.
///
/// All of it standard macOS 26 chrome: a unified toolbar with no title, whose glass
/// holds the formatting controls (`FormattingToolbar`); the sidebar toggle
/// NavigationSplitView provides; an inspector toggle as a toolbar item. AppKit places
/// the traffic lights and sizes the buttons, as it does for every other app.
///
/// This replaced a hidden titlebar with hand-placed traffic lights, which existed only
/// because the page's toolbar used to live in the toolbar band — where a real toolbar
/// would have swallowed its clicks. With the formatting controls native, nothing of the
/// page is up there any more.
struct ContentView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var sidebar = model.sidebar
        NavigationSplitView {
            FileTreeSidebar()
                .navigationSplitViewColumnWidth(min: 200, ideal: 240, max: 340)
        } detail: {
            EditorWebView(controller: model.web)
                .overlay { NotePreviewOverlay() }
                .ignoresSafeArea(.container, edges: .bottom)
                .toolbar {
                    FormattingToolbar(model: model)
                }
        }
        .inspector(isPresented: $sidebar.isPresented) {
            InspectorView()
                .inspectorColumnWidth(min: 260, ideal: 310, max: 520)
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        InspectorToggle(isPresented: $sidebar.isPresented)
                    }
                }
        }
        .toolbar {
            // With the inspector closed, its toggle stays at the window's trailing edge.
            if !sidebar.isPresented {
                ToolbarItem(placement: .primaryAction) {
                    InspectorToggle(isPresented: $sidebar.isPresented)
                }
            }
        }
        .toolbar(removing: .title)
    }
}

/// The inspector's show/hide button, as a standard toolbar item.
struct InspectorToggle: View {
    @Binding var isPresented: Bool

    var body: some View {
        Button {
            withAnimation { isPresented.toggle() }
        } label: {
            Label(isPresented ? "Hide Inspector" : "Show Inspector", systemImage: "sidebar.right")
        }
        .help(isPresented ? "Hide the sidebar" : "Show the sidebar")
    }
}
