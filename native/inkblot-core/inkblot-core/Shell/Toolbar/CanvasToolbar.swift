import AppKit
import SwiftUI

/// A canvas's own controls, in the window's own toolbar.
///
/// `CanvasToolbar.jsx`'s native twin, and built the way `DocumentToolbar` is: it
/// renders the `CanvasToolbarState` the page pushes and sends every button back as a
/// `canvasCommand` to the surface the state came from. The two take turns in the same
/// place — the page publishes this state only while no card is being edited, and
/// withdraws it the moment one is, which is when the document toolbar comes back.
///
/// Customizable (`ToolbarID.canvas`), with its own layout apart from a document's. So,
/// unlike the page, locked (read mode) disables the tools that create or change things
/// rather than removing them: a removed item would pull the rest of the user's layout
/// along with it. Zoom and the lock itself are how you read, and stay live.
struct CanvasToolbar: CustomizableToolbarContent {
    let model: AppModel
    let state: CanvasToolbarState

    var body: some CustomizableToolbarContent {
        ToolbarItem(id: ToolbarItemID.canvasLock.id) {
            Toggle(isOn: Binding(get: { state.locked }, set: { _ in send("toggle-lock") })) {
                Label(state.locked ? "Unlock Canvas" : "Lock Canvas",
                      systemImage: state.locked ? "lock.fill" : "lock.open")
            }
            .help(state.locked ? "Editing locked — press L to edit" : "Lock for reading (L)")
        }

        ToolbarSpacer(.fixed)

        ToolbarItem(id: ToolbarItemID.canvasAddCard.id) {
            Button("Add Card", systemImage: "plus.rectangle") { send("add-card") }
                .help("Add card")
                .disabled(state.locked)
        }
        ToolbarItem(id: ToolbarItemID.canvasAddImage.id) {
            Button("Add Image", systemImage: "photo") { send("add-image") }
                .help("Add image")
                .disabled(state.locked)
        }
        ToolbarItem(id: ToolbarItemID.canvasRecordMemo.id) {
            RecordButton(state: state) { send("record-memo") }
                .disabled(state.locked || !state.canRecord)
        }
        ToolbarItem(id: ToolbarItemID.canvasColor.id) {
            CanvasColorMenu(hasSelection: state.hasSelection && !state.locked) { color in
                send("apply-color", detail: color.map { ["color": $0] } ?? [:])
            }
        }

        ToolbarSpacer(.fixed)

        ToolbarItem(id: ToolbarItemID.canvasGroup.id) {
            // Ungroup replaces Group when the selection is groups, as on the page.
            Group {
                if state.canUngroup && !state.canGroup {
                    Button("Ungroup", systemImage: "rectangle.dashed") { send("ungroup") }
                        .help("Ungroup (⌘⇧G)")
                } else {
                    Button("Group", systemImage: "rectangle.on.rectangle") { send("group") }
                        .help("Group (⌘G)")
                        .disabled(!state.canGroup)
                }
            }
            .disabled(state.locked)
        }
        ToolbarItem(id: ToolbarItemID.canvasHistory.id) {
            ControlGroup {
                Button("Undo", systemImage: "arrow.uturn.backward") { send("undo") }
                    .help("Undo")
                    .disabled(!state.canUndo)
                Button("Redo", systemImage: "arrow.uturn.forward") { send("redo") }
                    .help("Redo")
                    .disabled(!state.canRedo)
            } label: {
                Label("Undo/Redo", systemImage: "arrow.uturn.backward")
            }
            .disabled(state.locked)
        }

        ToolbarSpacer(.fixed)

        ToolbarItem(id: ToolbarItemID.canvasGuides.id) {
            Toggle(isOn: Binding(get: { state.alignmentGuides }, set: { _ in send("toggle-guides") })) {
                Label("Alignment Guides", systemImage: "align.horizontal.center")
            }
            .help(state.alignmentGuides ? "Alignment guides on" : "Alignment guides off")
            .disabled(state.locked)
        }
        ToolbarItem(id: ToolbarItemID.canvasSnap.id) {
            Toggle(isOn: Binding(get: { state.snapToGrid }, set: { _ in send("toggle-grid") })) {
                Label("Snap to Grid", systemImage: "grid")
            }
            .help(state.snapToGrid ? "Snap to grid on" : "Snap to grid off")
            .disabled(state.locked)
        }

        ToolbarSpacer(.fixed)

        ToolbarItem(id: ToolbarItemID.canvasZoom.id) {
            ControlGroup {
                Button("Zoom Out", systemImage: "minus.magnifyingglass") { send("zoom-out") }
                    .help("Zoom out")
                Button { send("reset-zoom") } label: {
                    Text("\(Int((state.zoom * 100).rounded()))%")
                        .monospacedDigit()
                        .frame(minWidth: 40)
                }
                .help("Reset zoom to 100%")
                Button("Zoom In", systemImage: "plus.magnifyingglass") { send("zoom-in") }
                    .help("Zoom in")
                Button("Zoom to Fit", systemImage: "arrow.up.left.and.down.right.magnifyingglass") {
                    send("zoom-to-fit")
                }
                .help("Zoom to fit")
            } label: {
                Label("Zoom", systemImage: "plus.magnifyingglass")
            }
        }

        /* palette only */

        ToolbarItem(id: ToolbarItemID.canvasDelete.id) {
            Button("Delete Selection", systemImage: "trash") { send("delete") }
                .help("Delete the selection (⌫)")
                .disabled(state.locked || !state.hasSelection)
        }
        .defaultCustomization(.hidden)

        SharedToolbarItems(model: model)
    }

    private func send(_ command: String, detail: [String: Any]? = nil) {
        model.bridge.send(.canvasCommand(CanvasCommandRequest(
            surfaceId: state.surfaceId, command: command, detail: detail.map { AnyCodable($0) })))
    }
}

/// The memo recorder: a mic, or the running clock while it records.
private struct RecordButton: View {
    let state: CanvasToolbarState
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            if state.isRecording {
                HStack(spacing: 4) {
                    Image(systemName: "stop.circle.fill").foregroundStyle(.red)
                    Text(Self.duration(state.recordElapsedMs)).monospacedDigit()
                }
            } else {
                Label("Record Memo", systemImage: "mic")
            }
        }
        .help(state.isRecording ? "Stop recording" : "Record a voice memo")
    }

    /// `m:ss`, as the page's `formatDuration` writes it.
    static func duration(_ ms: Double) -> String {
        let total = Int(max(0, ms) / 1000)
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}

/// The canvas's six preset colours and the default, applied to the selection.
private struct CanvasColorMenu: View {
    let hasSelection: Bool
    /// A preset id (`"1"`–`"6"`), or `nil` for the default.
    let apply: (String?) -> Void

    /// `CANVAS_COLOR_PRESETS` in `canvasModel.js` — change them together.
    private static let presets: [(id: String, label: String, hex: String)] = [
        ("1", "Red", "#e5534b"),
        ("2", "Orange", "#e8873c"),
        ("3", "Yellow", "#e0b341"),
        ("4", "Green", "#4fb477"),
        ("5", "Cyan", "#3fa9c4"),
        ("6", "Purple", "#a07cd4"),
    ]

    var body: some View {
        Menu {
            ForEach(Self.presets, id: \.id) { preset in
                Button { apply(preset.id) } label: {
                    Label { Text(preset.label) } icon: { Image(nsImage: Self.swatch(preset.hex)) }
                }
            }
            Divider()
            Button("Default") { apply(nil) }
        } label: {
            Label("Color", systemImage: "paintpalette")
        }
        .help("Color")
        .disabled(!hasSelection)
    }

    /// A filled dot: a menu draws SF Symbols in the text colour, so the colour has to
    /// be in the image itself.
    private static func swatch(_ hex: String) -> NSImage {
        let color = NSColor(Color(hex: hex) ?? .gray)
        let image = NSImage(size: NSSize(width: 12, height: 12), flipped: false) { rect in
            color.setFill()
            NSBezierPath(ovalIn: rect.insetBy(dx: 0.5, dy: 0.5)).fill()
            return true
        }
        image.isTemplate = false
        return image
    }
}
