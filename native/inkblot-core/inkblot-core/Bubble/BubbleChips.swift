import SwiftUI

/// The chips that mark a sentence with a bubble session left open, as Liquid Glass.
///
/// Drawn over the web view where the page reports its own chips (`bubbleChipsChanged`),
/// which stay there invisible and take the click that reopens the session — so this
/// draws and does not hit-test. The page's chip is three dots in a small capsule; so is
/// this, in glass tinted with the accent.
struct BubbleChips: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack(alignment: .topLeading) {
            // By position, not id: split panes can show one document twice.
            ForEach(Array(model.bubble.chips.enumerated()), id: \.offset) { _, chip in
                content(chip)
                .frame(width: chip.right - chip.left, height: chip.bottom - chip.top)
                .glassEffect(.regular.tint(.accentColor.opacity(0.35)), in: .capsule)
                .position(x: (chip.left + chip.right) / 2, y: (chip.top + chip.bottom) / 2)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .allowsHitTesting(false)
    }

    /// Three dots; or, for a session with saved forms, a dot for each page, the one
    /// showing drawn long — or "2/7" when there are too many to draw.
    @ViewBuilder private func content(_ chip: BubbleChipRect) -> some View {
        let pages = Int(chip.formPages ?? 0)
        let page = Int(chip.formPage ?? 0)
        if pages == 0 {
            HStack(spacing: 2) {
                dot(4)
                dot(5)
                dot(4)
            }
        } else if pages > 5 {
            Text("\(page + 1)/\(pages)")
                .font(.system(size: 9.5, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(.primary.opacity(0.85))
        } else {
            HStack(spacing: 2) {
                ForEach(0..<pages, id: \.self) { index in
                    Capsule()
                        .fill(.primary.opacity(index == page ? 0.85 : 0.4))
                        .frame(width: index == page ? 9 : 4, height: 4)
                }
            }
            .animation(.easeOut(duration: 0.2), value: page)
        }
    }

    private func dot(_ size: CGFloat) -> some View {
        Circle()
            .fill(.primary.opacity(0.75))
            .frame(width: size, height: size)
    }
}
