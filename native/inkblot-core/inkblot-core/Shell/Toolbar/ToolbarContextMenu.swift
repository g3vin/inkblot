import AppKit
import SwiftUI

/// Right-clicking the toolbar band: how the toolbar shows its items, Customize
/// Toolbar…, and Customize Inspector Layout….
///
/// The band is clear glass over the page (`ContentView`), so a right-click in a gap
/// between the items could land on the page's own menu instead of the toolbar's, and
/// AppKit's toolbar menu has no room for the inspector's item anyway. So this answers
/// every right-click (and control-click) above the window's content area while the
/// toolbar is up — items, gaps and the inspector toggle alike — with the whole menu,
/// the same one wherever it lands. With the toolbar hidden (the bubble editor, a project
/// still opening) the band is someone else's and is left alone.
///
/// Installed by a zero-size view anywhere in the window (`ContentView`).
struct ToolbarContextMenu: NSViewRepresentable {
    let sidebar: SidebarModel

    func makeNSView(context: Context) -> InstallerView { InstallerView(sidebar: sidebar) }
    func updateNSView(_ view: InstallerView, context: Context) {}

    static func dismantleNSView(_ view: InstallerView, coordinator: ()) {
        view.stop()
    }

    final class InstallerView: NSView {
        private let sidebar: SidebarModel
        private var monitor: Any?

        init(sidebar: SidebarModel) {
            self.sidebar = sidebar
            super.init(frame: .zero)
        }

        required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

        override func hitTest(_ point: NSPoint) -> NSView? { nil }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            stop()
            guard window != nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: [.rightMouseDown, .leftMouseDown]) { [weak self] event in
                guard let self else { return event }
                return MainActor.assumeIsolated { self.handle(event) }
            }
        }

        func stop() {
            if let monitor { NSEvent.removeMonitor(monitor) }
            monitor = nil
        }

        private func handle(_ event: NSEvent) -> NSEvent? {
            guard let window, event.window === window,
                  event.type == .rightMouseDown || event.modifierFlags.contains(.control),
                  let toolbar = window.toolbar, toolbar.isVisible,
                  event.locationInWindow.y > window.contentLayoutRect.maxY,
                  let contentView = window.contentView
            else { return event }
            NSMenu.popUpContextMenu(makeMenu(toolbar, in: window), with: event, for: contentView)
            return nil
        }

        private func makeMenu(_ toolbar: NSToolbar, in window: NSWindow) -> NSMenu {
            let menu = NSMenu()
            menu.autoenablesItems = false
            let modes: [(String, NSToolbar.DisplayMode)] = [
                ("Icon and Text", .iconAndLabel), ("Icon Only", .iconOnly), ("Text Only", .labelOnly),
            ]
            for (title, mode) in modes {
                let item = menu.addItem(withTitle: title, action: #selector(setDisplayMode(_:)), keyEquivalent: "")
                item.target = self
                item.tag = Int(mode.rawValue)
                // `.default` is how AppKit reports icon only for a toolbar left alone.
                item.state = toolbar.displayMode == mode || (mode == .iconOnly && toolbar.displayMode == .default)
                    ? .on : .off
            }
            menu.addItem(.separator())
            let customizeToolbar = menu.addItem(
                withTitle: "Customize Toolbar…", action: #selector(customizeToolbar), keyEquivalent: "")
            customizeToolbar.target = self
            customizeToolbar.isEnabled = toolbar.allowsUserCustomization
            let customizeLayout = menu.addItem(
                withTitle: "Customize Inspector Layout…", action: #selector(customizeLayout), keyEquivalent: "")
            customizeLayout.target = self
            return menu
        }

        @objc private func setDisplayMode(_ item: NSMenuItem) {
            guard let mode = NSToolbar.DisplayMode(rawValue: UInt(item.tag)) else { return }
            window?.toolbar?.displayMode = mode
        }

        @objc private func customizeToolbar() {
            window?.runToolbarCustomizationPalette(nil)
        }

        @objc private func customizeLayout() {
            sidebar.isCustomizingLayout = true
        }
    }
}
