import SwiftUI

/// Customize Layout…: which panels each of the inspector's two layouts shows, and in
/// what order.
///
/// A column per layout listing every panel — the ones it shows first, ticked and in
/// order, then the rest. Ticking adds a panel at the end, dragging reorders, and changes
/// apply as they are made, so the inspector behind the sheet follows along.
struct InspectorLayoutEditor: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Customize Inspector Layout").font(.headline)
                Text("Choose the panels each layout shows. Drag to reorder them.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            HStack(alignment: .top, spacing: 16) {
                ForEach(InspectorLayout.allCases) { layout in
                    LayoutColumn(layout: layout)
                }
            }

            HStack {
                Button("Restore Defaults") {
                    model.sidebar.editLayouts { $0 = .defaults }
                }
                .disabled(model.sidebar.layouts == .defaults)
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 520)
    }
}

private struct LayoutColumn: View {
    @Environment(AppModel.self) private var model
    let layout: InspectorLayout

    var body: some View {
        let sidebar = model.sidebar
        let shown = sidebar.layouts[layout]

        VStack(alignment: .leading, spacing: 8) {
            Label(layout.title, systemImage: layout.symbol)
                .font(.subheadline.weight(.semibold))
            List {
                ForEach(sidebar.layouts.rows(for: layout)) { tab in
                    let isShown = shown.contains(tab)
                    Toggle(isOn: Binding(
                        get: { isShown },
                        set: { on in sidebar.editLayouts { $0.set(tab, shown: on, in: layout) } })) {
                        Label(tab.title, systemImage: tab.symbol)
                            .foregroundStyle(isShown ? .primary : .secondary)
                    }
                    // A layout always keeps one panel.
                    .disabled(shown == [tab])
                    .moveDisabled(!isShown)
                }
                .onMove { source, destination in
                    sidebar.editLayouts { $0.move(in: layout, fromOffsets: source, toOffset: destination) }
                }
            }
            .listStyle(.bordered)
            .frame(height: 190)
        }
        .frame(maxWidth: .infinity)
    }
}
