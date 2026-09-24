import AppKit
import SwiftUI

/// The forms, at the bottom of the bubble editor: a dot for each page — every saved form,
/// and a ring for the unsaved arrangement — which one is showing, and saving the bubbles
/// as a form or deleting the one showing. Clicking a dot shows it; so do ⌘[ and ⌘], and a
/// two-finger swipe sideways (`BubbleSwipeCatcher`).
struct BubbleFormsBar: View {
    let bubble: BubbleModel

    var body: some View {
        let current = bubble.currentForm
        HStack(spacing: 10) {
            if !bubble.forms.isEmpty {
                dots
                Text(current.map { "Form \($0 + 1) of \(bubble.forms.count)" } ?? "Unsaved")
                    .font(.system(size: 12, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .contentTransition(.numericText())
            }
            if let current {
                Button(role: .destructive) {
                    withAnimation(.bubbleRegrouping) { bubble.deleteForm(at: current) }
                } label: {
                    Label("Delete Form", systemImage: "trash")
                }
                .help("Delete this form (⌘⌫). The bubbles stay as they are; ⌘Z brings it back.")
            } else {
                Button {
                    withAnimation(.bubbleRegrouping) { bubble.saveForm() }
                } label: {
                    Label("Save as New Form", systemImage: "rectangle.stack.badge.plus")
                }
                .keyboardShortcut("s", modifiers: .command)
                .help("Save this arrangement as a form to come back to (⌘S)")
            }
        }
        // Icons only; the names are still there for VoiceOver and in the tooltips.
        .labelStyle(.iconOnly)
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .controlSize(.small)
        .font(.system(size: 12))
        .padding(.leading, bubble.forms.isEmpty ? 6 : 14)
        .padding([.vertical, .trailing], 6)
        .glassEffect(.regular, in: .capsule)
        .animation(.bubbleRegrouping, value: bubble.formPage)
        .animation(.bubbleRegrouping, value: bubble.forms.count)
    }

    private var dots: some View {
        let page = bubble.formPage
        let target = bubble.swipeStep == 0 ? nil : page + bubble.swipeStep
        return HStack(spacing: 6) {
            ForEach(0..<bubble.formPages, id: \.self) { index in
                let unsaved = index == bubble.forms.count
                let name = unsaved ? "Unsaved" : "Form \(index + 1)"
                Button {
                    withAnimation(.bubbleRegrouping) { bubble.showForm(page: index) }
                } label: {
                    dot(current: index == page, target: index == target, unsaved: unsaved)
                        .frame(height: 18)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .help("\(name) — swipe sideways with two fingers, or ⌘[ ⌘], to move between forms")
                .accessibilityLabel(name)
                .accessibilityAddTraits(index == page ? .isSelected : [])
                .contextMenu {
                    if !unsaved {
                        Button("Show \(name)") { withAnimation(.bubbleRegrouping) { bubble.showForm(page: index) } }
                        Button("Delete \(name)", role: .destructive) {
                            withAnimation(.bubbleRegrouping) { bubble.deleteForm(at: index) }
                        }
                    }
                }
            }
        }
    }

    private func dot(current: Bool, target: Bool, unsaved: Bool) -> some View {
        Capsule()
            .fill(current ? AnyShapeStyle(Color.accentColor)
                  : target ? AnyShapeStyle(Color.accentColor.opacity(0.55))
                  : unsaved ? AnyShapeStyle(.clear) : AnyShapeStyle(.secondary.opacity(0.6)))
            .overlay {
                if unsaved && !current && !target { Capsule().strokeBorder(.secondary, lineWidth: 1.5) }
            }
            .frame(width: current ? 20 : 8, height: 8)
            .scaleEffect(target ? 1.3 : 1)
    }
}

/// Two-finger swipes sideways on the trackpad, anywhere in the window, for moving between
/// forms.
///
/// A swipe has to mean it. It counts only if it begins sideways — a gesture that starts
/// more up-and-down than across is a scroll and is left alone to its end — and only once
/// the fingers have travelled `BubbleModel.swipeDistance`, several times a stray scroll's
/// width, with the bubbles following them, resisting, until then; or as a flick, short
/// but fast (`flickSpeed`), still sideways and past `flickDistance`. It turns the page
/// when the fingers lift, not before, and its momentum is swallowed, so one swipe is one
/// page — but new fingers start a new swipe at once, momentum or not.
/// A mouse's scroll wheel, which has no gesture to begin and end, never turns one.
struct BubbleSwipeCatcher: NSViewRepresentable {
    let bubble: BubbleModel

    func makeNSView(context: Context) -> CatcherView {
        let view = CatcherView()
        view.bubble = bubble
        return view
    }

    func updateNSView(_ view: CatcherView, context: Context) {
        view.bubble = bubble
    }

    static func dismantleNSView(_ view: CatcherView, coordinator: ()) {
        view.stop()
    }

    final class CatcherView: NSView {
        weak var bubble: BubbleModel?
        private var monitor: Any?
        private var travel = CGSize.zero
        private enum Axis { case across, along }
        private var axis: Axis?
        /// Whether the momentum after the last gesture is this swipe's, to be swallowed.
        private var swallowMomentum = false
        /// Movement before a gesture is judged sideways or not.
        private static let lockDistance: CGFloat = 12
        /// A flick: fingers lifting this fast (points a second), this far along.
        private static let flickSpeed: CGFloat = 450
        private static let flickDistance: CGFloat = 36
        /// The last moments of the gesture, for how fast it was going when it ended.
        private var samples: [(time: TimeInterval, x: CGFloat)] = []

        override func hitTest(_ point: NSPoint) -> NSView? { nil }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            stop()
            guard window != nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { [weak self] event in
                guard let self else { return event }
                return MainActor.assumeIsolated { self.handle(event) }
            }
        }

        func stop() {
            if let monitor { NSEvent.removeMonitor(monitor) }
            monitor = nil
            if axis == .across { bubble?.swipeCancelled() }
            axis = nil
        }

        /// Which way a flick went (+1 toward the next form), or 0 if the gesture was not one.
        private func flick() -> Int {
            guard abs(travel.width) >= Self.flickDistance, let first = samples.first, let last = samples.last,
                  last.time > first.time else { return 0 }
            let speed = (last.x - first.x) / CGFloat(last.time - first.time)
            guard abs(speed) >= Self.flickSpeed, (speed < 0) == (travel.width < 0) else { return 0 }
            return travel.width < 0 ? 1 : -1
        }

        private func handle(_ event: NSEvent) -> NSEvent? {
            guard event.window === window, let bubble else { return event }
            if !event.momentumPhase.isEmpty {
                let swallow = swallowMomentum
                if event.momentumPhase.contains(.ended) || event.momentumPhase.contains(.cancelled) {
                    swallowMomentum = false
                }
                return swallow ? nil : event
            }
            // A mouse wheel: no gesture, so nothing to swipe.
            if event.phase.isEmpty { return event }

            if event.phase.contains(.began) || event.phase.contains(.mayBegin) {
                travel = .zero
                axis = nil
                swallowMomentum = false
                samples = []
            }
            // Where the fingers went, whichever way scrolling is set to run.
            let sign: CGFloat = event.isDirectionInvertedFromDevice ? 1 : -1
            travel.width += sign * event.scrollingDeltaX
            travel.height += sign * event.scrollingDeltaY

            if axis == nil, hypot(travel.width, travel.height) >= Self.lockDistance {
                axis = abs(travel.width) > 2 * abs(travel.height) ? .across : .along
            }
            let across = axis == .across
            samples.append((event.timestamp, travel.width))
            samples.removeAll { event.timestamp - $0.time > 0.1 }

            if event.phase.contains(.ended) || event.phase.contains(.cancelled) {
                if across {
                    if event.phase.contains(.cancelled) { bubble.swipeCancelled() } else { bubble.swipeEnded(flick: flick()) }
                    swallowMomentum = true
                }
                axis = nil
                return across ? nil : event
            }
            guard across else { return event }
            bubble.swipeChanged(travel: travel.width)
            return nil
        }
    }
}
