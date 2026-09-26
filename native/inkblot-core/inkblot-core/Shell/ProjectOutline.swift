import AppKit
import SwiftUI

/// The tree itself: an `NSOutlineView`, as Finder's and Xcode's sidebars are.
///
/// Not a SwiftUI `List`. A `List` of `DisclosureGroup`s takes drops onto rows, but its
/// insert-between-rows drops (`ForEach.dropDestination`) do not reach nested levels, and
/// a drop on the whole list swallows the rest — which left the tree unable to reorder
/// anything. The outline view does it natively: it draws the insertion line, says which
/// folder and which index the line is in, and retargets a drop the way users expect.
///
/// It only shows and reports. What a drop or a menu item does is `FileTreeSidebar`'s.
struct ProjectOutline: NSViewRepresentable {
    let root: TreeNode?
    /// The tree is narrowed by the filter bar: everything shown is expanded, and the
    /// folders the user had open are kept for when the filter is cleared.
    var isFiltered = false
    /// The latest expand-or-collapse-all request, from the filter bar's ± button.
    var expansion: ExpansionRequest?
    @Binding var selection: String?
    /// Whether `paths` may be dropped into `folder` at `index` (`nil`: onto the folder).
    let canDrop: (_ paths: [String], _ folder: String, _ index: Int?) -> Bool
    let drop: (_ paths: [String], _ folder: String, _ index: Int?) -> Bool
    /// The context menu for a row, or for the empty part of the list.
    let menu: (_ path: String?) -> [NSMenuItem]

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> NSScrollView {
        let outline = NSOutlineView()
        outline.style = .sourceList
        outline.headerView = nil
        outline.backgroundColor = .clear
        outline.floatsGroupRows = false
        outline.allowsEmptySelection = true
        outline.allowsMultipleSelection = false
        outline.autoresizesOutlineColumn = false
        outline.columnAutoresizingStyle = .firstColumnOnlyAutoresizingStyle
        let column = NSTableColumn(identifier: .init("name"))
        column.resizingMask = .autoresizingMask
        outline.addTableColumn(column)
        outline.outlineTableColumn = column

        outline.registerForDraggedTypes([.inkblotTreePath])
        outline.setDraggingSourceOperationMask(.move, forLocal: true)
        outline.draggingDestinationFeedbackStyle = .sourceList

        let menu = NSMenu()
        menu.delegate = context.coordinator
        outline.menu = menu
        outline.target = context.coordinator
        outline.doubleAction = #selector(Coordinator.toggleFolder(_:))

        outline.dataSource = context.coordinator
        outline.delegate = context.coordinator
        context.coordinator.outline = outline

        let scroll = NSScrollView()
        scroll.documentView = outline
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        // The first row starts where the inspector's selector bar does, just below the
        // toolbar. The bottom leaves room for the glass "+" that floats over the list.
        scroll.automaticallyAdjustsContentInsets = false
        scroll.contentInsets = NSEdgeInsets(top: 8, left: 0, bottom: 56, right: 0)
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        coordinator.show(root, filtered: isFiltered)
        coordinator.apply(expansion)
        coordinator.select(selection)
    }

    /// Expand every folder, or — when every folder already is — collapse them all.
    struct ExpansionRequest: Equatable {
        let id = UUID()
    }

    /// One row. A class because the outline view knows its items by identity, and kept
    /// per path so a reload hands it the same objects and expansion survives.
    final class Item: NSObject {
        let path: String
        var node: TreeNode
        var children: [Item] = []

        init(_ node: TreeNode) {
            path = node.path
            self.node = node
        }

        var isFolder: Bool { node.type == .folder }
    }

    @MainActor
    final class Coordinator: NSObject, NSOutlineViewDataSource, NSOutlineViewDelegate, NSMenuDelegate {
        var parent: ProjectOutline?
        weak var outline: NSOutlineView?
        private var shown: TreeNode?
        private var filtered = false
        private var lastExpansion: UUID?
        private var top: [Item] = []
        private var items: [String: Item] = [:]
        private var expanded = Set<String>()
        private var applyingSelection = false

        /* ---------------- contents ---------------- */

        func show(_ root: TreeNode?, filtered: Bool) {
            guard let outline, root != shown || filtered != self.filtered else { return }
            shown = root
            self.filtered = filtered
            var live: [String: Item] = [:]
            func build(_ node: TreeNode) -> Item {
                let item = items[node.path] ?? Item(node)
                item.node = node
                item.children = (node.children ?? []).map(build)
                live[node.path] = item
                return item
            }
            top = (root?.children ?? []).map(build)
            items = live
            // A filtered tree leaves folders out; they are hidden, not gone.
            if !filtered { expanded = expanded.filter { live[$0] != nil } }

            applyingSelection = true
            outline.reloadData()
            if filtered {
                outline.expandItem(nil, expandChildren: true)
            } else {
                // Parents first, so each is visible when its children are expanded.
                for path in expanded.sorted(by: { $0.count < $1.count }) {
                    if let item = items[path] { outline.expandItem(item) }
                }
            }
            applyingSelection = false
            // A reload clears the selection; put it back.
            let current = parent?.selection
            select(current, force: true)
        }

        func select(_ path: String?, force: Bool = false) {
            guard let outline else { return }
            let row = path.flatMap { items[$0] }.map { outline.row(forItem: $0) } ?? -1
            guard force || row != outline.selectedRow else { return }
            applyingSelection = true
            if row >= 0 {
                outline.selectRowIndexes([row], byExtendingSelection: false)
            } else if path == nil {
                outline.deselectAll(nil)
            }
            applyingSelection = false
        }

        func outlineView(_ outlineView: NSOutlineView, numberOfChildrenOfItem item: Any?) -> Int {
            (item as? Item)?.children.count ?? top.count
        }

        func outlineView(_ outlineView: NSOutlineView, child index: Int, ofItem item: Any?) -> Any {
            (item as? Item)?.children[index] ?? top[index]
        }

        func outlineView(_ outlineView: NSOutlineView, isItemExpandable item: Any) -> Bool {
            (item as? Item)?.isFolder ?? false
        }

        func outlineView(_ outlineView: NSOutlineView, viewFor tableColumn: NSTableColumn?, item: Any) -> NSView? {
            guard let item = item as? Item else { return nil }
            let id = NSUserInterfaceItemIdentifier("row")
            let cell = outlineView.makeView(withIdentifier: id, owner: nil) as? NSTableCellView ?? Self.makeCell(id)
            cell.textField?.stringValue = item.isFolder ? item.node.name : docDisplayName(path: item.path)
            let symbol = item.isFolder ? "folder"
                : isCanvasDoc(path: item.path) ? "rectangle.on.rectangle"
                : isMapDoc(path: item.path) ? "map"
                : item.path.hasSuffix(".timeline") ? "calendar.day.timeline.left" : "doc.text"
            cell.imageView?.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
            return cell
        }

        private static func makeCell(_ id: NSUserInterfaceItemIdentifier) -> NSTableCellView {
            let cell = NSTableCellView()
            cell.identifier = id
            let image = NSImageView()
            let text = NSTextField(labelWithString: "")
            text.lineBreakMode = .byTruncatingTail
            text.cell?.truncatesLastVisibleLine = true
            for view in [image, text] as [NSView] {
                view.translatesAutoresizingMaskIntoConstraints = false
                cell.addSubview(view)
            }
            cell.imageView = image
            cell.textField = text
            NSLayoutConstraint.activate([
                image.leadingAnchor.constraint(equalTo: cell.leadingAnchor, constant: 2),
                image.centerYAnchor.constraint(equalTo: cell.centerYAnchor),
                image.widthAnchor.constraint(equalToConstant: 18),
                text.leadingAnchor.constraint(equalTo: image.trailingAnchor, constant: 6),
                text.trailingAnchor.constraint(lessThanOrEqualTo: cell.trailingAnchor, constant: -4),
                text.centerYAnchor.constraint(equalTo: cell.centerYAnchor),
            ])
            return cell
        }

        /* ---------------- selection and expansion ---------------- */

        func outlineViewSelectionDidChange(_ notification: Notification) {
            guard !applyingSelection, let outline else { return }
            let path = (outline.item(atRow: outline.selectedRow) as? Item)?.path
            if parent?.selection != path { parent?.selection = path }
        }

        func outlineViewItemDidExpand(_ notification: Notification) {
            guard !filtered, let item = notification.userInfo?["NSObject"] as? Item else { return }
            expanded.insert(item.path)
        }

        func outlineViewItemDidCollapse(_ notification: Notification) {
            guard !filtered, let item = notification.userInfo?["NSObject"] as? Item else { return }
            expanded.remove(item.path)
        }

        func apply(_ request: ExpansionRequest?) {
            guard let outline, let request, request.id != lastExpansion else { return }
            lastExpansion = request.id
            let folders = items.values.filter(\.isFolder)
            let expand = !folders.allSatisfy { outline.isItemExpanded($0) }
            if expand {
                outline.expandItem(nil, expandChildren: true)
            } else {
                outline.collapseItem(nil, collapseChildren: true)
            }
            if !filtered { expanded = expand ? Set(folders.map(\.path)) : [] }
        }

        @objc func toggleFolder(_ sender: Any?) {
            guard let outline, let item = outline.item(atRow: outline.clickedRow) as? Item, item.isFolder else { return }
            if outline.isItemExpanded(item) { outline.collapseItem(item) } else { outline.expandItem(item) }
        }

        /* ---------------- dragging ---------------- */

        func outlineView(_ outlineView: NSOutlineView, pasteboardWriterForItem item: Any) -> NSPasteboardWriting? {
            guard let item = item as? Item else { return nil }
            let pasteboardItem = NSPasteboardItem()
            pasteboardItem.setString(item.path, forType: .inkblotTreePath)
            return pasteboardItem
        }

        func outlineView(
            _ outlineView: NSOutlineView, validateDrop info: NSDraggingInfo,
            proposedItem item: Any?, proposedChildIndex index: Int
        ) -> NSDragOperation {
            let paths = Self.paths(info)
            guard !paths.isEmpty, let target = retarget(outlineView, item as? Item, index) else { return [] }
            if target.item !== item as AnyObject? || target.index != index {
                outlineView.setDropItem(target.item, dropChildIndex: target.index)
            }
            let folder = target.item?.path ?? ""
            let at = target.index == NSOutlineViewDropOnItemIndex ? nil : target.index
            return parent?.canDrop(paths, folder, at) == true ? .move : []
        }

        func outlineView(
            _ outlineView: NSOutlineView, acceptDrop info: NSDraggingInfo,
            item: Any?, childIndex index: Int
        ) -> Bool {
            let folder = (item as? Item)?.path ?? ""
            let at = index == NSOutlineViewDropOnItemIndex ? nil : index
            return parent?.drop(Self.paths(info), folder, at) ?? false
        }

        /// A drop onto a document means beside it, not into it: the line goes above it,
        /// in its folder.
        private func retarget(_ outline: NSOutlineView, _ item: Item?, _ index: Int) -> (item: Item?, index: Int)? {
            guard let item, !item.isFolder else { return (item, index) }
            let parent = outline.parent(forItem: item) as? Item
            let siblings = parent?.children ?? top
            guard let position = siblings.firstIndex(where: { $0 === item }) else { return nil }
            return (parent, position)
        }

        private static func paths(_ info: NSDraggingInfo) -> [String] {
            (info.draggingPasteboard.pasteboardItems ?? []).compactMap { $0.string(forType: .inkblotTreePath) }
        }

        /* ---------------- context menu ---------------- */

        func menuNeedsUpdate(_ menu: NSMenu) {
            menu.removeAllItems()
            guard let outline, let parent else { return }
            let path = (outline.item(atRow: outline.clickedRow) as? Item)?.path
            for item in parent.menu(path) { menu.addItem(item) }
        }
    }
}

extension NSPasteboard.PasteboardType {
    /// A row of the tree in flight. Its own type, so text dragged in from elsewhere is
    /// not taken for a path.
    static let inkblotTreePath = NSPasteboard.PasteboardType("com.inkblot.tree-path")
}

/// A menu item that runs a closure — the context menu is built per click, from Swift.
final class ClosureMenuItem: NSMenuItem {
    private let run: () -> Void

    init(_ title: String, systemImage: String? = nil, run: @escaping () -> Void) {
        self.run = run
        super.init(title: title, action: #selector(fire), keyEquivalent: "")
        target = self
        image = systemImage.flatMap { NSImage(systemSymbolName: $0, accessibilityDescription: nil) }
    }

    required init(coder: NSCoder) { fatalError("not from a nib") }

    @objc private func fire() { run() }
}
