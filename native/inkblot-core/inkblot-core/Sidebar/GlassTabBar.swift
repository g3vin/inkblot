import SwiftUI

/// A Liquid Glass selector bar — Xcode's navigator bar, with the grab-and-slide lens of an
/// iOS 26 tab bar.
///
/// At rest it is what Apple's is: a low glass capsule of small, plain glyphs in the label
/// colour, the selected one in the accent colour on a faint grey pill. Press on the
/// selection and the pill lifts off the bar as a see-through lens — overhanging the bar
/// a little, magnifying the glyph it is over — follows the pointer, and on release settles
/// back into the grey pill on the tab it was let go over. A plain click on any icon just
/// selects it.
///
/// Layering is the whole trick, and it is easy to get backwards:
///   - the bar's glass is at the bottom
///   - the resting pill is plain fill, *under* the icons
///   - the icons
///   - the lifted lens *above* the icons, drawn by hand (`Lens`) rather than as glass
/// Glass cannot sample other glass: a `.glassEffect` lens over the bar's glass renders its
/// own frosted backdrop and hides the bar, where Apple's is clear straight through. And a
/// `GlassEffectContainer` draws its glass over plain content inside it, so the icons stay
/// out of one: an earlier version put them in a container and they came out frosted.
struct GlassTabBar<Tab: Hashable>: View {
    let tabs: [Tab]
    @Binding var selection: Tab
    let symbol: (Tab) -> String
    let title: (Tab) -> String

    /// Where the lifted lens's centre is while held. `nil` at rest.
    @State private var dragX: CGFloat?
    @State private var grabOffset: CGFloat = 0
    @State private var pressedOnSelection = false

    /// Xcode 26's navigator bar: a low capsule of small, plain, full-strength glyphs.
    private let height: CGFloat = 30
    private let inset: CGFloat = 3
    private let iconSize: CGFloat = 14
    /// How much bigger than a slot the lens is when lifted — it overhangs the bar a
    /// little, top and bottom, and is wider than it is tall.
    private let lensHeightScale: CGFloat = 1.24
    private let lensWidthScale: CGFloat = 1.4
    /// How much the glyph under the lens is magnified.
    private let magnification: CGFloat = 1.15

    var body: some View {
        GeometryReader { proxy in
            let slot = proxy.size.width / CGFloat(max(tabs.count, 1))
            let selectedIndex = tabs.firstIndex(of: selection) ?? 0
            let restX = slot * (CGFloat(selectedIndex) + 0.5)
            let lensX = dragX ?? restX
            let lifted = dragX != nil
            let highlighted = lifted ? Self.index(at: lensX, slot: slot, count: tabs.count) : selectedIndex
            let pill = CGSize(width: slot - inset * 2, height: height - inset * 2)
            let lens = CGSize(width: min(slot * lensWidthScale, proxy.size.width),
                              height: height * lensHeightScale)

            ZStack(alignment: .topLeading) {
                Capsule()
                    .fill(.clear)
                    .frame(width: proxy.size.width, height: height)
                    .glassEffect(.regular, in: .capsule)

                // The resting selection: grey, under the icons. It hands over to the lens
                // when the selection is grabbed, and takes back over where it lands.
                Capsule()
                    .fill(Color.primary.opacity(0.08))
                    .frame(width: pill.width, height: pill.height)
                    .offset(x: restX - pill.width / 2, y: inset)
                    .opacity(lifted ? 0 : 1)

                HStack(spacing: 0) {
                    ForEach(Array(tabs.enumerated()), id: \.offset) { index, tab in
                        // Plain full-strength glyphs, one weight. At rest the selection is
                        // tinted; while the lens is up nothing is — the lens *is* the
                        // selection, and it magnifies whatever it is over.
                        Image(systemName: symbol(tab))
                            .font(.system(size: iconSize, weight: .regular))
                            .foregroundStyle(!lifted && index == selectedIndex
                                             ? AnyShapeStyle(.tint) : AnyShapeStyle(.primary))
                            .scaleEffect(lifted && index == highlighted ? magnification : 1)
                            .frame(width: slot, height: height)
                            .contentShape(.rect)
                            .accessibilityLabel(title(tab))
                            .accessibilityAddTraits(tab == selection ? .isSelected : [])
                            .help(title(tab))
                    }
                }
                .allowsHitTesting(false)

                // The lens: see-through, above everything. Only its rim and shadow are
                // drawn; the bar and the magnified glyph show straight through it.
                if lifted {
                    Lens()
                        .frame(width: lens.width, height: lens.height)
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

/// The lifted lens: nothing inside but a whisper of light, a rim lit from above and a soft
/// shadow beneath — so whatever is under it stays in plain view.
private struct Lens: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let dark = colorScheme == .dark
        Capsule()
            .fill(Color.white.opacity(dark ? 0.04 : 0.1))
            .overlay {
                Capsule().strokeBorder(
                    LinearGradient(
                        colors: [.white.opacity(dark ? 0.55 : 0.95), .white.opacity(dark ? 0.12 : 0.35)],
                        startPoint: .top, endPoint: .bottom),
                    lineWidth: 1)
            }
            .overlay {
                Capsule()
                    .strokeBorder(Color.black.opacity(dark ? 0.35 : 0.1), lineWidth: 0.5)
                    .padding(-0.5)
            }
            .shadow(color: .black.opacity(dark ? 0.35 : 0.14), radius: 7, y: 3)
    }
}
