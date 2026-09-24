#if os(macOS)
import AppKit
import SwiftUI

/// The window: the native file tree, the document surface under a native toolbar, and
/// the native sidebar.
///
/// All of it standard macOS 26 chrome: a regular-height unified toolbar with no title — a
/// band of Liquid Glass — holding the formatting controls (`DocumentToolbar`), or on a
/// canvas the canvas's own (`CanvasToolbar`) until a card is being edited, the sidebar
/// toggle NavigationSplitView provides, and an inspector toggle in the top-right corner.
/// The first two are the user's to rearrange (Customize Toolbar…, see `ToolbarItemID`);
/// the toggles are fixed.
/// AppKit places the traffic lights and sizes the buttons, as it does for every other
/// app.
///
/// This replaced a hidden titlebar with hand-placed traffic lights, which existed only
/// because the page's toolbar lived in the toolbar band, where a real toolbar would have
/// swallowed its clicks. With the formatting controls native, nothing of the page is up
/// there any more.
///
/// The two sidebars and the toolbar are translucent glass, and the page runs on
/// underneath them: the detail column ignores the safe area they leave, so a canvas
/// carries on to the window's edges and a document scrolls up under the toolbar, showing
/// through the glass. The page is told how much of each side they cover
/// (`setPanelInsets`) so a document's text starts in the uncovered part.
struct ContentView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openWindow) private var openWindow
    @Environment(\.dismissWindow) private var dismissWindow
    /// How far the sidebars reach over the page. Held outside SwiftUI's state on purpose:
    /// it is a measurement, and a measurement written into state re-renders the window,
    /// which re-measures it — SwiftUI reports that as a geometry action cycling, and the
    /// sidebars' glass as updated more than once a frame.
    @State private var panelInsets = PanelInsetsBox()
    /// Whether the canvas's controls hold the toolbar rather than the formatting ones.
    /// Mirrors `bridge.canvasToolbar != nil`, but flipped inside `withAnimation`: the
    /// bridge is not SwiftUI and sets its state plainly, so without the mirror the two
    /// toolbars would snap from one to the other.
    @State private var canvasToolbarShown = false
    /// The narrowest the window may get and the widest the inspector may, from the
    /// panes' current widths. State, unlike `panelInsets`, because layout reads it — and
    /// safe to be, because neither limit moves anything that feeds the measurement.
    @State private var paneLimits = PaneLimits()

    var body: some View {
        @Bindable var sidebar = model.sidebar
        NavigationSplitView {
            FileTreeSidebar()
                // Inside the column width, which has to be the column's outermost
                // modifier or SwiftUI ignores its ideal.
                .onGeometryChange(for: CGFloat.self, of: { $0.size.width.rounded() }) { width in
                    // Not while it animates open or closed: the limits must hold still
                    // through a collapse, or they fight it.
                    if width >= PaneLimits.sidebarMin, width != paneLimits.sidebar { paneLimits.sidebar = width }
                }
                .navigationSplitViewColumnWidth(min: PaneLimits.sidebarMin, ideal: 240, max: 340)
        } detail: {
            EditorWebView(controller: model.web, onLiveResizeEnd: publishPanelInsets)
                .overlay {
                    WorkspaceOverlay()
                    WordCountBadges()
                    PrintLayoutControls()
                    NotePreviewOverlay()
                }
                // Under the sidebars and the toolbar, so the page shows through their
                // glass instead of a blank band.
                .ignoresSafeArea(.container)
                // Measured on the view that ignores the safe area, so these are how far
                // the sidebars and the toolbar reach over it.
                .onGeometryChange(for: EdgeInsets.self, of: \.safeAreaInsets) { insets in
                    panelInsets.measured = insets
                    // While the window is being resized, SwiftUI lays the column out
                    // again on every other pass as if the toolbar and the inspector were
                    // not there — top and trailing 0, or partway — and reports those
                    // passes here as well. Passed on, they jerked the text up a toolbar's
                    // height for a frame. A window resize moves none of the chrome, so
                    // the page keeps what it has until the drag ends.
                    guard !model.web.webView.inLiveResize else { return }
                    publishPanelInsets()
                }
                // On a canvas its own controls take the document toolbar's place until a
                // card's text is being edited — the page says which (`canvasToolbar`).
                //
                // Two customizable toolbars, so each keeps its own layout: the id is what
                // AppKit saves a layout under, and it switches with the contents. One
                // modifier on the page itself — not one per toolbar on hidden views in a
                // `.background`, which looped the split view's constraint pass until
                // AppKit threw once the window got narrow.
                .toolbar(id: canvasToolbarShown && model.bridge.canvasToolbar != nil
                         ? ToolbarID.canvas : ToolbarID.document) {
                    if canvasToolbarShown, let canvas = model.bridge.canvasToolbar {
                        CanvasToolbar(model: model, state: canvas)
                    } else {
                        DocumentToolbar(model: model)
                    }
                }
        }
        .inspector(isPresented: $sidebar.isPresented) {
            InspectorView()
                .inspectorColumnWidth(min: PaneLimits.inspectorMin, ideal: 310, max: paneLimits.inspectorMax)
        }
        // The page must stay at least as wide as the inspector — see `PaneLimits`.
        .onGeometryChange(for: CGFloat.self, of: { $0.size.width.rounded() }) { width in
            if width != paneLimits.window { paneLimits.window = width }
        }
        .frame(minWidth: paneLimits.windowMin)
        // No `.toolbar {}` anywhere else in this window: a single non-customizable one
        // turns Customize Toolbar… off. The inspector toggle is a titlebar accessory
        // instead, in the window's top-right corner.
        .background { InspectorTitlebarToggle(sidebar: model.sidebar) }
        .background { ToolbarContextMenu(sidebar: model.sidebar) }
        // Customize Layout…, from the selector bar, the toolbar or the View menu.
        .sheet(isPresented: $sidebar.isCustomizingLayout) {
            InspectorLayoutEditor().environment(model)
        }
        .toolbar(removing: .title)
        // Clear: the buttons are glass over the page, not over a bar of window colour.
        .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
        // The bubble editor is modal: nothing of the toolbar can act while it is up. Hiding
        // the toolbar also lets the editor's own controls take clicks in its row — a shown
        // toolbar keeps its whole band — and takes the traffic lights with it, so the
        // editor draws them again (`BubbleWindowButtons`) where they were.
        //
        // Nor is there anything to format or toggle while the page is still opening the
        // project the picker chose: the window keeps only its traffic lights until it has. One modifier for
        // both, so the two conditions cannot fight over which one wins.
        .toolbarVisibility(model.bubble.open == nil && hasContent ? .automatic : .hidden, for: .windowToolbar)
        .animation(.easeOut(duration: 0.2), value: model.bubble.open == nil)
        // Over everything, sidebars included: the bubble editor is modal, and its edges
        // are the window's, where set-aside words go.
        .overlay { BubbleOverlay() }
        // Only the swap animates — not every zoom tick or selection change inside the
        // canvas toolbar, which is why this watches whether there is one, not what it is.
        .onChange(of: model.bridge.canvasToolbar != nil, initial: true) { _, shown in
            withAnimation(.smooth(duration: 0.3)) { canvasToolbarShown = shown }
        }
        // A new project is a new page, which starts not knowing them.
        .onChange(of: model.bridge.project.projectName) { old, new in
            sendPanelInsets()
            // The page closed its project (it was deleted or moved away): back to the
            // picker, as there is nothing here to edit.
            if old != nil, new == nil { dismissWindow(id: "main") }
        }
        // Closing the editor goes back to the picker, as closing a project does in Xcode.
        .onDisappear { openWindow(id: ProjectPickerView.windowID) }
    }

    /// Whether a project or a document is open yet.
    private var hasContent: Bool {
        model.bridge.project.projectName != nil || model.bridge.activeEditor?.docPath != nil
    }

    /// The last measurement, if the page does not have it yet.
    private func publishPanelInsets() {
        guard panelInsets.measured != panelInsets.value else { return }
        panelInsets.value = panelInsets.measured
        sendPanelInsets()
    }

    private func sendPanelInsets() {
        let insets = panelInsets.value
        model.bridge.send(.setPanelInsets(SetPanelInsetsCommand(
            leading: Double(insets.leading), trailing: Double(insets.trailing), top: Double(insets.top))))
        if model.notePreviews.panelInsets != insets { model.notePreviews.panelInsets = insets }
    }
}

/// The inspector's show/hide button, in the titlebar's top-right corner
/// (`InspectorTitlebarToggle`).
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

/// Keeps the page at least as wide as the inspector, which SwiftUI needs and does not
/// enforce.
///
/// Once the page column would be narrower than the inspector, SwiftUI's split view
/// re-lays the columns out at different widths on every constraint pass, and AppKit
/// ends it by throwing ("more Update Constraints in Window passes than there are
/// views"): the app crashes. Narrowing the window got there, and so did dragging the
/// inspector's divider wider, or showing and hiding the inspector in a narrow window.
/// It happens with no toolbar, no overlays and empty panels, so it is the split view
/// itself, and the only cure is not to get there:
///
/// - **The inspector stops growing** at what leaves the page as wide as it (plus
///   `margin`): its maximum follows the window, so narrowing the window narrows it too,
///   and its divider cannot be dragged past the page.
/// - **The window stops shrinking** where even the inspector's minimum would no longer
///   leave that much, whether or not it is open, so it can always be opened.
///
/// Neither limit may depend on the inspector's own width. That changes on every frame
/// of its show and hide animations, and a minimum that moves mid-animation starts the
/// same loop — an earlier version crashed that way. The file tree's width counts only
/// at or above its minimum, for the same reason: below that it is animating.
nonisolated struct PaneLimits: Equatable, Sendable {
    static let sidebarMin: CGFloat = 200
    static let inspectorMin: CGFloat = 260
    static let inspectorMax: CGFloat = 520
    /// The window's own floor (`InkblotApp`).
    static let windowFloor: CGFloat = 760
    /// How much wider than the inspector the page stays, for the dividers and rounding.
    static let margin: CGFloat = 16

    /// The file tree's width, the last one seen while it was open, so that showing it
    /// again in a narrow window still fits.
    var sidebar: CGFloat = 240
    /// The window content's width; 0 until measured.
    var window: CGFloat = 0

    var windowMin: CGFloat {
        max(Self.windowFloor, sidebar + 2 * Self.inspectorMin + Self.margin)
    }

    var inspectorMax: CGFloat {
        guard window > 0 else { return Self.inspectorMax }
        let half = ((window - sidebar - Self.margin) / 2).rounded(.down)
        return min(Self.inspectorMax, max(Self.inspectorMin, half))
    }
}

/// A value SwiftUI does not watch.
private final class PanelInsetsBox {
    /// What the page was last sent.
    var value = EdgeInsets()
    /// What SwiftUI last reported, which during a window resize the page is not sent.
    var measured = EdgeInsets()
}
#endif
