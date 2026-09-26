import SwiftUI

/// A timeline view's own controls, in the window's own toolbar.
///
/// The page's timeline tool bar (`TimelineToolbar.jsx`) made native, as the map's was
/// (`MapToolbar`): it draws the `TimelineChromeState` the page pushes and sends every
/// button back as a `timelineCommand` to the view the state came from. It takes the
/// document toolbar's place while a timeline view is the active document, with its own
/// saved layout (`ToolbarID.timeline`). The view's inspector is a panel of the window's
/// inspector (`TimelinePanelView`).
struct TimelineToolbar: CustomizableToolbarContent {
    let model: AppModel
    let state: TimelineChromeState

    var body: some CustomizableToolbarContent {
        ToolbarItem(id: ToolbarItemID.timelineAddEvent.id) {
            Button("Add Event", systemImage: "plus") { send("add-event") }
                .help("Add an event at the story’s “now”")
        }

        ToolbarItem(id: ToolbarItemID.timelineScale.id) {
            Picker("Show As", selection: Binding(
                get: { state.scale },
                set: { send("scale", ["value": $0.rawValue]) })) {
                Text("By Date").tag(TimelineScale.time)
                Text("In Order").tag(TimelineScale.sequence)
                Text("Manuscript").tag(TimelineScale.manuscript)
            }
            .pickerStyle(.segmented)
            .help("The chronology by date, in order, or the manuscript joined to when each passage happens")
        }

        ToolbarSpacer(.fixed)

        ToolbarItem(id: ToolbarItemID.timelineHistory.id) {
            ControlGroup {
                Button("Undo", systemImage: "arrow.uturn.backward") { send("undo") }
                    .help("Undo (⌘Z)")
                    .disabled(!state.canUndo)
                Button("Redo", systemImage: "arrow.uturn.forward") { send("redo") }
                    .help("Redo (⇧⌘Z)")
                    .disabled(!state.canRedo)
            } label: {
                Label("Undo/Redo", systemImage: "arrow.uturn.backward")
            }
        }

        ToolbarItem(id: ToolbarItemID.timelineZoom.id) {
            ControlGroup {
                Button("Zoom Out", systemImage: "minus.magnifyingglass") { send("zoom-out") }
                Button("Show Everything", systemImage: "arrow.up.left.and.down.right.magnifyingglass") { send("fit") }
                    .help("Show everything (⌘0)")
                Button("Zoom In", systemImage: "plus.magnifyingglass") { send("zoom-in") }
            } label: {
                Label("Zoom", systemImage: "plus.magnifyingglass")
            }
        }

        ToolbarItem(id: ToolbarItemID.timelineLens.id) {
            Toggle(isOn: Binding(get: { state.lensOn }, set: { _ in send("lens") })) {
                Label("Time Lens", systemImage: "scope")
            }
            .help("Highlight the passages whose events fall in a window of time")
        }

        /* palette only */

        ToolbarItem(id: ToolbarItemID.timelineDelete.id) {
            Button("Delete Event", systemImage: "trash") { send("delete") }
                .help("Delete the selected event (⌫)")
                .disabled(!state.hasSelection)
        }
        .defaultCustomization(.hidden)

        SharedToolbarItems(model: model)
    }

    private func send(_ command: String, _ detail: [String: Any]? = nil) {
        model.bridge.send(.timelineCommand(TimelineCommandRequest(
            surfaceId: state.surfaceId, command: command, detail: detail.map { AnyCodable($0) })))
    }
}
