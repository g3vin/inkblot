import AppKit
import SwiftUI

/// The right sidebar's selector bar: the system's own segmented control, as Xcode's
/// navigator and inspector bars are.
///
/// AppKit's control rather than SwiftUI's `Picker`, because only AppKit lets us ask for
/// the capsule: SwiftUI's segmented and `.tabs` pickers come out square-cornered in a
/// sidebar. On macOS 27 it also takes the tabs role (`NSSegmentedControl.Role.tabs`),
/// which is what Xcode's bars are. The look, the sliding selection, keyboard and
/// accessibility are all Apple's; an earlier hand-drawn glass bar never quite matched.
struct SidebarTabPicker<Tab: Hashable>: NSViewRepresentable {
    let tabs: [Tab]
    @Binding var selection: Tab
    let symbol: (Tab) -> String
    let title: (Tab) -> String

    func makeNSView(context: Context) -> NSSegmentedControl {
        let control = NSSegmentedControl()
        control.trackingMode = .selectOne
        control.segmentDistribution = .fillEqually
        control.borderShape = .capsule
        control.controlSize = .large
        if #available(macOS 27, *) {
            control.role = .tabs
        }
        control.target = context.coordinator
        control.action = #selector(Coordinator.changed(_:))
        control.setContentHuggingPriority(.defaultLow, for: .horizontal)
        control.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return control
    }

    func updateNSView(_ control: NSSegmentedControl, context: Context) {
        context.coordinator.parent = self
        if control.segmentCount != tabs.count {
            control.segmentCount = tabs.count
        }
        for (index, tab) in tabs.enumerated() {
            let image = NSImage(systemSymbolName: symbol(tab), accessibilityDescription: title(tab))
            control.setImage(image, forSegment: index)
            control.setToolTip(title(tab), forSegment: index)
        }
        control.isEnabled = context.environment.isEnabled
        control.selectedSegment = tabs.firstIndex(of: selection) ?? -1
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject {
        var parent: SidebarTabPicker

        init(_ parent: SidebarTabPicker) { self.parent = parent }

        @objc func changed(_ control: NSSegmentedControl) {
            guard parent.tabs.indices.contains(control.selectedSegment) else { return }
            parent.selection = parent.tabs[control.selectedSegment]
        }
    }
}
