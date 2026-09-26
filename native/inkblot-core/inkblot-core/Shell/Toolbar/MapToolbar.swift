import SwiftUI

/// A map's own controls, in the window's own toolbar.
///
/// The page's floating map tool bar (`MapToolbar.jsx`), made native the way the canvas's
/// was (`CanvasToolbar`): it renders the `MapChromeState` the page pushes and sends every
/// button back as a `mapCommand` to the surface the state came from. It takes the
/// document toolbar's place while a map is the active document — the page publishes the
/// state only then — with its own saved layout (`ToolbarID.map`).
///
/// The map's inspector is not here: it is a panel of the window's inspector
/// (`MapPanelView`), shown and hidden by the inspector toggle like every other panel.
struct MapToolbar: CustomizableToolbarContent {
    let model: AppModel
    let state: MapChromeState

    var body: some CustomizableToolbarContent {
        ToolbarItem(id: ToolbarItemID.mapDrawingTools.id) {
            MapToolButtons(tools: MapToolOption.drawing, state: state, send: send)
        }
        ToolbarItem(id: ToolbarItemID.mapMeasureTools.id) {
            MapToolButtons(tools: MapToolOption.measuring, state: state, send: send)
        }

        ToolbarSpacer(.fixed)

        ToolbarItem(id: ToolbarItemID.mapHistory.id) {
            MapHistoryButtons(state: state, send: send)
        }

        ToolbarSpacer(.fixed)

        ToolbarItem(id: ToolbarItemID.mapZoom.id) {
            MapZoomButtons(state: state, send: send)
        }

        /* palette only */

        ToolbarItem(id: ToolbarItemID.mapDelete.id) {
            Button("Delete Selection", systemImage: "trash") { send("delete") }
                .help("Delete the selection (⌫)")
                .disabled(!state.hasSelection)
        }
        .defaultCustomization(.hidden)

        SharedToolbarItems(model: model)
    }

    private func send(_ command: String, _ detail: [String: Any]?) {
        model.bridge.send(.mapCommand(MapCommandRequest(
            surfaceId: state.surfaceId, command: command, detail: detail.map { AnyCodable($0) })))
    }

    private func send(_ command: String) { send(command, nil) }
}

/// One of the map's tools as the toolbar offers it — the page's `MAP_TOOLS`, with the
/// same keys.
struct MapToolOption: Identifiable {
    let tool: MapTool
    let title: String
    let symbol: String
    let key: String
    var id: MapTool { tool }

    static let drawing = [
        MapToolOption(tool: .select, title: "Select and Move", symbol: "cursorarrow", key: "V"),
        MapToolOption(tool: .pin, title: "Place", symbol: "mappin", key: "P"),
        MapToolOption(tool: .route, title: "Route", symbol: "point.topleft.down.to.point.bottomright.curvepath", key: "R"),
        MapToolOption(tool: .region, title: "Region", symbol: "pentagon", key: "G"),
        MapToolOption(tool: .label, title: "Label", symbol: "textformat", key: "T"),
    ]

    static let measuring = [
        MapToolOption(tool: .ruler, title: "Measure Distance", symbol: "ruler", key: "M"),
        MapToolOption(tool: .area, title: "Measure Area", symbol: "square.dashed", key: "A"),
    ]
}

/// A row of tools, the one in hand lit. Choosing the one in hand again puts it down, back
/// to Select, as Esc does on the page.
struct MapToolButtons: View {
    let tools: [MapToolOption]
    let state: MapChromeState
    let send: (String, [String: Any]?) -> Void

    var body: some View {
        ControlGroup {
            ForEach(tools) { option in
                Toggle(isOn: Binding(
                    get: { state.tool == option.tool },
                    set: { on in send("tool", ["tool": (on ? option.tool : .select).rawValue]) })) {
                    Label(option.title, systemImage: option.symbol)
                }
                .help("\(option.title) (\(option.key))")
            }
        } label: {
            Label(tools.first?.tool == .select ? "Tools" : "Measure", systemImage: tools.first?.symbol ?? "cursorarrow")
        }
    }
}

struct MapHistoryButtons: View {
    let state: MapChromeState
    let send: (String, [String: Any]?) -> Void

    var body: some View {
        ControlGroup {
            Button("Undo", systemImage: "arrow.uturn.backward") { send("undo", nil) }
                .help("Undo (⌘Z)")
                .disabled(!state.canUndo)
            Button("Redo", systemImage: "arrow.uturn.forward") { send("redo", nil) }
                .help("Redo (⇧⌘Z)")
                .disabled(!state.canRedo)
        } label: {
            Label("Undo/Redo", systemImage: "arrow.uturn.backward")
        }
    }
}

struct MapZoomButtons: View {
    let state: MapChromeState
    let send: (String, [String: Any]?) -> Void

    var body: some View {
        ControlGroup {
            Button("Zoom Out", systemImage: "minus.magnifyingglass") { send("zoom-out", nil) }
                .help("Zoom out")
            Button { send("zoom-to-fit", nil) } label: {
                Text(state.zoomLabel)
                    .monospacedDigit()
                    .frame(minWidth: 44)
            }
            .help("Zoom to fit (⌘0)")
            Button("Zoom In", systemImage: "plus.magnifyingglass") { send("zoom-in", nil) }
                .help("Zoom in")
            Button("Zoom to Fit", systemImage: "arrow.up.left.and.down.right.magnifyingglass") {
                send("zoom-to-fit", nil)
            }
            .help("Zoom to fit (⌘0)")
        } label: {
            Label("Zoom", systemImage: "plus.magnifyingglass")
        }
    }
}
