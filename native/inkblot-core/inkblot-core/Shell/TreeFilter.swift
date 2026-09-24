import Foundation

/// What the filter bar under the tree narrows it to, as Xcode's navigator filter does:
/// the rows that match, with the folders they are in.
struct TreeFilter: Equatable {
    enum Kind: String, CaseIterable, Identifiable {
        case all, documents, canvases
        var id: Self { self }
        var title: String {
            switch self {
            case .all: "All Files"
            case .documents: "Documents"
            case .canvases: "Canvases"
            }
        }
    }

    var text = ""
    var kind = Kind.all
    /// Only files opened lately — the clock button.
    var recentOnly = false

    private var query: String { text.trimmingCharacters(in: .whitespaces) }

    var isActive: Bool { !query.isEmpty || kind != .all || recentOnly }

    /// The tree as the filter leaves it: files that pass, and the folders on the way to
    /// them. A folder whose own name matches keeps what is in it, so typing a folder's
    /// name shows its contents. The tree as it is when nothing is filtered.
    func apply(to root: TreeNode?, recent: Set<String>) -> TreeNode? {
        guard let root, isActive else { return root }
        return TreeNode(type: root.type, name: root.name, path: root.path,
                        children: filtered(root.children ?? [], recent: recent, folderMatched: false))
    }

    private func filtered(_ nodes: [TreeNode], recent: Set<String>, folderMatched: Bool) -> [TreeNode] {
        nodes.compactMap { node in
            if node.type == .folder {
                let matched = folderMatched || matches(node.name)
                let children = filtered(node.children ?? [], recent: recent, folderMatched: matched)
                guard !children.isEmpty else { return nil }
                return TreeNode(type: node.type, name: node.name, path: node.path, children: children)
            }
            guard folderMatched || matches(docDisplayName(path: node.path)) else { return nil }
            if recentOnly && !recent.contains(node.path) { return nil }
            switch kind {
            case .all: return node
            case .documents: return isCanvasDoc(path: node.path) ? nil : node
            case .canvases: return isCanvasDoc(path: node.path) ? node : nil
            }
        }
    }

    private func matches(_ name: String) -> Bool {
        query.isEmpty || name.localizedStandardContains(query)
    }
}
