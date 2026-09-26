import SwiftUI

/// The Timeline menu: attach the selection to an event, the time lens, and the handles
/// for dragging where passages start and stop.
///
/// Every item is a command to the page, which owns the chronology; the switches' states
/// come back as `timelineCursorChanged` (`ShellBridge.timelineCursor`), so the ticks
/// are the page's.
struct TimelineMenuItems: View {
    let model: AppModel

    var body: some View {
        let cursor = model.bridge.timelineCursor
        Button("Attach Selection to New Event") { attach() }
            .disabled(model.target == nil)
        Divider()
        Toggle("Time Lens", isOn: Binding(
            get: { cursor.lensOn },
            set: { model.bridge.send(.setTimeLens(SetTimeLensCommand(on: $0, editing: nil))) }))
        Toggle("Move the Lens", isOn: Binding(
            get: { cursor.lensEditing },
            set: { model.bridge.send(.setTimeLens(SetTimeLensCommand(on: nil, editing: $0))) }))
            .disabled(!cursor.lensOn)
        Toggle("Edit Timeline Passages", isOn: Binding(
            get: { cursor.editingRanges },
            set: { model.bridge.send(.setTimelineRangeEditing(SetTimelineRangeEditingCommand(on: $0))) }))
        Divider()
        Button("Show Timeline Inspector") {
            model.sidebar.isPresented = true
            model.sidebar.tab = .timeline
        }
        .disabled(!model.sidebar.hasTimeline)
    }

    /// The selection as the page sees it, then attached — by anchor, so the passage is
    /// the text that was selected even if the page moved on in between.
    private func attach() {
        let target = model.target
        Task {
            guard case .selectionContext(let context)? = try? await model.bridge.request(.getSelectionContext(EditorQuery(target: target))),
                  !context.empty, !context.isCanvas, let editor = context.target ?? target
            else { return }
            model.bridge.send(.attachTimelineEvent(AttachTimelineEventCommand(target: editor, anchor: context.anchor, eventId: nil, title: nil)))
        }
    }
}
