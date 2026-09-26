import AppKit
import SwiftUI

/// A segmented control of titles that fills its row, every segment the same width.
///
/// AppKit's control rather than SwiftUI's segmented `Picker`, for the same reason as
/// `SidebarTabPicker`: SwiftUI's sizes each segment to its title and the whole control
/// to its content, so in a panel whose rows re-measure as the page below them changes,
/// it shifts. `fillEqually` with low hugging makes the width the row's, and fixed.
struct SegmentedTextPicker<Option: Hashable>: NSViewRepresentable {
    let options: [Option]
    @Binding var selection: Option
    let title: (Option) -> String

    func makeNSView(context: Context) -> NSSegmentedControl {
        let control = NSSegmentedControl()
        control.trackingMode = .selectOne
        control.segmentDistribution = .fillEqually
        control.target = context.coordinator
        control.action = #selector(Coordinator.changed(_:))
        control.setContentHuggingPriority(.defaultLow, for: .horizontal)
        control.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return control
    }

    func updateNSView(_ control: NSSegmentedControl, context: Context) {
        context.coordinator.parent = self
        if control.segmentCount != options.count {
            control.segmentCount = options.count
        }
        for (index, option) in options.enumerated() where control.label(forSegment: index) != title(option) {
            control.setLabel(title(option), forSegment: index)
        }
        control.isEnabled = context.environment.isEnabled
        control.selectedSegment = options.firstIndex(of: selection) ?? -1
    }

    /// The row's width, whatever the titles would like.
    func sizeThatFits(_ proposal: ProposedViewSize, nsView: NSSegmentedControl, context: Context) -> CGSize? {
        guard let width = proposal.width, width.isFinite else { return nil }
        return CGSize(width: width, height: nsView.intrinsicContentSize.height)
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject {
        var parent: SegmentedTextPicker

        init(_ parent: SegmentedTextPicker) { self.parent = parent }

        @objc func changed(_ control: NSSegmentedControl) {
            guard parent.options.indices.contains(control.selectedSegment) else { return }
            parent.selection = parent.options[control.selectedSegment]
        }
    }
}
