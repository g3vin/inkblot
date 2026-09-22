import AppKit
import SwiftUI

/// The window's own controls, placed by macOS 26's metrics for a toolbar window.
///
/// The window uses a hidden titlebar rather than a real toolbar, and that is deliberate:
/// AppKit keeps the whole of a toolbar's band for itself (its empty space drags the
/// window), and the page's toolbar lives in that band — its buttons would stop taking
/// clicks. A hidden titlebar passes clicks through to the page. What it does not do is
/// lay the traffic lights out as a toolbar window would: it keeps the old 28pt titlebar,
/// with the lights jammed into the corner. So this puts them where a unified-toolbar
/// window has them, and every other control in the band is placed on the same line.
enum WindowChrome {
    /// Height of the toolbar band the controls are centred in.
    static let bandHeight: CGFloat = 52
    /// The line the traffic lights, the toggles and the page's toolbar share.
    static let centerY: CGFloat = bandHeight / 2
    /// The close button's leading edge.
    static let trafficLightsLeading: CGFloat = 20
    /// Where the leading sidebar toggle starts — just past the zoom button, as Xcode's.
    static let leadingToggleX: CGFloat = 92
    /// Standard glass toolbar button.
    static let toggleSize: CGFloat = 36
    static let toggleInset: CGFloat = centerY - toggleSize / 2

    /// Move the traffic lights into the band. AppKit puts them back on every layout pass
    /// that touches the titlebar, so this is re-run on resize and around full screen.
    @MainActor
    static func placeTrafficLights(in window: NSWindow) {
        guard !window.styleMask.contains(.fullScreen),
              let close = window.standardWindowButton(.closeButton),
              let mini = window.standardWindowButton(.miniaturizeButton),
              let zoom = window.standardWindowButton(.zoomButton),
              let container = close.superview?.superview
        else { return }

        var frame = container.frame
        frame.size.height = bandHeight
        frame.origin.y = window.frame.height - bandHeight
        container.frame = frame

        let spacing = mini.frame.minX - close.frame.minX
        for (index, button) in [close, mini, zoom].enumerated() {
            button.setFrameOrigin(NSPoint(
                x: trafficLightsLeading + CGFloat(index) * spacing,
                y: (bandHeight - button.frame.height) / 2))
        }
    }

    /// Keeps a window's traffic lights placed. Held by the window's content for as long
    /// as the window lives.
    @MainActor
    final class Keeper {
        private var observers: [NSObjectProtocol] = []

        init(window: NSWindow) {
            let center = NotificationCenter.default
            let names: [Notification.Name] = [
                NSWindow.didResizeNotification,
                NSWindow.didEndLiveResizeNotification,
                NSWindow.didExitFullScreenNotification,
                NSWindow.didBecomeKeyNotification,
                NSWindow.didResignKeyNotification,
            ]
            observers = names.map { name in
                center.addObserver(forName: name, object: window, queue: .main) { [weak window] _ in
                    MainActor.assumeIsolated {
                        if let window { WindowChrome.placeTrafficLights(in: window) }
                    }
                }
            }
            WindowChrome.placeTrafficLights(in: window)
        }

        deinit {
            observers.forEach(NotificationCenter.default.removeObserver)
        }
    }
}

/// A sidebar's show/hide button: standard toolbar-button size, glass, on the traffic
/// lights' line.
struct SidebarToggleButton: View {
    enum Edge { case leading, trailing }

    let edge: Edge
    @Binding var isPresented: Bool

    var body: some View {
        Button { withAnimation(.spring(duration: 0.3)) { isPresented.toggle() } } label: {
            Image(systemName: edge == .leading ? "sidebar.left" : "sidebar.right")
                .font(.system(size: 16, weight: .regular))
                .frame(width: WindowChrome.toggleSize, height: WindowChrome.toggleSize)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .circle)
        .help(isPresented ? "Hide the sidebar" : "Show the sidebar")
    }
}
