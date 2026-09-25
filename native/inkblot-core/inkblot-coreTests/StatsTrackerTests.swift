import Foundation
import Testing
@testable import inkblot_core

/// The writing-stats tracker, driven by a clock and a writer of the test's own: what
/// counts as open, as typing, as written, and where one sitting ends and the next
/// begins.
@MainActor
struct StatsTrackerTests {
    /// A tracker, the clock it reads, whether the writer is there, and what it recorded.
    @MainActor
    private final class Rig {
        var now = Date(timeIntervalSince1970: 1_773_489_600) // 2026-03-14T12:00:00Z
        var present = true
        var recorded: [WritingSession] = []
        var tracker: StatsTracker!

        init(config: StatsConfig = StatsConfig()) {
            tracker = StatsTracker(config: config, environment: StatsTracker.Environment(
                now: { [unowned self] in now },
                isPresent: { [unowned self] _ in present },
                utcOffsetMinutes: { _ in 0 },
                record: { [unowned self] in recorded.append($0) }))
        }

        func advance(_ seconds: TimeInterval, ticking: Bool = true) {
            guard ticking else {
                now += seconds
                return
            }
            for _ in 0..<Int(seconds) {
                now += 1
                tracker.tick()
            }
        }

        func load(_ doc: String, words: UInt32) {
            tracker.edit(change(doc, words: words, userEdit: false))
        }

        func type(_ doc: String, words: UInt32, paste: Bool = false) {
            tracker.edit(change(doc, words: words, userEdit: true, paste: paste))
        }

        private func change(_ doc: String, words: UInt32, userEdit: Bool, paste: Bool = false) -> DocChanged {
            DocChanged(pane: .primary, docPath: doc, userEdit: userEdit, wordCount: words, charCount: words * 5,
                       inserted: userEdit ? 5 : 0, deleted: 0, paste: paste)
        }
    }

    private func opened(_ doc: String = "one", words: UInt32 = 100) -> Rig {
        let rig = Rig()
        rig.tracker.follow(project: "Novel")
        rig.tracker.elect(docPath: doc)
        rig.load(doc, words: words)
        return rig
    }

    @Test func openTimeAccruesWhileTheWriterIsThereAndStopsWhenTheyAreNot() {
        let rig = opened()
        rig.tracker.tick()
        rig.advance(30)
        #expect(rig.tracker.session?.open == 30)

        rig.present = false
        rig.advance(20)
        #expect(rig.tracker.session?.open == 30)
    }

    @Test func editsCloseTogetherAreTypingAndAPauseIsNot() {
        let rig = opened()
        rig.type("one", words: 101)       // the first of a run: a second's credit
        rig.advance(5, ticking: false)
        rig.type("one", words: 102)       // five seconds of typing
        rig.advance(40, ticking: false)
        rig.type("one", words: 103)       // after a pause longer than the gap: a second again
        #expect(rig.tracker.session?.active == 7)
        #expect(rig.tracker.session?.wordsAdded == 3)
    }

    @Test func wordsAreMeasuredAgainstTheCountTheDocumentLoadedWith() {
        let rig = opened(words: 100)
        rig.type("one", words: 110)
        rig.type("one", words: 104)
        let session = rig.tracker.session
        #expect(session?.wordsAdded == 10)
        #expect(session?.wordsDeleted == 6)
        #expect(session?.startWords == 100)
        #expect(session?.endWords == 104)
    }

    @Test func aPasteIsCountedApartAndOnlyCountsAsWrittenWhenAskedTo() {
        let rig = opened(words: 100)
        rig.type("one", words: 102)
        rig.type("one", words: 402, paste: true)
        #expect(rig.tracker.session?.wordsPasted == 300)
        #expect(rig.tracker.session?.written(countingPastes: false) == 2)
        #expect(rig.tracker.session?.written(countingPastes: true) == 302)
    }

    @Test func anEditToADocumentWithNoCountYetCreditsNothing() {
        let rig = Rig()
        rig.tracker.follow(project: "Novel")
        rig.tracker.elect(docPath: "board.canvas")
        rig.type("board.canvas", words: 50)
        #expect(rig.tracker.session?.wordsAdded == 0)
        rig.type("board.canvas", words: 53)
        #expect(rig.tracker.session?.wordsAdded == 3)
    }

    @Test func aPointerCrossingASplitViewDoesNotEndTheSitting() {
        let rig = opened()
        rig.type("one", words: 101)
        let id = rig.tracker.session?.id
        rig.tracker.elect(docPath: "two")
        rig.advance(3)
        rig.tracker.elect(docPath: "one")
        rig.advance(20)
        #expect(rig.tracker.session?.id == id)
        #expect(rig.tracker.docPath == "one")

        // Held long enough, it is a move to the other document.
        rig.tracker.elect(docPath: "two")
        rig.advance(StatsTracker.switchHold + 1)
        #expect(rig.tracker.docPath == "two")
        #expect(rig.recorded.last?.id == id)
    }

    @Test func anEditToTheOtherPaneSwitchesAtOnce() {
        let rig = opened()
        rig.load("two", words: 10)
        rig.type("one", words: 101)
        rig.type("two", words: 12)
        #expect(rig.tracker.docPath == "two")
        #expect(rig.recorded.count == 1)
        #expect(rig.tracker.session?.wordsAdded == 2)
    }

    @Test func beingAwayLongerThanTheCutoffEndsTheSession() {
        var config = StatsConfig()
        config.idleCutoff = 60
        let rig = Rig(config: config)
        rig.tracker.follow(project: "Novel")
        rig.tracker.elect(docPath: "one")
        rig.load("one", words: 0)
        rig.type("one", words: 5)
        rig.present = false
        rig.advance(59)
        #expect(rig.tracker.session != nil)
        rig.advance(2)
        #expect(rig.tracker.session == nil)
        #expect(rig.recorded.count == 1)

        // Back, and typing: a new sitting.
        rig.present = true
        rig.type("one", words: 6)
        #expect(rig.tracker.session?.id != rig.recorded[0].id)
    }

    @Test func aGlanceAtADocumentIsNotKeptAndASittingIs() {
        let rig = opened()
        rig.tracker.tick()
        rig.advance(10)
        rig.tracker.endSession()
        #expect(rig.recorded.isEmpty)

        rig.tracker.elect(docPath: "one")
        rig.advance(45)
        rig.tracker.endSession()
        #expect(rig.recorded.count == 1)
    }

    @Test func aLongSessionIsCheckpointedAndPendingIsWhatTheStoreHasNotSeen() {
        let rig = opened()
        rig.tracker.tick()
        rig.type("one", words: 110)
        rig.advance(StatsTracker.checkpointInterval)
        #expect(rig.recorded.count == 1)
        #expect(rig.tracker.pending == StatsTracker.Pending())

        rig.type("one", words: 115)
        #expect(rig.tracker.pending.written == 5)

        // The same session, recorded again: the store keeps the latest.
        rig.tracker.endSession()
        #expect(rig.recorded.count == 2)
        #expect(Set(rig.recorded.map(\.id)).count == 1)
        #expect(rig.recorded.last?.wordsAdded == 15)
    }

    @Test func minutesAreBucketedFromTheSessionsStart() {
        let rig = opened()
        rig.tracker.tick()
        rig.type("one", words: 101)
        rig.advance(90)
        rig.type("one", words: 103)
        rig.tracker.endSession()
        let minutes = rig.recorded.last?.minutes ?? []
        #expect(minutes.map(\.minute) == [0, 1])
        #expect(minutes.map { $0.wordsAdded ?? 0 } == [1, 2])
        #expect(minutes.map { $0.openSecs ?? 0 } == [59, 31])
    }
}
