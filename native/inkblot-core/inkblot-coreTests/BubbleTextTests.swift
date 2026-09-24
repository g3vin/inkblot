import CoreGraphics
import Foundation
import Testing
@testable import inkblot_core

/// The bubble editor's text and drop rules, which have to agree with the page's
/// `lib/bubbleText.ts` and `lib/bubbleDrop.js` — a session arranged in one shell is
/// reopened in the other. The cases are the page's `bubble` suite's.
@MainActor
struct BubbleTextTests {
    private func texts(_ words: [BubbleWord]) -> [String] { words.map(\.text) }

    @Test(arguments: [
        ("She hesitated at the door, then she left.", ["She hesitated at the door", ",", "then she left", "."]),
        ("I stayed because it rained; the roads were closed.",
         ["I stayed", "because it rained", ";", "the roads were closed", "."]),
        ("When she left the house was quiet.", ["When she left the house was quiet", "."]),
        ("He knew the man who had called.", ["He knew the man", "who had called", "."]),
        ("Salt and pepper.", ["Salt and pepper", "."]),
        ("Wait — \"listen,\" she said.", ["Wait", "—", "\"", "listen", ",", "\"", "she said", "."]),
    ])
    func clauses(_ input: String, _ expected: [String]) {
        #expect(BubbleText.splitClauses(input) == expected)
    }

    @Test(arguments: [
        ("She hesitated, then left.", ["She", "hesitated", ",", "then", "left", "."]),
        ("\"Wait,\" she said.", ["\"", "Wait", ",", "\"", "she", "said", "."]),
        ("Really?! No...", ["Really", "?!", "No", "..."]),
        ("Mr. Smith's dog didn't bark (much).", ["Mr.", "Smith's", "dog", "didn't", "bark", "(", "much", ")", "."]),
        ("The U.S. team — tired — won.", ["The", "U.S.", "team", "—", "tired", "—", "won", "."]),
        ("'Hello,' she said, 'goodbye.'", ["'", "Hello", ",", "'", "she", "said", ",", "'", "goodbye", ".", "'"]),
        ("The dogs' bowls.", ["The", "dogs'", "bowls", "."]),
    ])
    func tokens(_ input: String, _ expected: [String]) {
        #expect(BubbleText.tokenize(input) == expected)
        #expect(BubbleText.joinTokens(expected) == input)
    }

    @Test func punctuationAndCapitals() {
        #expect(BubbleText.isPunctuation("?!") && BubbleText.isPunctuation("—") && !BubbleText.isPunctuation("didn't"))
        #expect(BubbleText.join("door", ".") == "door." && BubbleText.join("\"", "wait") == "\"wait")
        #expect(BubbleText.joinTokens(["left", ".", "she", "ran", ".", "\"", "why", "?", "\"", "he", "asked", "."],
                                      startsSentence: true) == "Left. She ran. \"Why?\" he asked.")
        let fragment = [BubbleWord(id: "a", text: "the"), BubbleWord(id: "b", text: "door")]
        #expect(BubbleText.compose(fragment, original: "the door opened") == "the door")
    }

    @Test func regroupingAndSplitting() {
        let start = BubbleText.words(BubbleText.tokenize("she left, and the door closed."))
        let clauses = BubbleText.regroup(start, .clauses)
        #expect(texts(clauses) == ["she left", ",", "and the door closed", "."])
        #expect(texts(BubbleText.split(clauses, id: clauses[2].id)) == ["she left", ",", "and", "the", "door", "closed", "."])
        #expect(texts(BubbleText.regroupWords(clauses)) == ["she", "left", ",", "and", "the", "door", "closed", "."])
        #expect(BubbleText.join(" the ", "door ") == "the door")
        #expect(BubbleText.compose(clauses, original: "She left, and the door closed.") == "She left, and the door closed.")
    }

    @Test func sentences() {
        #expect(BubbleText.splitSentences("She ran. He stayed! \"Why?\" she asked. (Then) it rained.")
                == ["She ran.", "He stayed!", "\"Why?\" she asked.", "(Then) it rained."])
        #expect(BubbleText.splitClauses("She ran, then stopped. He stayed.") == ["She ran", ",", "then stopped", ".", "He stayed", "."])
        let paragraph = BubbleText.regroup(BubbleText.words(BubbleText.tokenize("she ran. he stayed.")), .sentences)
        #expect(texts(paragraph) == ["she ran.", "he stayed."])
        #expect(BubbleText.compose([paragraph[1], paragraph[0]], original: "She ran. He stayed.") == "He stayed. She ran.")
        #expect(texts(BubbleText.regroup(BubbleText.regroup(paragraph, .words), .sentences)) == ["she ran.", "he stayed."])
    }

    @Test func capitalsFollowTheWords() {
        let moved = ["she", "left", "quietly", ".", "he", "stayed", "."].enumerated()
            .map { BubbleWord(id: "\($0.offset)", text: $0.element) }
        #expect(BubbleText.displayTexts(moved, original: "She left quietly.") == ["She", "left", "quietly", ".", "He", "stayed", "."])
        var front = moved
        front.insert(front.remove(at: 2), at: 0)
        #expect(Array(BubbleText.displayTexts(front, original: "She left quietly.").prefix(3)) == ["Quietly", "she", "left"])
        #expect(BubbleText.displayTexts([BubbleWord(id: "a", text: "she left."), BubbleWord(id: "b", text: "he stayed.")],
                                        original: "She left.") == ["She left.", "He stayed."])
        #expect(BubbleText.displayTexts(Array(moved.prefix(2)), original: "she left")[0] == "she")
    }

    @Test func regroupingKeepsTheBubbleThatBeganEachGroup() {
        let words = BubbleText.words(BubbleText.tokenize("she left, and the door closed."))
        let clauses = BubbleText.regroup(words, .clauses)
        // "she left" began at "she", "and the door closed" at "and": their glass morphs.
        #expect(clauses.map(\.id) == [words[0].id, words[2].id, words[3].id, words[7].id])
        let back = BubbleText.regroup(clauses, .words)
        #expect(back.map(\.id)[0] == words[0].id && back.map(\.id)[3] == words[3].id)
        #expect(Set(back.map(\.id)).count == back.count)
    }

    @Test func pinching() {
        #expect(BubbleText.splitOnce("she ran, then stopped. he stayed.") == ["she ran, then stopped.", "he stayed."])
        #expect(BubbleText.splitOnce("she ran, then stopped.") == ["she ran", ",", "then stopped", "."])
        #expect(BubbleText.splitOnce("then stopped.") == ["then stopped", "."])
        #expect(BubbleText.splitOnce("then stopped") == ["then", "stopped"])
        let pair = [BubbleWord(id: "a", text: "the"), BubbleWord(id: "b", text: "door"), BubbleWord(id: "c", text: ".")]
        #expect(BubbleText.mergeAdjacent(pair, at: 1) == [BubbleWord(id: "a", text: "the"), BubbleWord(id: "b", text: "door.")])
        #expect(BubbleText.mergeAdjacent(pair, at: 0)[0] == BubbleWord(id: "a", text: "the door"))
    }

    /// The page's `forms` cases.
    @Test func forms() {
        func page(_ texts: String..., mode: BubbleMode = .words) -> BubbleForms.Page {
            BubbleForms.Page(arrangement: BubbleDrop.Arrangement(words: texts.map { BubbleWord(id: $0, text: $0) }, aside: []),
                             mode: mode)
        }
        func edited(_ state: BubbleForms.State, _ next: BubbleForms.Page) -> BubbleForms.State {
            var state = state
            state.page = next
            return BubbleForms.settle(state)
        }
        var state = BubbleForms.State(page: page("a", "b"), forms: [], unsaved: nil)
        #expect(BubbleForms.pages(state) == 1 && BubbleForms.current(state) == nil)
        state = BubbleForms.save(state, id: "f1")
        #expect(BubbleForms.current(state) == 0 && BubbleForms.pages(state) == 1 && state.forms[0].mode == nil)
        #expect(BubbleForms.save(state, id: "f2") == state)
        state = edited(state, page("b", "a"))
        #expect(BubbleForms.current(state) == nil && BubbleForms.pages(state) == 2 && BubbleForms.page(state) == 1)
        state = BubbleForms.save(state, id: "f2")
        state = edited(state, page("c", mode: .clauses))
        state = BubbleForms.show(state, page: 0)
        #expect(state.page == page("a", "b") && state.unsaved == page("c", mode: .clauses)
                && BubbleForms.pages(state) == 3 && BubbleForms.page(state) == 0)
        state = BubbleForms.show(state, page: 1)
        #expect(state.page == page("b", "a") && state.unsaved == page("c", mode: .clauses))
        state = BubbleForms.show(state, page: 2)
        #expect(state.page == page("c", mode: .clauses) && state.unsaved == nil && BubbleForms.page(state) == 2)
        #expect(BubbleForms.show(state, page: 3) == state)
        state = BubbleForms.show(state, page: 0)
        state = edited(state, page("a"))
        #expect(state.unsaved == nil && BubbleForms.pages(state) == 3 && BubbleForms.page(state) == 2)
        state = BubbleForms.show(state, page: 1)
        state = BubbleForms.delete(state, at: 1)
        #expect(state.page == page("b", "a") && state.forms.count == 1 && BubbleForms.current(state) == nil
                && BubbleForms.pages(state) == 2)
        state.page.mode = .clauses
        #expect(BubbleForms.save(state, id: "f3").forms[1].mode == .clauses)
    }

    private let present = BubbleDrop.Arrangement(
        words: [BubbleWord(id: "a", text: "She"), BubbleWord(id: "b", text: "hesitated"),
                BubbleWord(id: "c", text: "quietly")],
        aside: [BubbleAside(id: "d", text: "at dawn", x: 0.05, y: 0.5)])

    @Test func drops() {
        #expect(texts(BubbleDrop.apply(.insert(index: 1, caret: .zero), dragging: "c", to: present).words)
                == ["She", "quietly", "hesitated"])
        let joined = BubbleDrop.apply(.join(id: "b", before: false), dragging: "c", to: present)
        #expect(joined.words == [BubbleWord(id: "a", text: "She"), BubbleWord(id: "b", text: "hesitated quietly")])
        #expect(BubbleDrop.apply(.join(id: "b", before: true), dragging: "a", to: joined).words[0].text
                == "She hesitated quietly")
        let aside = BubbleDrop.apply(.aside(x: 0.97, y: 0.3), dragging: "a", to: present)
        #expect(texts(aside.words) == ["hesitated", "quietly"])
        #expect(aside.aside.last == BubbleAside(id: "a", text: "She", x: 0.97, y: 0.3))
        #expect(BubbleDrop.apply(.join(id: "d", before: true), dragging: "b", to: present).aside[0].text
                == "hesitated at dawn")
        let trashed = BubbleDrop.apply(.trash, dragging: "b", to: present)
        #expect(texts(trashed.words) == ["She", "quietly"] && trashed.aside.count == 1)
    }

    @Test func geometry() {
        let stage = CGSize(width: 1000, height: 800)
        #expect(BubbleDrop.nearEdge(stage, CGPoint(x: 40, y: 400)))
        #expect(!BubbleDrop.nearEdge(stage, CGPoint(x: 500, y: 400)))
        let left = BubbleDrop.asidePoint(stage: stage, point: CGPoint(x: 30, y: 400), size: CGSize(width: 80, height: 40))
        #expect(left.x == Double((BubbleDrop.edgeMargin + 40) / 1000) && left.y == 0.5)
        let top = BubbleDrop.asidePoint(stage: stage, point: CGPoint(x: 500, y: 5), size: CGSize(width: 80, height: 40))
        #expect(top.y * 800 == Double(BubbleDrop.topClearance + 20))

        let row: [(id: String, frame: CGRect)] = [
            ("a", CGRect(x: 100, y: 100, width: 60, height: 40)),
            ("b", CGRect(x: 170, y: 100, width: 60, height: 40)),
            ("c", CGRect(x: 100, y: 150, width: 60, height: 40)),
        ]
        let rowFrame = CGRect(x: 100, y: 100, width: 400, height: 90)
        func index(_ x: CGFloat, _ y: CGFloat) -> Int? {
            if case .insert(let index, _) = BubbleDrop.insertion(row: row, rowFrame: rowFrame, at: CGPoint(x: x, y: y)) {
                return index
            }
            return nil
        }
        #expect(index(150, 120) == 1)
        #expect(index(400, 110) == 2)
        #expect(index(400, 170) == 3)
        #expect(index(110, 170) == 2)
        #expect(BubbleDrop.gapAt(row, CGPoint(x: 165, y: 120)) == 0)
        #expect(BubbleDrop.gapAt(row, CGPoint(x: 150, y: 120)) == 0)
        #expect(BubbleDrop.gapAt(row, CGPoint(x: 130, y: 120)) == nil)
        #expect(BubbleDrop.gapAt(row, CGPoint(x: 165, y: 170)) == nil)
        func dragged(_ left: CGFloat, _ right: CGFloat, _ top: CGFloat = 100) -> CGRect {
            CGRect(x: left, y: top, width: right - left, height: 40)
        }
        #expect(BubbleDrop.touchTarget(dragged(232, 292), row) == .join(id: "b", before: false))
        #expect(BubbleDrop.touchTarget(dragged(40, 102), row) == .join(id: "a", before: true))
        #expect(BubbleDrop.touchTarget(dragged(240, 300), row) == nil)
        #expect(BubbleDrop.touchTarget(dragged(140, 190), row) == nil)
        #expect(BubbleDrop.touchTarget(dragged(110, 175), row) == .join(id: "a", before: false))
        #expect(BubbleDrop.touchTarget(dragged(100, 160, 30), [row[2]]) == nil)
    }
}
