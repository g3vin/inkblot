import Foundation

/// The project's books, as the file tree needs them: which folders number their
/// documents in the tree, and from what.
///
/// Read straight from `.inkblot-books.json` (the page's `bookStore.js`), tolerantly — a
/// book written by any version, or half-written, reads as far as it goes. The numbers
/// are the book's chapters in *tree* order — the tree shows its own order, whatever
/// order the book prints in — leaving out what the book hides and what it does not
/// number (a prologue, an interlude).
enum BookIndex {
    static let fileName = ".inkblot-books.json"

    struct Numbering: Equatable {
        var startAt: Int
        /// Tree paths the book hides, or does not number.
        var skipped: Set<String>
    }

    /// Every folder that numbers its documents in the tree, by folder path ("" for the
    /// project's own book).
    static func read(root: String) -> [String: Numbering] {
        guard let data = data(root) else { return [:] }
        return parse(data)
    }

    /// The folders whose documents read as one, continuous document.
    static func continuous(root: String) -> Set<String> {
        guard let data = data(root) else { return [] }
        return continuous(data)
    }

    static func continuous(_ data: Data) -> Set<String> {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let books = object["books"] as? [String: Any] else { return [] }
        return Set(books.compactMap { folder, value in ((value as? [String: Any])?["continuous"] as? Bool == true) ? folder : nil })
    }

    private static func data(_ root: String) -> Data? {
        try? Data(contentsOf: URL(fileURLWithPath: root).appendingPathComponent(fileName))
    }

    static func parse(_ data: Data) -> [String: Numbering] {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let books = object["books"] as? [String: Any] else { return [:] }
        var out: [String: Numbering] = [:]
        for (folder, value) in books {
            guard let book = value as? [String: Any],
                  let numbering = book["chapterNumbering"] as? [String: Any],
                  numbering["showInTree"] as? Bool == true else { continue }
            var skipped = Set((book["excluded"] as? [String]) ?? [])
            for case let item as [String: Any] in (book["items"] as? [Any]) ?? [] {
                guard item["kind"] as? String == "chapter", let path = item["path"] as? String else { continue }
                let type = item["chapterType"] as? String ?? "chapter"
                if item["hidden"] as? Bool == true || type != "chapter" { skipped.insert(path) }
            }
            out[folder] = Numbering(startAt: (numbering["startAt"] as? Int) == 0 ? 0 : 1, skipped: skipped)
        }
        return out
    }

    /// Each numbered document's number, by tree path: a folder's text documents in tree
    /// order, its subfolders' among them, as its book compiles them.
    static func numbers(tree: TreeNode?, books: [String: Numbering]) -> [String: Int] {
        guard let tree, !books.isEmpty else { return [:] }
        var out: [String: Int] = [:]
        func find(_ node: TreeNode, _ path: String) -> TreeNode? {
            if node.path == path, node.type == .folder { return node }
            for child in node.children ?? [] {
                if let hit = find(child, path) { return hit }
            }
            return nil
        }
        for (folder, numbering) in books {
            guard let node = folder.isEmpty ? tree : find(tree, folder) else { continue }
            var next = numbering.startAt
            func walk(_ node: TreeNode) {
                for child in node.children ?? [] {
                    if child.type == .folder {
                        walk(child)
                    } else if !isCanvasDoc(path: child.path), !isMapDoc(path: child.path), !numbering.skipped.contains(child.path) {
                        out[child.path] = next
                        next += 1
                    }
                }
            }
            walk(node)
        }
        return out
    }
}
