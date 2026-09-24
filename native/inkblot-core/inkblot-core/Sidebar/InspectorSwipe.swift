import AppKit
import SwiftUI

/// Two-finger swipes sideways over the inspector, for moving along the selector bar:
/// fingers to the left for the next tab, to the right for the previous one — the way
/// the bubble editor's forms turn (`BubbleSwipeCatcher`), and pages everywhere else.
///
/// Laid behind the inspector, it takes no clicks; it watches the window's scroll events
/// and acts only on those over it. A gesture that begins more up-and-down than across is
/// a scroll and is left alone to its end. One that begins sideways is the inspector's:
/// its events are swallowed, so a list does not rubber-band sideways under it, and it
/// changes tab once, as soon as the fingers have travelled `distance`, then not again
/// until they lift — momentum included. A mouse's wheel, which has no gesture, never
/// swipes.
struct InspectorSwipeCatcher: NSViewRepresentable {
    /// Off while something covers the inspector (the bubble editor) or the bar is
    /// disabled (a search is showing).
    let isEnabled: Bool
    let onSwipe: (Int) -> Void

    func makeNSView(context: Context) -> CatcherView {
        let view = CatcherView()
        updateNSView(view, context: context)
        return view
    }

    func updateNSView(_ view: CatcherView, context: Context) {
        view.isEnabled = isEnabled
        view.onSwipe = onSwipe
    }

    static func dismantleNSView(_ view: CatcherView, coordinator: ()) {
        view.stop()
    }

    final class CatcherView: NSView {
        var isEnabled = true
        var onSwipe: ((Int) -> Void)?
        private var monitor: Any?
        private var travel = CGSize.zero
        private enum Axis { case across, along }
        private var axis: Axis?
        /// Whether this gesture has already changed tab.
        private var fired = false
        /// Whether the momentum after the last gesture is a swipe's, to be swallowed.
        private var swallowMomentum = false
        /// Movement before a gesture is judged sideways or not.
        private static let lockDistance: CGFloat = 12
        private static let distance: CGFloat = 60

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
            axis = nil
        }

        private func handle(_ event: NSEvent) -> NSEvent? {
            guard event.window === window else { return event }
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
                // Only a gesture that starts over the inspector is its.
                let point = convert(event.locationInWindow, from: nil)
                guard isEnabled, bounds.contains(point), !isHiddenOrHasHiddenAncestor else {
                    axis = .along
                    return event
                }
                travel = .zero
                axis = nil
                fired = false
                swallowMomentum = false
            }
            // Where the fingers went, whichever way scrolling is set to run.
            let sign: CGFloat = event.isDirectionInvertedFromDevice ? 1 : -1
            travel.width += sign * event.scrollingDeltaX
            travel.height += sign * event.scrollingDeltaY

            if axis == nil, hypot(travel.width, travel.height) >= Self.lockDistance {
                axis = abs(travel.width) > 2 * abs(travel.height) ? .across : .along
            }
            let across = axis == .across

            if across, !fired, abs(travel.width) >= Self.distance {
                fired = true
                onSwipe?(travel.width < 0 ? 1 : -1)
            }
            if event.phase.contains(.ended) || event.phase.contains(.cancelled) {
                swallowMomentum = across
                axis = nil
            }
            return across ? nil : event
        }
    }
}
