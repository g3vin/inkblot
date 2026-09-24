import AppKit
import SwiftUI

/// The inspector's show/hide, pinned to the window's top-right corner.
///
/// Not a toolbar item, on purpose. As one it sat at the detail column's trailing edge —
/// never the corner while the inspector was open — and fell into the overflow (») menu
/// with everything else when the window got narrow. It cannot be a toolbar of its own
/// either: any non-customizable toolbar content turns Customize Toolbar… off for the
/// whole window. So it is a titlebar accessory (`NSTitlebarAccessoryViewController`,
/// `.trailing`), which AppKit lays out beside the toolbar rather than in it: always at
/// the far right, never overflowed, and invisible to toolbar customization. It hides with
/// the titlebar, as the toolbar does for the bubble editor.
///
/// Installed by a zero-size view anywhere in the window (`ContentView`), once per window.
struct InspectorTitlebarToggle: NSViewRepresentable {
    let sidebar: SidebarModel

    func makeNSView(context: Context) -> InstallerView { InstallerView(sidebar: sidebar) }
    func updateNSView(_ view: InstallerView, context: Context) {}

    final class InstallerView: NSView {
        private let sidebar: SidebarModel
        private weak var installed: NSTitlebarAccessoryViewController?

        init(sidebar: SidebarModel) {
            self.sidebar = sidebar
            super.init(frame: .zero)
        }

        required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            guard let window, installed == nil else { return }
            let accessory = NSTitlebarAccessoryViewController()
            accessory.layoutAttribute = .trailing
            let host = NSHostingView(rootView: CornerToggle(sidebar: sidebar))
            // A hosting view offers to manage its window's toolbar and title by default,
            // and a second hosting view claiming the toolbar — even with nothing in it —
            // turns Customize Toolbar… off. This one only draws a button.
            host.sceneBridgingOptions = []
            host.frame.size = host.fittingSize
            accessory.view = host
            window.addTitlebarAccessoryViewController(accessory)
            installed = accessory
        }

        override func removeFromSuperview() {
            if let installed, let index = window?.titlebarAccessoryViewControllers.firstIndex(of: installed) {
                window?.removeTitlebarAccessoryViewController(at: index)
            }
            super.removeFromSuperview()
        }
    }
}

/// The button itself: `InspectorToggle`, drawn as a toolbar button is — a glass circle
/// the height of the regular toolbar's items — since AppKit only styles items that are in
/// the toolbar. A fixed size, not `.buttonStyle(.glass)`: that one fits the circle to the
/// symbol and comes out smaller than the toolbar's buttons at every control size.
private struct CornerToggle: View {
    let sidebar: SidebarModel

    /// The height of a regular (non-compact) macOS 26 toolbar item.
    private static let diameter: CGFloat = 36

    var body: some View {
        InspectorToggle(isPresented: Binding(
            get: { sidebar.isPresented },
            set: { sidebar.isPresented = $0 }))
            .labelStyle(.iconOnly)
            .buttonStyle(CornerToggleStyle(diameter: Self.diameter))
            .padding(.horizontal, 10)
            .frame(maxHeight: .infinity)
    }
}

private struct CornerToggleStyle: ButtonStyle {
    let diameter: CGFloat

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15))
            .foregroundStyle(.primary)
            .frame(width: diameter, height: diameter)
            .contentShape(.circle)
            .glassEffect(.regular.interactive(), in: .circle)
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}
