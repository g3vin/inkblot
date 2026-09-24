import SwiftUI

/// Each pane's word count, as a small tile of Liquid Glass.
///
/// Drawn over the web view where the page reports its own badges (`wordCountsChanged`),
/// which stay there invisible — so this draws and does not hit-test, and the page goes
/// on owning the count and whether it shows.
struct WordCountBadges: View {
    @Environment(AppModel.self) private var model

    /// Where this overlay is in the window, to bring the sidebar bar's centre into it.
    @State private var frame: CGRect = .zero

    var body: some View {
        ZStack(alignment: .topLeading) {
            // By position: split panes can show one document twice.
            ForEach(Array(model.bridge.wordCounts.enumerated()), id: \.offset) { _, badge in
                Text(badge.text)
                    .font(.system(size: 13))
                    .monospacedDigit()
                    .foregroundStyle(.primary.opacity(0.85))
                    .lineLimit(1)
                    .fixedSize()
                    // The page's badge is the same text in the same box — as tall as
                    // the file tree's + and filter bar.
                    .padding(.horizontal, 12)
                    .frame(height: 32)
                    .glassEffect(.regular, in: .capsule)
                    .position(x: (badge.left + badge.right) / 2, y: y(of: badge))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .onGeometryChange(for: CGRect.self, of: { $0.frame(in: .global) }) { frame = $0 }
        .allowsHitTesting(false)
    }

    /// Where the page puts it — except along the bottom of the window, where it sits
    /// level with the file tree's bottom bar. (A stacked split's upper badge is
    /// mid-window, and stays where the page puts it.)
    ///
    /// Along the bottom is any badge with no other under it, not one near the bottom:
    /// while the window is dragged taller the page's positions trail its height, and a
    /// badge judged by distance fell short of the bottom for a frame and jumped up to
    /// where the page last had it.
    private func y(of badge: WordCountBadge) -> CGFloat {
        let pageY = (badge.top + badge.bottom) / 2
        let isAbove = model.bridge.wordCounts.contains {
            $0.top >= badge.bottom && $0.left < badge.right && $0.right > badge.left
        }
        guard let barY = model.sidebarBarMidY, !isAbove else { return pageY }
        return barY - frame.minY
    }
}
