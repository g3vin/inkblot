import Foundation
import Testing
@testable import inkblot_core

/// The filter bar under the tree: what it keeps, and the folders it keeps them in.
struct TreeFilterTests {
    private func file(_ path: String) -> TreeNode {
        TreeNode(type: .file, name: String(path.split(separator: "/").last!), path: path, children: nil)
    }

    private func folder(_ path: String, _ children: [TreeNode]) -> TreeNode {
        TreeNode(type: .folder, name: String(path.split(separator: "/").last ?? ""), path: path, children: children)
    }

    private func paths(_ node: TreeNode?) -> [String] {
        (node?.children ?? []).flatMap { [$0.path] + paths($0) }
    }

    private var tree: TreeNode {
        folder("", [
            folder("essays", [file("essays/Draft"), file("essays/Board.canvas")]),
            folder("empty", []),
            file("Notes"),
        ])
    }

    @Test func nothingFilteredLeavesTheTreeAlone() {
        #expect(TreeFilter().apply(to: tree, recent: []) == tree)
    }

    @Test func textKeepsMatchesAndTheFoldersTheyAreIn() {
        let shown = TreeFilter(text: "draft").apply(to: tree, recent: [])
        #expect(paths(shown) == ["essays", "essays/Draft"])
    }

    @Test func aMatchingFolderKeepsItsContents() {
        let shown = TreeFilter(text: "ess").apply(to: tree, recent: [])
        #expect(paths(shown) == ["essays", "essays/Draft", "essays/Board.canvas"])
    }

    @Test func kindAndRecentNarrowFiles() {
        #expect(paths(TreeFilter(kind: .canvases).apply(to: tree, recent: []))
                == ["essays", "essays/Board.canvas"])
        #expect(paths(TreeFilter(recentOnly: true).apply(to: tree, recent: ["Notes"])) == ["Notes"])
    }
}
