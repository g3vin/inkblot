import SwiftUI

/// Print Layout's controls, as Liquid Glass: the button that shows the active document
/// as pages, in the editor's bottom-left corner, and — while it does — its zoom, in the
/// bottom-right. Both sit level with the word count and the file tree's bottom bar.
///
/// The page leaves them room: its word count moves over for the button, and a status row
/// in the bottom-right corner moves over for the zoom (`.native-print-controls`,
/// WordCountBadge.css). The page count is the page's, beside the word count, drawn as
/// glass with it by `WordCountBadges`. What these show comes from `pageLayoutState`;
/// what they do goes back as commands.
struct PrintLayoutControls: View {
    @Environment(AppModel.self) private var model

    /// Where this overlay is in the window, to bring the sidebar bar's centre into it.
    @State private var frame: CGRect = .zero
    /// How far the sidebars reach over the editor, so the controls sit in what they leave.
    @State private var insets = EdgeInsets()
    /// A zoom just asked for, until the page reports it: steps taken in quick succession
    /// go on from it, not from the zoom the page last settled on.
    @State private var requestedZoom: Double?

    /// The page's `ZOOM_STEPS` (src/print/zoom.ts).
    private static let steps: [Double] = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]
    private static let menuSteps: [Double] = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]
    /// Fixed, so the page knows how much of the corner to leave (170px = 10 + 150 + 10).
    private static let zoomWidth: CGFloat = 150
    private static let edge: CGFloat = 10
    private static let height: CGFloat = 32

    var body: some View {
        let state = model.pageLayout.state
        ZStack {
            if let state, state.docPath != nil {
                toggle(state.enabled)
                    .position(x: insets.leading + Self.edge + Self.height / 2, y: midY)
                if state.enabled {
                    zoomControl(requestedZoom ?? state.zoom)
                        .position(x: frame.width - insets.trailing - Self.edge - Self.zoomWidth / 2, y: midY)
                        .transition(.opacity.combined(with: .scale(scale: 0.92)))
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // Measured over the whole editor, so the insets are how far the chrome reaches.
        .ignoresSafeArea()
        .onGeometryChange(for: CGRect.self, of: { $0.frame(in: .global) }) { frame = $0 }
        .onGeometryChange(for: EdgeInsets.self, of: \.safeAreaInsets) { next in
            // Mid-resize SwiftUI reports passes laid out without the chrome (see
            // ContentView); a window resize moves none of it.
            guard !model.web.webView.inLiveResize else { return }
            insets = next
        }
        .animation(.smooth(duration: 0.25), value: state?.enabled)
        .onChange(of: state?.zoom) { requestedZoom = nil }
    }

    /// Level with the file tree's bottom bar, as the word count is.
    private var midY: CGFloat {
        if let barY = model.sidebarBarMidY { return barY - frame.minY }
        return frame.height - 18 - Self.height / 2
    }

    private func toggle(_ enabled: Bool) -> some View {
        Button {
            model.pageLayout.setPrintLayout(!enabled)
        } label: {
            Image(systemName: enabled ? "doc.richtext.fill" : "doc.richtext")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(enabled ? AnyShapeStyle(.tint) : AnyShapeStyle(.primary.opacity(0.85)))
                .frame(width: Self.height, height: Self.height)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .glassEffect(enabled ? .regular.tint(.accentColor.opacity(0.25)).interactive() : .regular.interactive(), in: .circle)
        .help(enabled ? "Hide Print Layout (⌥⌘P)" : "Show Print Layout (⌥⌘P)")
        .accessibilityLabel("Print Layout")
        .accessibilityAddTraits(enabled ? .isSelected : [])
    }

    private func zoomControl(_ zoom: Double) -> some View {
        HStack(spacing: 0) {
            Button { step(-1, from: zoom) } label: {
                Image(systemName: "minus")
                    .frame(width: Self.height, height: Self.height)
                    .contentShape(.rect)
            }
            .disabled(zoom <= Self.steps[0] + 0.001)
            .help("Zoom Out (⌘−)")

            Menu {
                Button("Fit Width") { fit(.width) }
                Button("Fit Page") { fit(.page) }
                Button("Actual Size") { fit(.actual) }
                Divider()
                ForEach(Self.menuSteps, id: \.self) { z in
                    Button("\(Int(z * 100))%") { setZoom(z) }
                }
            } label: {
                Text("\(Int((zoom * 100).rounded()))%")
                    .monospacedDigit()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .contentShape(.rect)
            }
            .menuStyle(.button)
            .menuIndicator(.hidden)
            .frame(maxWidth: .infinity)
            .help("Zoom")

            Button { step(1, from: zoom) } label: {
                Image(systemName: "plus")
                    .frame(width: Self.height, height: Self.height)
                    .contentShape(.rect)
            }
            .disabled(zoom >= Self.steps[Self.steps.count - 1] - 0.001)
            .help("Zoom In (⌘+)")
        }
        .buttonStyle(.plain)
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(.primary.opacity(0.85))
        .padding(.horizontal, 4)
        .frame(width: Self.zoomWidth, height: Self.height)
        .glassEffect(.regular.interactive(), in: .capsule)
    }

    private func step(_ direction: Int, from zoom: Double) {
        let next = direction > 0
            ? Self.steps.first { $0 > zoom + 0.001 }
            : Self.steps.last { $0 < zoom - 0.001 }
        guard let next else { return }
        setZoom(next)
    }

    private func setZoom(_ zoom: Double) {
        requestedZoom = zoom
        model.pageLayout.zoom(zoom)
    }

    private func fit(_ fit: ZoomFit) {
        requestedZoom = nil
        model.pageLayout.fit(fit)
    }
}
