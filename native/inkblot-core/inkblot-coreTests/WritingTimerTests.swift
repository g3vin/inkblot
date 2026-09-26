import Foundation
import Testing
@testable import inkblot_core

/// The writing timer, on a clock of the test's own: segments ending on time and after
/// a sleep, pauses, skips, word goals, waiting routines, and what reaches the store and
/// the stats tracker.
@MainActor
struct WritingTimerTests {
    @MainActor
    private final class Rig {
        var now = Date(timeIntervalSince1970: 1_773_489_600)
        var words = 0
        var recorded: [TimerRun] = []
        var announced: [WritingTimer.Announcement] = []
        var tracking: (runID: String?, paused: Bool) = (nil, false)
        var timer: WritingTimer!

        init() {
            timer = WritingTimer(environment: WritingTimer.Environment(
                now: { [unowned self] in now },
                wordsWritten: { [unowned self] in words },
                project: { "Novel" },
                utcOffsetMinutes: { _ in 0 },
                record: { [unowned self] in recorded.append($0) },
                announce: { [unowned self] in announced.append($0) },
                track: { [unowned self] in tracking = ($0, $1) },
                ticksItself: false))
        }

        func advance(_ seconds: TimeInterval) {
            now += seconds
            timer.tick()
        }
    }

    private func routine(_ segments: [TimerSegment], repeats: Int = 1, autoAdvance: Bool = true) -> WritingRoutine {
        WritingRoutine(id: UUID(), name: "Test", segments: segments, repeats: repeats, autoAdvance: autoAdvance)
    }

    @Test func segmentsEndOnTheirClocksAndTheRunIsRecordedWhenItFinishes() {
        let rig = Rig()
        rig.timer.start(routine([.write(10), .rest(5), .write(10)]))
        #expect(rig.announced.last?.kind == .began)
        #expect(abs((rig.timer.remaining(at: rig.now) ?? 0) - 600) < 0.001)

        rig.words = 250
        rig.advance(600)
        #expect(rig.timer.segment?.kind == .rest)
        #expect(rig.announced.last?.body.contains("You wrote 250 words.") == true)
        #expect(rig.tracking.paused, "a break pauses open time")

        rig.advance(300)
        #expect(rig.timer.segment?.kind == .write)
        #expect(rig.tracking.paused == false)
        rig.words = 400
        rig.advance(600)

        #expect(rig.timer.state == .idle)
        #expect(rig.tracking.runID == nil)
        #expect(rig.announced.last?.kind == .finished)
        let run = rig.recorded.last
        #expect(run?.completed == true)
        #expect(run?.wordsWritten == 400)
        #expect(run?.sprintsCompleted == 2)
        #expect(run?.writeSecs == 1200)
        #expect(run?.breakSecs == 300)
    }

    @Test func aSleepPassesThroughEverySegmentThatEndedAndAnnouncesOnlyTheLast() {
        let rig = Rig()
        rig.timer.start(routine([.write(10), .rest(5), .write(10), .rest(5)], repeats: 0))
        rig.announced.removeAll()
        // Asleep for 17 minutes: the first sprint and break have ended, the second
        // sprint is two minutes in.
        rig.advance(17 * 60)
        #expect(rig.timer.step == 2)
        #expect(abs((rig.timer.remaining(at: rig.now) ?? 0) - 8 * 60) < 0.001)
        #expect(rig.announced.count == 1)
    }

    @Test func aPauseStopsTheClock() {
        let rig = Rig()
        rig.timer.start(routine([.write(10)]))
        rig.advance(60)
        rig.timer.pause()
        rig.advance(3600)
        #expect(rig.timer.state == .paused)
        #expect(abs((rig.timer.remaining(at: rig.now) ?? 0) - 540) < 0.001)
        rig.timer.resume()
        rig.advance(539)
        #expect(rig.timer.state == .running)
        rig.advance(1)
        #expect(rig.timer.state == .idle)
        #expect(rig.recorded.last?.writeSecs == 600)
    }

    @Test func aWordGoalWithNoClockEndsTheSegmentWhenItIsMet() {
        let rig = Rig()
        rig.words = 1000
        rig.timer.start(routine([.write(nil, goal: 100), .rest(5)]))
        rig.words = 1060
        rig.advance(30)
        #expect(rig.timer.segment?.kind == .write)
        #expect(rig.timer.progress(at: rig.now) == 0.6)
        rig.words = 1101
        rig.advance(1)
        #expect(rig.timer.segment?.kind == .rest)
    }

    @Test func aSkippedSprintIsCountedAsSkipped() {
        let rig = Rig()
        rig.timer.start(routine([.write(25), .rest(5)]))
        rig.advance(60)
        rig.timer.skip()
        #expect(rig.timer.segment?.kind == .rest)
        rig.timer.stop()
        #expect(rig.recorded.last?.sprintsSkipped == 1)
        #expect(rig.recorded.last?.sprintsCompleted == 0)
        #expect(rig.recorded.last?.completed == false)
    }

    @Test func aRoutineThatWaitsHoldsTheNextSegmentUntilTold() {
        let rig = Rig()
        rig.timer.start(routine([.write(10), .rest(5)], autoAdvance: false))
        rig.advance(600)
        #expect(rig.timer.state == .waiting)
        #expect(rig.timer.segment?.kind == .rest)
        #expect(rig.announced.last?.kind == .waiting)
        rig.advance(3600)
        #expect(rig.timer.state == .waiting, "waiting has no clock")

        rig.timer.proceed()
        #expect(rig.timer.state == .running)
        #expect(abs((rig.timer.remaining(at: rig.now) ?? 0) - 300) < 0.001)
    }

    @Test func stoppingKeepsWhatWasWritten() {
        let rig = Rig()
        rig.timer.start(routine([.write(30)]))
        rig.words = 120
        rig.advance(300)
        rig.timer.stop()
        #expect(rig.timer.state == .idle)
        let run = rig.recorded.last
        #expect(run?.wordsWritten == 120)
        #expect(run?.writeSecs == 300)
        #expect(run?.completed == false)
        #expect(rig.timer.lastRun?.wordsWritten == 120)
    }

    @Test func aLongRunIsCheckpointed() {
        let rig = Rig()
        rig.timer.start(routine([.write(nil)]))
        rig.advance(WritingTimer.checkpointInterval)
        #expect(rig.recorded.count == 1)
        #expect(rig.recorded.last?.completed == false)
    }

    @Test func theBuiltInRoutinesAreTheOnesPromised() {
        #expect(WritingRoutine.ladder.segments.compactMap(\.minutes) == [60, 10, 30, 10, 20])
        #expect(WritingRoutine.pomodoro.plannedDuration.map { Int($0) } == 130 * 60)
        #expect(WritingRoutine.builtIns.allSatisfy { $0.isBuiltIn })
        #expect(WritingRoutine.ladder.duplicate().isBuiltIn == false)
        #expect(Set(WritingRoutine.builtIns.flatMap(\.segments).map(\.id)).count
                == WritingRoutine.builtIns.flatMap(\.segments).count)
    }

    @Test func aConfigWithRoutinesRoundTripsAndABrokenListDoesNotTakeTheRestWithIt() throws {
        var config = StatsConfig()
        config.idleCutoff = 120
        config.routines = [WritingRoutine.ladder.duplicate(named: "Mine")]
        let data = try JSONEncoder().encode(config)
        let roundTripped = try JSONDecoder().decode(StatsConfig.self, from: data)
        #expect(roundTripped == config)

        let broken = #"{"idleCutoff":120,"routines":[{"nonsense":true}]}"#
        let decoded = try JSONDecoder().decode(StatsConfig.self, from: Data(broken.utf8))
        #expect(decoded.idleCutoff == 120)
        #expect(decoded.routines.isEmpty)
    }
}
