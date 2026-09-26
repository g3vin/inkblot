#if os(macOS)
import AppKit
#endif
import Foundation
import Observation

/// The tab bar's side of the window: what the page says is open, and the commands that
/// change it.
///
/// The tabs are the page's (`useTabs`, published by `useNativeTabs`); this keeps no
/// list of its own, only reads the last `tabsChanged` and sends commands. Every change
/// comes back as the next `tabsChanged`, so the bar never shows a state the page does
/// not have.
///
/// A tab owns its split, as a Safari or Xcode tab does: selecting it shows its
/// document, and the one beside or below it if it has a split (`bridge/tabs.rs`).
@MainActor
@Observable
final class TabsModel {
    private let bridge: ShellBridge

    /// View ▸ Show Tab Bar. Remembered across launches.
    var showsTabBar: Bool {
        didSet { UserDefaults.standard.set(showsTabBar, forKey: Self.showsTabBarKey) }
    }

    /// Whether the editor window is the key window, so ⌘W closes a tab there and the
    /// window anywhere else (Settings, the picker, a detached document).
    private(set) var editorIsKey = false

    private static let showsTabBarKey = "inkblot.tabs.showsTabBar"

    init(bridge: ShellBridge) {
        self.bridge = bridge
        showsTabBar = UserDefaults.standard.object(forKey: Self.showsTabBarKey) as? Bool ?? true
    }

    /* ---------------- what the bar reads ---------------- */

    var tabs: [DocTab] { bridge.tabs?.tabs ?? [] }
    var activeTabId: String? { bridge.tabs?.activeTabId }
    var activeTab: DocTab? { tabs.first { $0.id == activeTabId } }
    /// The document the primary pane shows: the active tab's.
    var currentDoc: String? { activeTab?.docPath }
    /// The active tab's split, while it has one.
    var split: SplitOrientation? { activeTab?.split }

    var hasTabs: Bool { !tabs.isEmpty }

    /// What the tab bar is for: more than one document to tell apart — two tabs, or one
    /// tab split between two documents. With one document open there is no bar.
    var needsTabBar: Bool { tabs.count > 1 || tabs.first?.split != nil }

    /// Whether ⌃Tab has anywhere to go.
    var canCycle: Bool { tabs.count > 1 }

    /// A split needs a second document: one already in the split, or another tab's.
    var canSplit: Bool {
        split != nil || tabs.contains { $0.docPath != nil && $0.docPath != currentDoc }
    }

    /// Whether a tab's document can go beside the active one: a document, and not the
    /// one the primary pane already has (it cannot be in both).
    func canOpenInSplit(_ tab: DocTab) -> Bool {
        tab.docPath != nil && tab.docPath != currentDoc
    }

    /* ---------------- commands ---------------- */

    func select(_ tab: DocTab) { bridge.send(.selectTab(TabRef(tabId: tab.id))) }
    func close(_ tab: DocTab) { bridge.send(.closeTab(TabRef(tabId: tab.id))) }
    func newTab() { bridge.send(.newTab(NewTabCommand())) }
    func openInTab(_ docPath: String) { bridge.send(.openDocInTab(OpenDocInTabCommand(docPath: docPath))) }
    func closeSplit() { bridge.send(.closeSplit(CloseSplitCommand())) }

    func closeOthers(_ tab: DocTab) {
        for other in tabs where other.id != tab.id { close(other) }
    }

    func closeToTheRight(_ tab: DocTab) {
        guard let index = tabs.firstIndex(where: { $0.id == tab.id }) else { return }
        for other in tabs[(index + 1)...] { close(other) }
    }

    /// Move to New Window: the tab's document in a detached window with a page of its
    /// own, and the tab closed.
    func moveToNewWindow(_ tab: DocTab) {
        guard let docPath = tab.docPath else { return }
        bridge.send(.openDocInWindow(OpenDocInWindowCommand(docPath: docPath)))
        close(tab)
    }

    /// Open the active tab's split, or turn it. With no document named the split keeps
    /// what it shows, or else takes the next tab's document.
    func openSplit(_ orientation: SplitOrientation, docPath: String? = nil) {
        bridge.send(.openInSplit(OpenInSplitCommand(docPath: docPath, orientation: orientation)))
    }

    /// Put `tabId` where `target` is — the drop of one tab on another.
    func move(_ tabId: String, to target: DocTab) {
        var order = tabs.map(\.id)
        guard tabId != target.id, let from = order.firstIndex(of: tabId),
              let to = order.firstIndex(of: target.id) else { return }
        order.remove(at: from)
        order.insert(tabId, at: to)
        bridge.send(.setTabOrder(SetTabOrderCommand(tabIds: order)))
    }

    func moveToEnd(_ tabId: String) {
        var order = tabs.map(\.id)
        guard let from = order.firstIndex(of: tabId), from != order.count - 1 else { return }
        order.remove(at: from)
        order.append(tabId)
        bridge.send(.setTabOrder(SetTabOrderCommand(tabIds: order)))
    }

    /// ⌃Tab and ⌃⇧Tab: the next or previous tab, round the ends.
    func selectAdjacent(_ offset: Int) {
        guard canCycle else { return }
        let from = tabs.firstIndex { $0.id == activeTabId } ?? 0
        let index = ((from + offset) % tabs.count + tabs.count) % tabs.count
        select(tabs[index])
    }

    /// ⌘1 to ⌘8 pick that tab; ⌘9 is always the last, as in Safari.
    func select(number: Int) {
        guard !tabs.isEmpty else { return }
        let index = number == 9 ? tabs.count - 1 : number - 1
        guard tabs.indices.contains(index) else { return }
        select(tabs[index])
    }

    /// File ▸ Close Tab (⌘W). In the editor window it closes the tab being shown; with
    /// none left, or anywhere else, it closes the window as ⌘W always has.
    func closeFromMenu() {
        #if os(macOS)
        // Asked now, not read from `editorIsKey`, which only labels the item.
        let editorKey = editorWindow?()?.isKeyWindow ?? false
        if editorKey, let active = activeTab ?? tabs.first {
            close(active)
        } else {
            NSApp.keyWindow?.performClose(nil)
        }
        #endif
    }

    /* ---------------- the key window ---------------- */

    #if os(macOS)
    @ObservationIgnored private var editorWindow: (@MainActor () -> NSWindow?)?
    @ObservationIgnored private var keyObservers: [NSObjectProtocol] = []
    @ObservationIgnored private var windowPending: NSObjectProtocol?
    @ObservationIgnored private var keyMonitor: Any?

    /// Follow which window is key, against the editor's.
    ///
    /// Called from `onAppear`, before the web view is in its window, and a window that is
    /// already key when it gets there posts no notification. So until the window turns
    /// up this looks again after each pass of the event loop, and then stops.
    func watchKeyWindow(editorWindow: @escaping @MainActor () -> NSWindow?) {
        guard keyObservers.isEmpty else { return }
        self.editorWindow = editorWindow
        for name in [NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification] {
            keyObservers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: nil) { [weak self] _ in
                MainActor.assumeIsolated { self?.updateEditorIsKey() }
            })
        }
        windowPending = NotificationCenter.default.addObserver(
            forName: NSApplication.didUpdateNotification, object: nil, queue: nil
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.editorWindow?() != nil else { return }
                self.updateEditorIsKey()
                if let pending = self.windowPending { NotificationCenter.default.removeObserver(pending) }
                self.windowPending = nil
            }
        }
        updateEditorIsKey()

        // ⌃Tab and ⌃⇧Tab, before the web view: with a text field or the editor focused,
        // WebKit takes ⌃Tab as focus navigation and the Window menu never sees it. The
        // menu items stay, to be found; the event is used up here so they never also fire.
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask).subtracting(.capsLock)
            guard event.keyCode == 48, modifiers == .control || modifiers == [.control, .shift] else { return event }
            return MainActor.assumeIsolated {
                guard let self, event.window != nil, event.window === self.editorWindow?(), self.canCycle else { return event }
                self.selectAdjacent(modifiers.contains(.shift) ? -1 : 1)
                return nil
            }
        }
    }

    private func updateEditorIsKey() {
        let isKey = editorWindow?()?.isKeyWindow ?? false
        if editorIsKey != isKey { editorIsKey = isKey }
    }
    #endif
}

extension DocTab {
    /// The file's own name, without the kind suffix routing reads (`.canvas`, `.map`).
    var name: String {
        guard let docPath else { return "New Tab" }
        return Self.name(of: docPath)
    }

    /// The name of the document beside or below this tab's, while it has a split.
    var secondaryName: String? {
        guard split != nil, let secondaryDoc else { return nil }
        return Self.name(of: secondaryDoc)
    }

    static func name(of docPath: String) -> String {
        let leaf = docPath.split(separator: "/").last.map(String.init) ?? docPath
        for suffix in [".canvas", ".map"] where leaf.hasSuffix(suffix) {
            return String(leaf.dropLast(suffix.count))
        }
        return leaf
    }

    /// The folder it is in, to tell two tabs of the same name apart.
    var folder: String? {
        guard let docPath, let slash = docPath.lastIndex(of: "/") else { return nil }
        return String(docPath[..<slash]).split(separator: "/").last.map(String.init)
    }

    var symbol: String {
        guard let docPath else { return "plus.square.dashed" }
        return Self.symbol(of: docPath)
    }

    /// The symbol of the document beside or below this tab's, while it has a split.
    var secondarySymbol: String? {
        guard split != nil, let secondaryDoc else { return nil }
        return Self.symbol(of: secondaryDoc)
    }

    static func symbol(of docPath: String) -> String {
        if docPath.hasSuffix(".canvas") { return "rectangle.on.rectangle" }
        if docPath.hasSuffix(".map") { return "map" }
        return "doc.text"
    }
}
