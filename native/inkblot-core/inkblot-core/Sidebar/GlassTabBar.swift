import SwiftUI

/// A Liquid Glass selector bar — Xcode's navigator bar, with the grab-and-slide lens of an
/// iOS 26 tab bar.
///
/// At rest it is what Apple's is: the icons on a glass capsule, the selected one in the
/// accent colour on a soft grey pill. Press on the selection and the pill lifts off the
/// bar as a *clear* glass lens — larger than the bar, floating above it, magnifying the
/// icons it passes over — follows the pointer, and on release settles back into the grey
/// pill on the tab it was let go over. A plain click on any icon just selects it.
///
/// Layering is the whole trick, and it is easy to get backwards:
///   - the bar's glass is at the bottom
///   - the resting pill is plain fill, *under* the icons
///   - the icons
///   - the lifted lens is glass *above* the icons, because glass refracts what is behind
///     it — that is what makes it read as a lens and not a highlight
/// A `GlassEffectContainer` draws its glass over plain content inside it, so nothing here
/// shares one: an earlier version put the icons in a container and they came out frosted.
struct GlassTabBar<Tab: Hashable>: View {
    let tabs: [Tab]
    @Binding var selection: Tab
    let symbol: (Tab) -> String
    let title: (Tab) -> String

    /// Where the lifted lens's centre is while held. `nil` at rest.
    @State private var dragX: CGFloat?
    @State private var grabOffset: CGFloat = 0
    @State private var pressedOnSelection = false

    private let height: CGFloat = 36
    private let inset: CGFloat = 3
    /// How much taller than the bar the lens is when lifted.
    private let lensScale: CGFloat = 1.32

    var body: some View {
        GeometryReader { proxy in
            let slot = proxy.size.width / CGFloat(max(tabs.count, 1))
            let selectedIndex = tabs.firstIndex(of: selection) ?? 0
            let restX = slot * (CGFloat(selectedIndex) + 0.5)
            let lensX = dragX ?? restX
            let lifted = dragX != nil
            let highlighted = lifted ? Self.index(at: lensX, slot: slot, count: tabs.count) : selectedIndex
            let pill = CGSize(width: slot - inset * 2, height: height - inset * 2)
            let lens = CGSize(width: pill.width * 1.12, height: height * lensScale)

            ZStack(alignment: .topLeading) {
                Capsule()
                    .fill(.clear)
                    .frame(width: proxy.size.width, height: height)
                    .glassEffect(.regular, in: .capsule)

                // The resting selection: grey, under the icons. It hands over to the lens
                // when the selection is grabbed, and takes back over where it lands.
                Capsule()
                    .fill(Color.primary.opacity(0.1))
                    .frame(width: pill.width, height: pill.height)
                    .offset(x: restX - pill.width / 2, y: inset)
                    .opacity(lifted ? 0 : 1)

                HStack(spacing: 0) {
                    ForEach(Array(tabs.enumerated()), id: \.offset) { index, tab in
                        Image(systemName: symbol(tab))
                            .font(.system(size: 15, weight: index == highlighted ? .semibold : .regular))
                            .foregroundStyle(index == highlighted ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                            .frame(width: slot, height: height)
                            .contentShape(.rect)
                            .accessibilityLabel(title(tab))
                            .accessibilityAddTraits(tab == selection ? .isSelected : [])
                            .help(title(tab))
                    }
                }
                .allowsHitTesting(false)

                // The lens: clear glass, above everything, refracting the icons below.
                if lifted {
                    Capsule()
                        .fill(.clear)
                        .frame(width: lens.width, height: lens.height)
                        .glassEffect(.clear.interactive(), in: .capsule)
                        .shadow(color: .black.opacity(0.16), radius: 12, y: 5)
                        .offset(x: lensX - lens.width / 2, y: (height - lens.height) / 2)
                        .allowsHitTesting(false)
                        .transition(.scale(scale: pill.height / lens.height).combined(with: .opacity))
                }
            }
            .contentShape(.capsule)
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        if !pressedOnSelection {
                            // Only a press on the selected tab picks the lens up; a press
                            // anywhere else is a click, settled on release.
                            guard abs(value.startLocation.x - restX) <= slot / 2 else { return }
                            pressedOnSelection = true
                            grabOffset = restX - value.startLocation.x
                        }
                        let x = min(max(value.location.x + grabOffset, slot / 2), proxy.size.width - slot / 2)
                        withAnimation(dragX == nil
                                      ? .spring(response: 0.3, dampingFraction: 0.7)
                                      : .interactiveSpring(response: 0.22, dampingFraction: 0.82)) {
                            dragX = x
                        }
                    }
                    .onEnded { value in
                        let landing = Self.index(at: pressedOnSelection ? (dragX ?? restX) : value.location.x,
                                                 slot: slot, count: tabs.count)
                        withAnimation(.spring(response: 0.38, dampingFraction: 0.74)) {
                            if tabs.indices.contains(landing) { selection = tabs[landing] }
                            dragX = nil
                        }
                        pressedOnSelection = false
                        grabOffset = 0
                    }
            )
            .animation(.spring(response: 0.35, dampingFraction: 0.74), value: selection)
        }
        .frame(height: height)
        .accessibilityElement(children: .contain)
    }

    static func index(at x: CGFloat, slot: CGFloat, count: Int) -> Int {
        guard slot > 0, count > 0 else { return 0 }
        return min(max(Int(x / slot), 0), count - 1)
    }
}
