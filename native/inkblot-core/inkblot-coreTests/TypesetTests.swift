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
}
