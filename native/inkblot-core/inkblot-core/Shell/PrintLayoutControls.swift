import SwiftUI

/// Print Layout's controls, as Liquid Glass, for each text pane: in its bottom-right
/// corner the button that shows its document as pages, and — while it does — that
/// document's zoom beside it. Level with the pane's word and page counts, which keep to
/// its bottom-left (`.native-print-controls`, WordCountBadge.css), and so, along the
/// bottom of the window, with the file tree's bottom bar.
///
/// Per pane, so one side of a split can be pages and the other not, and zooming one
/// leaves the other alone. In a split a pane's controls show only while the pointer is
/// over that pane (the page says which, `hovered`) or over the controls themselves;
/// a lone pane always shows its. Where the panes are and what each shows comes from the
/// page's `paneStatuses`; what the buttons do goes back as commands naming the pane's
/// document.
struct PrintLayoutControls: View {
    @Environment(AppModel.self) private var model

    /// Where this overlay is in the window, to bring the sidebar bar's centre into it.
    @State private var frame: CGRect = .zero
    /// How far the sidebars reach over the editor, so the controls sit in what they leave.
    @State private var insets = EdgeInsets()
    /// Zooms just asked for, by document, until the page reports them: steps taken in
    /// quick succession go on from them, not from the zoom the page last settled on.
    @State private var requestedZoom: [String: Double] = [:]
    /// Panes, by position, whose controls the pointer is on — off the page, which then
    /// no longer reports the pane as hovered.
    @State private var onControls: Set<Int> = []

    /// The page's `ZOOM_STEPS` (src/print/zoom.ts).
    private static let steps: [Double] = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]
    private static let menuSteps: [Double] = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]
    /// The tab bar's sizes, as the rest of the bottom row has: a round button, and a
    /// capsule a little shorter.
    private static let toggleSize: CGFloat = 28
    private static let height: CGFloat = 24
    private static let zoomWidth: CGFloat = 124
    private static let compactZoomWidth: CGFloat = 56
    private static let edge: CGFloat = 10
    private static let gap: CGFloat = 8

    var body: some View {
        let panes = model.bridge.paneStatuses
        ZStack {
            // By position: split panes can show one document twice.
            ForEach(Array(panes.enumerated()), id: \.offset) { index, pane in
                controls(for: pane, at: index, among: panes)
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
        .animation(.smooth(duration: 0.25), value: panes.map(\.printLayout))
        .onChange(of: panes.map(\.zoom)) { requestedZoom = [:] }
        // Into another pane, the pointer has left every other pane's controls, whether
        // or not their hover ended (a jump of the pointer skips the exit).
        .onChange(of: panes.firstIndex { $0.hovered == true }) { _, hovered in
            if let hovered { onControls = onControls.filter { $0 == hovered } }
        }
    }

    /// One pane's toggle, and its zoom while it shows pages.
    @ViewBuilder
    private func controls(for pane: PaneStatus, at index: Int, among panes: [PaneStatus]) -> some View {
        let right = min(pane.right, frame.width - insets.trailing) - Self.edge
        let y = midY(of: pane, among: panes)
        let zoomRight = right - Self.toggleSize - Self.gap
        let width: CGFloat? = pane.printLayout ? zoomWidth(from: countsEnd(of: pane, y: y), to: zoomRight) : nil
        let shown = panes.count == 1 || pane.hovered == true || onControls.contains(index)
        Group {
            toggle(pane)
                .position(x: right - Self.toggleSize / 2, y: y)
            if let width {
                zoomControl(pane, zoom: requestedZoom[pane.docPath] ?? pane.zoom, compact: width < Self.zoomWidth)
                    .frame(width: width)
                    .position(x: zoomRight - width / 2, y: y)
                    .transition(.opacity.combined(with: .scale(scale: 0.92)))
            }
        }
        .onHover { inside in
            if inside { onControls.insert(index) } else { onControls.remove(index) }
        }
        .opacity(shown ? 1 : 0)
        .allowsHitTesting(shown)
        .accessibilityHidden(!shown)
        .animation(.easeOut(duration: 0.15), value: shown)
    }

    /// The right edge of the pane's word and page counts, which the zoom must not cover.
    private func countsEnd(of pane: PaneStatus, y: CGFloat) -> CGFloat {
        let row = (pane.top + pane.bottom) / 2
        return model.bridge.wordCounts
            .filter { $0.left >= pane.left - 1 && $0.right <= pane.right + 1 && abs(($0.top + $0.bottom) / 2 - row) < 20 }
            .map(\.right)
            .max() ?? pane.left
    }

    /// The zoom's width in the room between the counts and the toggle: the whole
    /// control, or in a narrow pane just its menu, or — narrower still — none; the View
    /// menu and ⌘+/⌘− still zoom.
    private func zoomWidth(from start: CGFloat, to end: CGFloat) -> CGFloat? {
        let room = end - start - Self.gap
        if room >= Self.zoomWidth { return Self.zoomWidth }
        if room >= Self.compactZoomWidth { return Self.compactZoomWidth }
        return nil
    }

    /// Where the page puts the pane's row — except along the bottom of the window, where
    /// it sits level with the file tree's bottom bar, as the word counts do
    /// (`WordCountBadges`). A stacked split's upper pane has a row under it.
    private func midY(of pane: PaneStatus, among panes: [PaneStatus]) -> CGFloat {
        let isAbove = panes.contains { $0.top >= pane.bottom && $0.left < pane.right && $0.right > pane.left }
        guard !isAbove, let barY = model.sidebarBarMidY else { return (pane.top + pane.bottom) / 2 }
        return barY - frame.minY
    }

    private func toggle(_ pane: PaneStatus) -> some View {
        let enabled = pane.printLayout
        return Button {
            model.pageLayout.setPrintLayout(!enabled, docPath: pane.docPath)
        } label: {
            Image(systemName: enabled ? "doc.richtext.fill" : "doc.richtext")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(enabled ? AnyShapeStyle(.tint) : AnyShapeStyle(.primary.opacity(0.85)))
                .frame(width: Self.toggleSize, height: Self.toggleSize)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .glassEffect(enabled ? .regular.tint(.accentColor.opacity(0.25)).interactive() : .regular.interactive(), in: .circle)
        .help(enabled ? "Hide Print Layout (⌥⌘P)" : "Show Print Layout (⌥⌘P)")
        .accessibilityLabel("Print Layout, \(DocTab.name(of: pane.docPath))")
        .accessibilityAddTraits(enabled ? .isSelected : [])
    }

    private func zoomControl(_ pane: PaneStatus, zoom: Double, compact: Bool) -> some View {
        HStack(spacing: 0) {
            if !compact {
                Button { step(-1, from: zoom, in: pane) } label: {
                    Image(systemName: "minus")
                        .frame(width: Self.height, height: Self.height)
                        .contentShape(.rect)
                }
                .disabled(zoom <= Self.steps[0] + 0.001)
                .help("Zoom Out (⌘−)")
            }

            Menu {
                if compact {
                    Button("Zoom In") { step(1, from: zoom, in: pane) }
                    Button("Zoom Out") { step(-1, from: zoom, in: pane) }
                    Divider()
                }
                Button("Fit Width") { fit(.width, in: pane) }
                Button("Fit Page") { fit(.page, in: pane) }
                Button("Actual Size") { fit(.actual, in: pane) }
                Divider()
                ForEach(Self.menuSteps, id: \.self) { z in
                    Button("\(Int(z * 100))%") { setZoom(z, in: pane) }
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

            if !compact {
                Button { step(1, from: zoom, in: pane) } label: {
                    Image(systemName: "plus")
                        .frame(width: Self.height, height: Self.height)
                        .contentShape(.rect)
                }
                .disabled(zoom >= Self.steps[Self.steps.count - 1] - 0.001)
                .help("Zoom In (⌘+)")
            }
        }
        .buttonStyle(.plain)
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(.primary.opacity(0.85))
        .padding(.horizontal, 2)
        .frame(height: Self.height)
        .glassEffect(.regular.interactive(), in: .capsule)
    }

    private func step(_ direction: Int, from zoom: Double, in pane: PaneStatus) {
        let next = direction > 0
            ? Self.steps.first { $0 > zoom + 0.001 }
            : Self.steps.last { $0 < zoom - 0.001 }
        guard let next else { return }
        setZoom(next, in: pane)
    }

    private func setZoom(_ zoom: Double, in pane: PaneStatus) {
        requestedZoom[pane.docPath] = zoom
        model.pageLayout.zoom(zoom, docPath: pane.docPath)
    }

    private func fit(_ fit: ZoomFit, in pane: PaneStatus) {
        requestedZoom[pane.docPath] = nil
        model.pageLayout.fit(fit, docPath: pane.docPath)
    }
}
