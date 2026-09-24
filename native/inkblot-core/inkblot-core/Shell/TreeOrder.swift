import Foundation

/// The tree's manual order — the same map, under the same preference key, that the
/// page's `lib/fileTreeOrder.ts` keeps, so an order made in one shell is the order the
/// other shows.
///
/// Folder path → its children in display order, each `"type:path"`. The root folder is
/// the empty-string key. Pure: no stored state, no disk; `ProjectTree` holds the map
/// and persists it.
typealias TreeOrderMap = [String: [String]]

enum TreeOrder {
    static func id(_ node: TreeNode) -> String { id(path: node.path, isFolder: node.type == .folder) }

    static func id(path: String, isFolder: Bool) -> String {
        "\(isFolder ? "folder" : "file"):\(path)"
    }

    static func parent(of path: String) -> String {
        path.split(separator: "/").dropLast().joined(separator: "/")
    }

    /// Sort a tree by the stored order, repairing the map as it goes: ids no longer in
    /// their folder are dropped, entries the map has not seen are appended. `keep` names
    /// ids that must survive the repair although the tree does not show them yet — a
    /// move sent to the page and not yet on disk, whose place would otherwise be lost to
    /// any reload in between.
    static func apply(_ order: inout TreeOrderMap, to node: TreeNode, keeping keep: Set<String> = []) -> TreeNode {
        guard node.type == .folder else { return node }
        let children = node.children ?? []
        let ids = children.map(id)
        let present = Set(ids)
        let existing = order[node.path] ?? []
        let kept = existing.filter { present.contains($0) || keep.contains($0) }
        let known = Set(kept)
        let next = kept + ids.filter { !known.contains($0) }
        if next != existing { order[node.path] = next }

        let rank = Dictionary(next.enumerated().map { ($1, $0) }, uniquingKeysWith: { first, _ in first })
        let sorted = children.sorted { (rank[id($0)] ?? .max) < (rank[id($1)] ?? .max) }
        return TreeNode(
            type: node.type, name: node.name, path: node.path,
            children: sorted.map { apply(&order, to: $0, keeping: keep) })
    }

    /// Take `itemId` out of `from` and put it at `index` in `to` — `index` counted in
    /// `to` as it is now, as a drop reports it, so a move down within one folder lands
    /// where the insertion line was drawn. `nil` appends. Returns where it landed.
    @discardableResult
    static func move(_ order: inout TreeOrderMap, _ itemId: String, from: String, to: String, index: Int?) -> Int {
        let fromList = order[from] ?? []
        let fromIndex = fromList.firstIndex(of: itemId)
        order[from] = fromList.filter { $0 != itemId }

        var toList = (order[to] ?? []).filter { $0 != itemId }
        var requested = index ?? toList.count
        if from == to, index != nil, let fromIndex, fromIndex < requested { requested -= 1 }
        let landed = max(0, min(requested, toList.count))
        toList.insert(itemId, at: landed)
        order[to] = toList
        return landed
    }

    /// Rewrite keys and ids after a folder moves: its own id, everything under it, and
    /// the lists it and its subfolders key.
    static func remapFolder(_ order: TreeOrderMap, from: String, to: String) -> TreeOrderMap {
        func remap(_ path: String) -> String {
            path == from || path.hasPrefix(from + "/") ? to + path.dropFirst(from.count) : path
        }
        func remapId(_ id: String) -> String {
            guard let colon = id.firstIndex(of: ":") else { return id }
            return id[...colon] + remap(String(id[id.index(after: colon)...]))
        }
        var next = TreeOrderMap()
        for (key, list) in order { next[remap(key)] = list.map(remapId) }
        return next
    }
}
