import AppKit
import Observation

/// Menus the page builds, drawn natively.
///
/// The bundle builds every context menu — and its additions to the View menu — with
/// `@tauri-apps/api/menu`. The shim keeps that resource tree in the page and hands it
/// over only when it is shown, as a plain tree (see `describe` in `tauri-shim.js`).
/// This turns the tree into an `NSMenu`, or into SwiftUI menu-bar content, and reports
/// which item was chosen by the rid the page gave it.
///
/// This is the compatibility path. A context menu built natively from
/// `getSelectionContext` — the protocol request that exists for exactly this — is the
/// destination, and it removes the page from the loop entirely.
@MainActor
@Observable
final class WebMenus {
    struct Item: Identifiable, Equatable {
        let rid: Int
        let kind: String
        let text: String
        let enabled: Bool
        let checked: Bool
        let accelerator: String?
        let predefined: String?
        let items: [Item]

        var id: Int { rid }
        var isSeparator: Bool { predefined == "Separator" }

        init?(_ raw: [String: Any]) {
            guard let rid = raw["rid"] as? Int else { return nil }
            self.rid = rid
            kind = raw["kind"] as? String ?? "MenuItem"
            text = raw["text"] as? String ?? ""
            enabled = raw["enabled"] as? Bool ?? true
            checked = raw["checked"] as? Bool ?? false
            accelerator = raw["accelerator"] as? String
            predefined = raw["predefined"] as? String
            items = (raw["items"] as? [[String: Any]] ?? []).compactMap(Item.init)
        }
    }

    /// The page's additions to the View menu. Read by `InkblotCommands`.
    private(set) var viewMenuItems: [Item] = []

    /// Runs the chosen item in the page. Set by the web view controller.
    @ObservationIgnored var activate: ((Int) -> Void)?

    /* ---------------- the menu bar ---------------- */

    /// `setAsAppMenu`. On macOS the menu bar belongs to the app, so the page's menu is
    /// not installed wholesale — SwiftUI owns the bar and rebuilds it at will. What the
    /// page contributes is taken from it: today that is its View submenu (theme, accent
    /// color, word count). A top-level submenu under any other name is logged and
    /// dropped rather than guessed at.
    func setAppMenu(_ tree: [String: Any]) {
        guard let root = Item(tree) else { return }
        viewMenuItems = root.items.first { $0.text == "View" }?.items ?? []
        for other in root.items where other.text != "View" {
            NSLog("[inkblot] The page added a \"%@\" menu; only View is merged into the menu bar.", other.text)
        }
    }

    /* ---------------- context menus ---------------- */

    /// Show a menu at the pointer and return the rid chosen, or `nil` if dismissed.
    ///
    /// `popUp` runs the menu's own tracking loop and returns once it closes, so by the
    /// time it does the choice — if any — has already been recorded by `Target`.
    func popup(_ tree: [String: Any], in window: NSWindow?) -> Int? {
        guard let root = Item(tree) else { return nil }
        let target = Target()
        let menu = NSMenu()
        menu.autoenablesItems = false
        for item in root.items { menu.addItem(makeItem(item, target: target)) }
        menu.popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
        return target.chosen
    }

    private final class Target: NSObject {
        var chosen: Int?
        @objc func choose(_ sender: NSMenuItem) { chosen = sender.tag }
    }

    private func makeItem(_ item: Item, target: Target) -> NSMenuItem {
        if item.isSeparator { return .separator() }

        // The edit items act on the first responder — the web view, which does what the
        // same menu items in the Edit menu do. Tauri resolves them the same way.
        if let predefined = item.predefined, let action = Self.standardAction(predefined) {
            let menuItem = NSMenuItem(title: item.text, action: action, keyEquivalent: "")
            menuItem.isEnabled = item.enabled
            return menuItem
        }

        let menuItem = NSMenuItem(title: item.text, action: nil, keyEquivalent: "")
        menuItem.isEnabled = item.enabled
        menuItem.state = item.checked ? .on : .off
        if let (key, modifiers) = Self.keyEquivalent(item.accelerator) {
            menuItem.keyEquivalent = key
            menuItem.keyEquivalentModifierMask = modifiers
        }

        if item.kind == "Submenu" || !item.items.isEmpty {
            let submenu = NSMenu(title: item.text)
            submenu.autoenablesItems = false
            for child in item.items { submenu.addItem(makeItem(child, target: target)) }
            menuItem.submenu = submenu
        } else {
            menuItem.target = target
            menuItem.action = #selector(Target.choose(_:))
            menuItem.tag = item.rid
        }
        return menuItem
    }

    private static func standardAction(_ predefined: String) -> Selector? {
        switch predefined {
        case "Copy": #selector(NSText.copy(_:))
        case "Cut": #selector(NSText.cut(_:))
        case "Paste": #selector(NSText.paste(_:))
        case "SelectAll": #selector(NSText.selectAll(_:))
        case "Undo": Selector(("undo:"))
        case "Redo": Selector(("redo:"))
        default: nil
        }
    }

    /// A Tauri accelerator (`CmdOrCtrl+Shift+V`) as an AppKit key equivalent.
    static func keyEquivalent(_ accelerator: String?) -> (String, NSEvent.ModifierFlags)? {
        guard let accelerator, !accelerator.isEmpty else { return nil }
        var modifiers: NSEvent.ModifierFlags = []
        var key = ""
        for part in accelerator.split(separator: "+").map({ $0.lowercased() }) {
            switch part {
            case "cmd", "command", "cmdorctrl", "commandorcontrol", "super", "meta": modifiers.insert(.command)
            case "ctrl", "control": modifiers.insert(.control)
            case "alt", "option": modifiers.insert(.option)
            case "shift": modifiers.insert(.shift)
            default: key = part
            }
        }
        return key.isEmpty ? nil : (key, modifiers)
    }
}
