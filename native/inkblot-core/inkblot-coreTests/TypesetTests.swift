import Foundation
import Testing
@testable import inkblot_core

/// Typeset mode's native half: the left sidebar's two views, the Book navigator's menus,
/// and the page options a control writes.
@MainActor
struct TypesetTests {
    @Test func aPageOfTheBooksOwnIsNotInTheTree() {
        #expect(LeftSidebar.isBookPage("Novel/.book/dedication-a1"))
        #expect(LeftSidebar.isBookPage(".book/copyright-b2"))
        #expect(!LeftSidebar.isBookPage("Novel/One"))
        #expect(!LeftSidebar.isBookPage("Novel/.bookish/One"))
    }

    @Test func theAddMenuOffersEachPageOnceASide() {
        for side in [BookMatterMenu.front, BookMatterMenu.back] {
            let labels = side.map(\.label)
            #expect(Set(labels).count == labels.count)
            #expect(side.allSatisfy { ($0.matter == nil) != ($0.generated == nil) })
        }
        #expect(BookMatterMenu.back.first { $0.matter == .alsoBy }?.back == true)
        #expect(BookMatterMenu.front.first { $0.matter == .alsoBy }?.back == false)
    }

    @Test func pageOptionsRoundTripThroughTheirDraft() {
        let options = PageOptions(start: .verso, position: .bottom, runningHeads: false, folio: true, heading: false)
        var draft = PageOptionsDraft(options)
        #expect(draft.options == options)
        draft.position = .centered
        #expect(draft.options.position == .centered && draft.options.start == .verso)
    }

    @Test func theSectionsAreTitledAsABookIsMade() {
        #expect(BookNavigator.title(of: .front) == "Front Matter")
        #expect(BookNavigator.title(of: .body) == "Chapters")
        #expect(BookNavigator.title(of: .back) == "Back Matter")
    }

    /* ---------------- the file tree's chapter numbers ---------------- */

    private func node(_ path: String, _ children: [TreeNode]? = nil) -> TreeNode {
        TreeNode(type: children == nil ? .file : .folder, name: String(path.split(separator: "/").last ?? ""), path: path, children: children)
    }

    @Test func aBookNumbersItsDocumentsInTreeOrderLeavingOutWhatItHides() throws {
        let json = """
        {"version":1,"books":{
          "Novel":{"chapterNumbering":{"showInTree":true,"startAt":0},"excluded":["Novel/Notes"],
                   "items":[{"id":"c:Novel/Pro","kind":"chapter","path":"Novel/Pro","chapterType":"prologue"},
                            {"id":"c:Novel/Two","kind":"chapter","path":"Novel/Two","hidden":false}],
                   "continuous":true},
          "Other":{"chapterNumbering":{"showInTree":false}}
        }}
        """
        let data = try #require(json.data(using: .utf8))
        let books = BookIndex.parse(data)
        #expect(Set(books.keys) == ["Novel"])
        #expect(BookIndex.continuous(data) == ["Novel"])
        let tree = node("", [
            node("Novel", [node("Novel/Pro"), node("Novel/One"), node("Novel/Notes"), node("Novel/Act", [node("Novel/Act/Two"), node("Novel/Act/Board.canvas")]), node("Novel/Two")]),
            node("Other", [node("Other/A")]),
        ])
        let numbers = BookIndex.numbers(tree: tree, books: books)
        #expect(numbers == ["Novel/One": 0, "Novel/Act/Two": 1, "Novel/Two": 2])
    }

    @Test func aBooksFileThatIsNotOneNumbersNothing() {
        #expect(BookIndex.parse(Data("not json".utf8)).isEmpty)
        #expect(BookIndex.numbers(tree: nil, books: ["": .init(startAt: 1, skipped: [])]).isEmpty)
    }
}
