#if os(macOS)
import AppKit
#endif
import Foundation
import Observation

/// Runs a `WritingRoutine`: write for this long, break for that long, and so on to the
/// end — or until the writer stops.
///
/// **Wall-clock deadlines, not a countdown.** A segment with a clock ends at a `Date`,
/// and every question — how long is left, has it ended — is asked of the clock. A tick
/// that comes late, or not at all while the Mac sleeps, loses nothing: the next one
/// sees the deadline passed and moves on, through as many segments as ended meanwhile,
/// and announces only where it landed.
///
/// **Words** are the stats tracker's running count (`StatsTracker.wordsWritten`), read
/// at the start of a segment and again at its end, so a segment's words are what the
/// Stats tab counts as written — pastes counted or not by the same setting.
///
/// **What it tells the rest of the app.** The run's id goes to the tracker, which
/// stamps it on the sessions inside the run; a break the routine says is not writing
/// pauses the tracker's open time. Each segment's start is announced — a sound and a
/// notification (`TimerAnnouncer`) — and the run is recorded to the store as it goes
/// and when it ends.
@MainActor
@Observable
final class WritingTimer {
    enum State: Equatable {
        case idle, running, paused
        /// A segment ended and the routine does not advance on its own: the next one
        /// begins when the writer says.
        case waiting
    }

    struct Environment {
        var now: () -> Date = Date.init
        var wordsWritten: () -> Int
        var project: () -> String?
        var utcOffsetMinutes: (Date) -> Int = { TimeZone.current.secondsFromGMT(for: $0) / 60 }
        var record: (TimerRun) -> Void
        var announce: (Announcement) -> Void
        /// The run the stats tracker is in, and whether a break has paused it.
        var track: (_ runID: String?, _ paused: Bool) -> Void
        /// Run a one-second clock of its own. The tests tick by hand.
        var ticksItself = true
    }

    struct Announcement: Equatable {
        enum Kind: Equatable { case began, waiting, finished }
        let kind: Kind
        let title: String
        let body: String
        let sound: TimerSound
    }

    /// The run in progress, as mutable figures. Recorded as a `TimerRun`.
    struct Run: Equatable, Identifiable {
        let id: String
        let routine: WritingRoutine
        let project: String?
        let start: Date
        let utcOffsetMinutes: Int
        var end: Date
        var writeSecs: TimeInterval = 0
        var breakSecs: TimeInterval = 0
        var wordsWritten = 0
        var sprintsCompleted = 0
        var sprintsSkipped = 0
        var completed = false

        var record: TimerRun {
            TimerRun(
                id: id, routineName: routine.name, project: project,
                start: start.timeIntervalSince1970 * 1000, end: end.timeIntervalSince1970 * 1000,
                utcOffsetMinutes: Int32(utcOffsetMinutes),
                writeSecs: UInt32(writeSecs.rounded()), breakSecs: UInt32(breakSecs.rounded()),
                wordsWritten: UInt32(max(0, wordsWritten)),
                sprintsCompleted: UInt32(sprintsCompleted), sprintsSkipped: UInt32(sprintsSkipped),
                completed: completed)
        }
    }

    /// A run in progress is recorded this often.
    static let checkpointInterval: TimeInterval = 60

    private(set) var state: State = .idle
    private(set) var run: Run?
    /// The segment showing: the one running, or in `.waiting` the one about to.
    private(set) var step = 0
    /// Which time through the routine's segments, from 0.
    private(set) var cycle = 0
    private(set) var segmentStart: Date?
    private(set) var deadline: Date?
    private(set) var pausedAt: Date?
    /// The last run to end, finished or stopped.
    private(set) var lastRun: Run?
    /// A run that has just finished, for the recap sheet until it is dismissed.
    var recap: Run?

    /// Told the segment running now, or `nil` between segments and after the run — for
    /// sprint mode, which clears the screen for writing.
    @ObservationIgnored var onSegmentChanged: ((TimerSegment?) -> Void)?

    @ObservationIgnored private let environment: Environment
    @ObservationIgnored private var pausedTotal: TimeInterval = 0
    @ObservationIgnored private var segmentWordsBase = 0
    @ObservationIgnored private var lastRecordAt: Date?
    @ObservationIgnored private var ticker: Timer?
    #if os(macOS)
    @ObservationIgnored private var activity: NSObjectProtocol?
    #endif

    init(environment: Environment) {
        self.environment = environment
    }

    var routine: WritingRoutine? { run?.routine }

    var segment: TimerSegment? {
        guard let segments = routine?.segments, segments.indices.contains(step) else { return nil }
        return segments[step]
    }

    var isActive: Bool { state != .idle }

    /* ---------------- what a view asks ---------------- */

    /// Time left on the segment's clock, or `nil` for a segment without one.
    func remaining(at now: Date) -> TimeInterval? {
        guard let deadline else { return nil }
        return max(0, deadline.timeIntervalSince(pausedAt ?? now))
    }

    /// Time in the segment so far, pauses left out.
    func elapsed(at now: Date) -> TimeInterval {
        guard let segmentStart else { return 0 }
        return max(0, (pausedAt ?? now).timeIntervalSince(segmentStart) - pausedTotal)
    }

    /// Words written in this segment.
    var segmentWords: Int {
        state == .running || state == .paused ? max(0, environment.wordsWritten() - segmentWordsBase) : 0
    }

    /// How far through the segment: by its clock, or by its word goal when it has no
    /// clock. `nil` for a segment with neither.
    func progress(at now: Date) -> Double? {
        guard let segment else { return nil }
        if let duration = segment.duration, duration > 0 {
            return min(1, elapsed(at: now) / duration)
        }
        if let goal = segment.wordGoal, goal > 0 {
            return min(1, Double(segmentWords) / Double(goal))
        }
        return nil
    }

    /// "2 of 8" through the segments, and "round 2 of 3" when it repeats.
    var position: String {
        guard let routine else { return "" }
        let place = "\(step + 1) of \(routine.segments.count)"
        switch routine.repeats {
        case 1: return place
        case 0: return "\(place), round \(cycle + 1)"
        default: return "\(place), round \(cycle + 1) of \(routine.repeats)"
        }
    }

    /* ---------------- what the writer does ---------------- */

    func start(_ routine: WritingRoutine) {
        guard !routine.segments.isEmpty else { return }
        if isActive { stop() }
        let now = environment.now()
        run = Run(
            id: UUID().uuidString, routine: routine, project: environment.project(), start: now,
            utcOffsetMinutes: environment.utcOffsetMinutes(now), end: now)
        step = 0
        cycle = 0
        lastRecordAt = now
        begin(at: now)
        startClock()
        if let segment { announce(.began, for: segment, after: nil) }
    }

    func pause() {
        guard state == .running else { return }
        pausedAt = environment.now()
        state = .paused
    }

    func resume() {
        guard state == .paused, let pausedAt else { return }
        let gap = environment.now().timeIntervalSince(pausedAt)
        pausedTotal += gap
        deadline = deadline?.addingTimeInterval(gap)
        self.pausedAt = nil
        state = .running
    }

    /// End the segment now and go on to the next. A writing segment ended this way is
    /// a sprint skipped, not finished.
    func skip() {
        switch state {
        case .running, .paused:
            if state == .paused { resume() }
            let announcement = finishSegment(at: environment.now(), finished: false)
            if let announcement { environment.announce(announcement) }
        case .waiting:
            proceed()
        case .idle:
            break
        }
    }

    /// Begin the segment a waiting routine is holding.
    func proceed() {
        guard state == .waiting else { return }
        begin(at: environment.now())
        if let segment { announce(.began, for: segment, after: nil) }
    }

    /// Stop the run where it is. What was written counts; nothing is finished.
    func stop() {
        guard var run, isActive else { return }
        let now = environment.now()
        if state == .running || state == .paused, let segment {
            let spent = elapsed(at: now)
            if segment.kind == .write {
                run.writeSecs += spent
                run.wordsWritten += segmentWords
            } else {
                run.breakSecs += spent
            }
        }
        run.end = pausedAt ?? now
        environment.record(run.record)
        lastRun = run
        reset()
    }

    /* ---------------- the clock ---------------- */

    func tick() {
        guard state == .running, run != nil else { return }
        let now = environment.now()
        var announcement: Announcement?

        // Every segment that has ended since the last tick, in order; only the last
        // is announced — a writer back from a sleep hears where the routine is now.
        while state == .running, let segment {
            if let deadline, deadline <= now {
                announcement = finishSegment(at: deadline, finished: true) ?? announcement
            } else if segment.kind == .write, segment.duration == nil,
                      let goal = segment.wordGoal, segmentWords >= goal {
                announcement = finishSegment(at: now, finished: true) ?? announcement
            } else {
                break
            }
        }
        if let announcement { environment.announce(announcement) }

        if let run, isActive, now.timeIntervalSince(lastRecordAt ?? run.start) >= Self.checkpointInterval {
            var checkpoint = run
            checkpoint.end = now
            environment.record(checkpoint.record)
            lastRecordAt = now
        }
    }

    /* ---------------- internals ---------------- */

    private func begin(at date: Date) {
        guard let segment, let run, let routine else { return }
        segmentStart = date
        deadline = segment.duration.map { date.addingTimeInterval($0) }
        pausedAt = nil
        pausedTotal = 0
        segmentWordsBase = environment.wordsWritten()
        state = .running
        environment.track(run.id, segment.kind == .rest && routine.pauseTrackingOnBreaks)
        onSegmentChanged?(segment)
    }

    /// Account for the segment ending at `end`, and move to the next — or to waiting,
    /// or to the end of the run. Returns what to announce.
    private func finishSegment(at end: Date, finished: Bool) -> Announcement? {
        guard var run, let routine, let segment, let segmentStart else { return nil }
        let spent = max(0, end.timeIntervalSince(segmentStart) - pausedTotal)
        let words = segmentWords
        if segment.kind == .write {
            run.writeSecs += spent
            run.wordsWritten += words
            if finished { run.sprintsCompleted += 1 } else { run.sprintsSkipped += 1 }
        } else {
            run.breakSecs += spent
        }
        run.end = end

        var nextStep = step + 1
        var nextCycle = cycle
        if nextStep >= routine.segments.count {
            nextStep = 0
            nextCycle += 1
        }
        if routine.repeats > 0, nextCycle >= routine.repeats {
            run.completed = true
            environment.record(run.record)
            lastRun = run
            recap = run
            reset()
            return Announcement(
                kind: .finished, title: "\(routine.name) complete",
                body: "\(run.wordsWritten.formatted()) words in \(StatsFormat.duration(run.writeSecs)) of writing.",
                sound: .hero)
        }

        self.run = run
        step = nextStep
        cycle = nextCycle
        let wrote = segment.kind == .write ? words : nil
        guard routine.autoAdvance else {
            state = .waiting
            self.segmentStart = nil
            deadline = nil
            environment.track(run.id, false)
            onSegmentChanged?(nil)
            let next = routine.segments[step]
            return Announcement(
                kind: .waiting, title: "\(segment.title) is over",
                body: [wroteLine(wrote), "\(next.title) is next — start it when you’re ready."]
                    .compactMap { $0 }.joined(separator: " "),
                sound: next.sound)
        }
        begin(at: end)
        return announcement(.began, for: routine.segments[step], after: wrote)
    }

    @discardableResult
    private func announce(_ kind: Announcement.Kind, for segment: TimerSegment, after wrote: Int?) -> Announcement {
        let made = announcement(kind, for: segment, after: wrote)
        environment.announce(made)
        return made
    }

    private func announcement(_ kind: Announcement.Kind, for segment: TimerSegment, after wrote: Int?) -> Announcement {
        let length: String? = segment.minutes.map { "\($0) minute\($0 == 1 ? "" : "s")" }
            ?? segment.wordGoal.map { "\($0.formatted()) words" }
        let title = segment.kind == .write ? "Time to write" : "Time for a break"
        let body = [wroteLine(wrote), [segment.title, length].compactMap { $0 }.joined(separator: " — ")]
            .compactMap { $0 }.joined(separator: " ")
        return Announcement(kind: kind, title: title, body: body, sound: segment.sound)
    }

    private func wroteLine(_ words: Int?) -> String? {
        words.map { "You wrote \($0.formatted()) word\($0 == 1 ? "" : "s")." }
    }

    private func reset() {
        state = .idle
        run = nil
        step = 0
        cycle = 0
        segmentStart = nil
        deadline = nil
        pausedAt = nil
        pausedTotal = 0
        environment.track(nil, false)
        onSegmentChanged?(nil)
        stopClock()
    }

    private func startClock() {
        guard environment.ticksItself, ticker == nil else { return }
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        timer.tolerance = 0.1
        RunLoop.main.add(timer, forMode: .common)
        ticker = timer
        #if os(macOS)
        // App Nap would let a backgrounded Inkblot's clock drift by minutes, and the
        // end of a break is exactly when the writer is somewhere else.
        activity = ProcessInfo.processInfo.beginActivity(
            options: .userInitiatedAllowingIdleSystemSleep, reason: "A writing timer is running")
        #endif
    }

    private func stopClock() {
        ticker?.invalidate()
        ticker = nil
        #if os(macOS)
        if let activity { ProcessInfo.processInfo.endActivity(activity) }
        activity = nil
        #endif
    }
}
