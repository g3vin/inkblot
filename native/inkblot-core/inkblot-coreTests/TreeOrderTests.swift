import Foundation
import Testing
@testable import inkblot_core

/// The tree's manual order, which has to agree with the page's `lib/fileTreeOrder.ts` —
/// both shells read and write the same preference.
struct TreeOrderTests {
    private func file(_ path: String) -> TreeNode {
        TreeNode(type: .file, name: String(path.split(separator: "/").last!), path: path, children: nil)
    }

    private func folder(_ path: String, _ children: [TreeNode]) -> TreeNode {
        TreeNode(type: .folder, name: String(path.split(separator: "/").last ?? ""), path: path, children: children)
    }

    private func names(_ node: TreeNode) -> [String] { (node.children ?? []).map(\.name) }

    @Test func theStoredOrderSortsAndNewEntriesGoLast() {
        var order: TreeOrderMap = ["": ["file:c", "folder:a"]]
        let tree = TreeOrder.apply(&order, to: folder("", [folder("a", []), file("b"), file("c")]))
        #expect(names(tree) == ["c", "a", "b"])
        #expect(order[""] == ["file:c", "folder:a", "file:b"])
    }

    @Test func goneEntriesAreDroppedUnlessAMoveIsInFlight() {
        var order: TreeOrderMap = ["": ["file:gone", "file:coming", "file:b"]]
        _ = TreeOrder.apply(&order, to: folder("", [file("b")]), keeping: ["file:coming"])
        #expect(order[""] == ["file:coming", "file:b"])
    }

    /// A drop reports the insertion line's index among the rows as they are, so moving
    /// down past yourself has to count yourself out.
    @Test func reorderingWithinAFolderLandsOnTheLine() {
        var order: TreeOrderMap = ["": ["file:a", "file:b", "file:c"]]
        TreeOrder.move(&order, "file:a", from: "", to: "", index: 2)
        #expect(order[""] == ["file:b", "file:a", "file:c"])
        TreeOrder.move(&order, "file:c", from: "", to: "", index: 0)
        #expect(order[""] == ["file:c", "file:b", "file:a"])
        TreeOrder.move(&order, "file:c", from: "", to: "", index: 3)
        #expect(order[""] == ["file:b", "file:a", "file:c"])
    }

    @Test func movingAcrossFoldersInsertsAtTheIndexOrAppends() {
        var order: TreeOrderMap = ["": ["file:a", "folder:f"], "f": ["file:f/x"]]
        #expect(TreeOrder.move(&order, "file:f/a", from: "", to: "f", index: 0) == 0)
        #expect(order["f"] == ["file:f/a", "file:f/x"])
        #expect(TreeOrder.move(&order, "file:b", from: "f", to: "f", index: nil) == 2)
    }

    @Test func aMovedFolderTakesItsOrderWithIt() {
        let order: TreeOrderMap = [
            "": ["folder:a", "folder:ab"],
            "a": ["file:a/x", "folder:a/sub"],
            "a/sub": ["file:a/sub/y"],
            "ab": ["file:ab/z"],
        ]
        let next = TreeOrder.remapFolder(order, from: "a", to: "ab/a")
        #expect(next[""] == ["folder:ab/a", "folder:ab"])
        #expect(next["ab/a"] == ["file:ab/a/x", "folder:ab/a/sub"])
        #expect(next["ab/a/sub"] == ["file:ab/a/sub/y"])
        // A sibling that only shares the prefix is not under it.
        #expect(next["ab"] == ["file:ab/z"])
    }
}
