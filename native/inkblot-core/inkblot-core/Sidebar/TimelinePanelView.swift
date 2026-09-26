import SwiftUI

/// The inspector's Timeline panel: the timeline view's settings — what it shows, lanes,
/// eras, tags, the calendar — or the one event selected in it.
///
/// Built by the page as the map's inspector is (`useTimelinePanel.js`, published with
/// the view's toolbar as `timelineChromeChanged`) and drawn with the map's form view;
/// every edit goes back as a `timelineCommand` naming the field's id. The events, their
/// dates in the story's calendar and where each sits are all the page's.
struct TimelinePanelView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        if let state = model.bridge.timelineChrome {
            PanelFormView(panel: state.panel, send: MapPanelSender(bridge: model.bridge, surfaceId: state.surfaceId, owner: .timeline))
        } else {
            ContentUnavailableView {
                Label("No Timeline", systemImage: "calendar.day.timeline.left")
            } description: {
                Text("Open a timeline to arrange its events, or attach a passage to an event from the Timeline menu.")
            } actions: {
                Button(model.bridge.timelineCursor.lensOn ? "Hide Time Lens" : "Show Time Lens") {
                    model.bridge.send(.setTimeLens(SetTimeLensCommand(on: !model.bridge.timelineCursor.lensOn, editing: nil)))
                }
            }
        }
    }
}
