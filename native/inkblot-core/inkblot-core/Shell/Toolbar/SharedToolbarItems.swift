import SwiftUI

/// Items both toolbars offer, written once. None is in either default set: they are
/// shortcuts to things the inspector already has, for whoever wants them one click away.
struct SharedToolbarItems: CustomizableToolbarContent {
    let model: AppModel

    var body: some CustomizableToolbarContent {
        ToolbarItem(id: ToolbarItemID.snapshot.id) {
            Button("Snapshot Now", systemImage: "clock.badge.checkmark") {
                model.sidebar.versionAction(.snapshot)
            }
            .help("Save the current state as a version you can name")
            .disabled(model.sidebar.historyDocPath == nil)
        }
        .defaultCustomization(.hidden)

        panelItem(.clipboard, id: .clipboardPanel)
        panelItem(.workbench, id: .workbenchPanel)
        panelItem(.notes, id: .notesPanel)
        panelItem(.history, id: .historyPanel)
        panelItem(.references, id: .referencesPanel)
        panelItem(.stats, id: .statsPanel)

        ToolbarItem(id: ToolbarItemID.writingTimer.id) {
            TimerToolbarControl()
        }
        .defaultCustomization(.hidden)

    }

    /// Opens the inspector on one tab, or closes it if that tab is already showing — so
    /// the button reads as that panel's show/hide, lit while it is up.
    private func panelItem(_ tab: SidebarModel.Tab, id: ToolbarItemID) -> some CustomizableToolbarContent {
        ToolbarItem(id: id.id) {
            let sidebar = model.sidebar
            Toggle(isOn: Binding(
                get: { sidebar.isPresented && sidebar.tab == tab },
                set: { on in
                    withAnimation {
                        if on { sidebar.tab = tab }
                        sidebar.isPresented = on
                    }
                })) {
                Label(tab.title, systemImage: tab.symbol)
            }
            .help("Show the \(tab.title) panel")
        }
        .defaultCustomization(.hidden)
    }
}
