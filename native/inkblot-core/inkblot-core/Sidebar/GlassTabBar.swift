import SwiftUI

/// A Liquid Glass tab bar — the floating kind at the bottom of an iOS 26 app.
///
/// The icons sit in a glass capsule and the selection is a second, tinted glass bubble
/// under the selected one. The bubble is a thing you can hold: press on it and it lifts
/// (it grows, and the glass goes interactive), then it follows the pointer across the
/// bar, lighting whichever icon it is over, and springs onto the one you let go on. A
/// plain click on any icon still just selects it.
///
/// Both pieces of glass live in one `GlassEffectContainer`, so as the bubble travels it
/// is refracted *by* the bar it is sliding along rather than stacked on top of it.
struct GlassTabBar<Tab: Hashable>: View {
    let tabs: [Tab]
    @Binding var selection: Tab
    let symbol: (Tab) -> String
    let title: (Tab) -> String

    /// Where the lifted bubble's centre is, while it is held. `nil` when at rest.
    @State private var dragX: CGFloat?
    @State private var grabOffset: CGFloat = 0
    @State private var pressedOnBubble = false

    private let height: CGFloat = 44
    private let inset: CGFloat = 4

    var body: some View {
        GeometryReader { proxy in
            let slot = proxy.size.width / CGFloat(max(tabs.count, 1))
            let selectedIndex = tabs.firstIndex(of: selection) ?? 0
            let restX = slot * (CGFloat(selectedIndex) + 0.5)
            let bubbleX = dragX ?? restX
            let hovered = Self.index(at: bubbleX, slot: slot, count: tabs.count)
            let lifted = dragX != nil

            GlassEffectContainer(spacing: 8) {
                ZStack(alignment: .topLeading) {
                    Capsule()
                        .fill(.clear)
                        .frame(width: proxy.size.width, height: height)
                        .glassEffect(.regular, in: .capsule)

                    Capsule()
                        .fill(.clear)
                        .frame(width: slot - inset * 2, height: height - inset * 2)
                        .glassEffect(.regular.tint(.accentColor.opacity(lifted ? 0.28 : 0.18)).interactive(),
                                     in: .capsule)
                        .scaleEffect(lifted ? 1.16 : 1)
                        .shadow(color: .black.opacity(lifted ? 0.18 : 0), radius: 10, y: 4)
                        .offset(x: bubbleX - (slot - inset * 2) / 2, y: inset)

                    HStack(spacing: 0) {
                        ForEach(Array(tabs.enumerated()), id: \.offset) { index, tab in
                            Image(systemName: symbol(tab))
                                .font(.system(size: 15, weight: index == hovered ? .semibold : .regular))
                                .foregroundStyle(index == hovered ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                                .scaleEffect(lifted && index == hovered ? 1.12 : 1)
                                .frame(width: slot, height: height)
                                .contentShape(.rect)
                                .accessibilityLabel(title(tab))
                                .accessibilityAddTraits(tab == selection ? .isSelected : [])
                                .help(title(tab))
                        }
                    }
                    .allowsHitTesting(false)
                }
            }
            .contentShape(.capsule)
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        if dragX == nil, !pressedOnBubble {
                            // Only a press on the selected tab picks the bubble up; a press
                            // anywhere else is a click, settled when it lets go.
                            guard abs(value.startLocation.x - restX) <= slot / 2 else { return }
                            pressedOnBubble = true
                            grabOffset = restX - value.startLocation.x
                        }
                        guard pressedOnBubble else { return }
                        let x = value.location.x + grabOffset
                        withAnimation(.interactiveSpring(response: 0.25, dampingFraction: 0.8)) {
                            dragX = min(max(x, slot / 2), proxy.size.width - slot / 2)
                        }
                    }
                    .onEnded { value in
                        let landing = pressedOnBubble
                            ? Self.index(at: dragX ?? restX, slot: slot, count: tabs.count)
                            : Self.index(at: value.location.x, slot: slot, count: tabs.count)
                        withAnimation(.spring(response: 0.35, dampingFraction: 0.72)) {
                            if tabs.indices.contains(landing) { selection = tabs[landing] }
                            dragX = nil
                        }
                        pressedOnBubble = false
                        grabOffset = 0
                    }
            )
            .animation(.spring(response: 0.35, dampingFraction: 0.72), value: selection)
        }
        .frame(height: height)
        .accessibilityElement(children: .contain)
    }

    static func index(at x: CGFloat, slot: CGFloat, count: Int) -> Int {
        guard slot > 0, count > 0 else { return 0 }
        return min(max(Int(x / slot), 0), count - 1)
    }
}
