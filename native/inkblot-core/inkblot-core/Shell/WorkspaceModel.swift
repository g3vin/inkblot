import CoreGraphics
import Foundation
import Observation

/// The tab dock, the new-tab chooser and the Analytic Bubble, as the page reports them.
///
/// All three are the page's state (`useNativeTabDock`, `NativeDraftPane`, and the
/// bubble's parse), published over the bridge; this holds the latest of each and turns
/// clicks into commands. Nothing here decides anything the page would decide
/// differently: which tab is active, whether a name is taken, how a sentence parses.
@MainActor
@Observable
final class WorkspaceModel {
    private(set) var tabs: TabsChanged?
    private(set) var draft: DraftPaneChanged?
    /// The open bubble. Closing it is the shell's alone — the page has already forgotten.
    var sentence: SentenceStructure?

    @ObservationIgnored private let bridge: ShellBridge

    init(bridge: ShellBridge) {
        self.bridge = bridge
        bridge.addListener { [weak self] event in self?.handle(event) }
    }

    private func handle(_ event: WebviewEvent) {
        switch event {
        case .tabsChanged(let changed):
            tabs = changed
        case .draftPaneChanged(let changed):
            draft = changed.tabId == nil ? nil : changed
        case .sentenceStructure(let structure):
            sentence = structure
        case .projectChanged:
            // Another project's tabs arrive with it; these are the last one's.
            tabs = nil
            draft = nil
            sentence = nil
        default:
            break
        }
    }

    /* ---------------- the dock ---------------- */

    func select(_ tab: DocTab) { bridge.send(.selectTab(TabRef(tabId: tab.id))) }
    func close(_ tab: DocTab) { bridge.send(.closeTab(TabRef(tabId: tab.id))) }
    func newTab() { bridge.send(.newTab(NewTabCommand())) }
    func openInTab(_ docPath: String) { bridge.send(.openDocInTab(OpenDocInTabCommand(docPath: docPath))) }

    /// How a tab shows in the dock — what `TabDock.jsx` worked out per dot.
    struct TabPresentation {
        var isDraft: Bool
        var isActive: Bool
        var inSecondary: Bool
        /// On screen: its name shows even while the dock is collapsed.
        var isOpen: Bool
        var label: String
        var symbol: String
    }

    func presentation(of tab: DocTab) -> TabPresentation {
        Self.presentation(of: tab, in: tabs)
    }

    static func presentation(of tab: DocTab, in tabs: TabsChanged?) -> TabPresentation {
        let isDraft = tab.docPath == nil
        let inPrimary = tab.docPath != nil && tab.docPath == tabs?.currentDoc
        let inSecondary = tabs?.split == true && tab.docPath != nil && tab.docPath == tabs?.secondaryDoc
        let isActive = isDraft ? tab.id == tabs?.activeTabId : inPrimary
        let path = tab.docPath ?? ""
        return TabPresentation(
            isDraft: isDraft,
            isActive: isActive,
            inSecondary: inSecondary,
            isOpen: inPrimary || inSecondary || (isDraft && isActive),
            label: isDraft ? "New Tab" : Self.displayName(path),
            symbol: isDraft ? "plus" : path.hasSuffix(".canvas") ? "rectangle.3.group" : "doc.text")
    }

    /// `getDocDisplayName`: the last path component, without `.canvas`.
    static func displayName(_ path: String) -> String {
        let last = path.split(separator: "/").last.map(String.init) ?? path
        return last.hasSuffix(".canvas") ? String(last.dropLast(".canvas".count)) : last
    }

    /* ---------------- the chooser ---------------- */

    func create(name: String, kind: DraftKind) {
        guard let tabId = draft?.tabId else { return }
        bridge.send(.createFromDraft(CreateFromDraftCommand(tabId: tabId, name: name, kind: kind)))
    }
}

extension Rect {
    var cgRect: CGRect { CGRect(x: x, y: y, width: width, height: height) }
}
