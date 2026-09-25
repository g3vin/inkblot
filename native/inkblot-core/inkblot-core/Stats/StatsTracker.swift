#if os(macOS)
import AppKit
#else
import UIKit
#endif
import Foundation
import Observation

/// Turns what the page reports into sittings: time with a document open, time typing,
/// words written and deleted, minute by minute.
///
/// **What a session is.** One sitting at one document, from the first moment it is in
/// front of the writer to the last. It ends when the writer moves to another document
/// or project, or has been away longer than the idle cutoff, or the Mac sleeps or
/// Inkblot quits. The next moment at a document starts a new one.
///
/// **Open time** accrues on a one-second tick while the writer is present: Inkblot is
/// frontmost and there has been input within the idle cutoff. **Active time** accrues
/// on edits: the gap between two edits closer together than the active gap is typing;
/// a longer one is thinking, and the edit after it is credited a second.
///
/// **Words** are the difference between successive counts the page sends, so a count
/// is needed before the first edit to measure it against — the page sends one when a
/// document loads (`userEdit: false`). An edit to a document with no count yet sets
/// the count and credits nothing. A window the page marked as a paste counts as pasted.
///
/// **Which document.** The page elects the active editor by where the pointer is, so a
/// pointer crossing a split view would otherwise end a session per crossing. A switch
/// by election is held for `switchHold` before it takes; an *edit* to another document
/// switches at once, because that is unambiguous.
///
/// Everything it depends on is injected (`Environment`), so the tests drive it with a
/// clock of their own.
@MainActor
@Observable
final class StatsTracker {
    struct Environment {
        var now: () -> Date = Date.init
        /// The writer is at Inkblot: it is frontmost and has had input within `cutoff`.
        var isPresent: (_ cutoff: TimeInterval) -> Bool
        var utcOffsetMinutes: (Date) -> Int = { TimeZone.current.secondsFromGMT(for: $0) / 60 }
        var record: (WritingSession) -> Void
    }

    /// The session in progress, as mutable figures. Recorded as a `WritingSession`.
    struct LiveSession: Equatable {
        struct Minute: Equatable {
            var open: Double = 0
            var active: Double = 0
            var added = 0
            var deleted = 0
            var pasted = 0
        }

        let id: String
        let project: String
        let docPath: String
        let start: Date
        let utcOffsetMinutes: Int
        var end: Date
        var open: Double = 0
        var active: Double = 0
        var wordsAdded = 0
        var wordsDeleted = 0
        var wordsPasted = 0
        var charsAdded = 0
        var charsDeleted = 0
        var startWords: Int?
        var endWords: Int?
        var minutes: [Int: Minute] = [:]
        var timerRunId: String?

        var hasEdits: Bool { wordsAdded + wordsDeleted + wordsPasted + charsAdded + charsDeleted > 0 }

        /// Words written, as the settings count them.
        func written(countingPastes: Bool) -> Int { wordsAdded + (countingPastes ? wordsPasted : 0) }

        mutating func minute(at date: Date, _ change: (inout Minute) -> Void) {
            let index = max(0, Int(date.timeIntervalSince(start) / 60))
            change(&minutes[index, default: Minute()])
        }

        var record: WritingSession {
            WritingSession(
                id: id, project: project, docPath: docPath,
                start: start.timeIntervalSince1970 * 1000, end: end.timeIntervalSince1970 * 1000,
                utcOffsetMinutes: Int32(utcOffsetMinutes),
                openSecs: UInt32(open.rounded()), activeSecs: UInt32(active.rounded()),
                wordsAdded: UInt32(wordsAdded), wordsDeleted: UInt32(wordsDeleted), wordsPasted: UInt32(wordsPasted),
                charsAdded: UInt32(charsAdded), charsDeleted: UInt32(charsDeleted),
                startWords: startWords.map(UInt32.init), endWords: endWords.map(UInt32.init),
                minutes: minutes.keys.sorted().map { index in
                    let minute = minutes[index]!
                    return StatsMinute(
                        minute: UInt32(index),
                        openSecs: UInt32(minute.open.rounded()), activeSecs: UInt32(minute.active.rounded()),
                        wordsAdded: UInt32(minute.added), wordsDeleted: UInt32(minute.deleted),
                        wordsPasted: UInt32(minute.pasted))
                },
                timerRunId: timerRunId)
        }
    }

    /// What the live session has done since it last reached the store — what a view
    /// reading the store adds on to be up to the second.
    struct Pending: Equatable {
        var written = 0
        var deleted = 0
        var open: Double = 0
        var active: Double = 0
        /// The live session has not reached the store at all yet, so it is a session
        /// the store's counts do not include.
        var isNewSession = false
    }

    /// A pointer election has to hold this long to move the session.
    static let switchHold: TimeInterval = 10
    /// A session in progress is recorded this often, so a crash costs at most this.
    static let checkpointInterval: TimeInterval = 60
    /// The most one tick may credit. A tick that arrives late — the run loop was busy,
    /// the lid was shut — has not seen the writer for the time in between.
    static let maxTick: TimeInterval = 5
    /// What the first edit after a pause is worth.
    static let burstCredit: TimeInterval = 1

    var config: StatsConfig

    private(set) var session: LiveSession?
    /// Bumped each time a record reaches the store, so a view reading the store knows
    /// to read it again.
    private(set) var revision = 0
    private(set) var project: String?
    private(set) var docPath: String?
    /// The writing timer's current run, stamped on the sessions it covers.
    var timerRunId: String? {
        didSet { session?.timerRunId = session?.timerRunId ?? timerRunId }
    }
    /// A break the timer says is not time at the document: open time stops. Edits
    /// still count — a writer who types through a break wrote those words.
    var isPaused = false
    /// Words written since launch, as the settings count them, across every session —
    /// what the timer measures a segment against.
    private(set) var wordsWritten = 0

    /// Told after each record reaches the store, and after each tick.
    @ObservationIgnored var onRecord: (() -> Void)?
    @ObservationIgnored var onTick: (() -> Void)?

    @ObservationIgnored private let environment: Environment
    @ObservationIgnored private var wordCounts: [String: Int] = [:]
    @ObservationIgnored private var recorded: LiveSession?
    @ObservationIgnored private var lastRecordAt: Date?
    @ObservationIgnored private var lastEditAt: Date?
    @ObservationIgnored private var lastTickAt: Date?
    @ObservationIgnored private var awaySince: Date?
    @ObservationIgnored private var elected: (docPath: String?, since: Date)?
    @ObservationIgnored private var ticker: Timer?
    @ObservationIgnored private var observers: [NSObjectProtocol] = []

    init(config: StatsConfig, environment: Environment) {
        self.config = config
        self.environment = environment
    }

    /* ---------------- what the page says ---------------- */

    /// The open project changed. Its session is over; a document in it has to be
    /// elected before the next begins.
    func follow(project: String?) {
        guard project != self.project else { return }
        endSession()
        self.project = project
        docPath = nil
        elected = nil
    }

    /// The page elected an editor showing `docPath`. Takes after `switchHold` (see the
    /// type's comment), or at once when nothing is open yet. An election of nothing is
    /// ignored: it is the pointer leaving the editor for the sidebar as often as it is a
    /// document closing, and a writer reading the inspector is still at the document.
    func elect(docPath: String?) {
        guard let docPath else { return }
        guard docPath != self.docPath else {
            elected = nil
            return
        }
        if self.docPath == nil {
            switchTo(docPath)
        } else if elected?.docPath != docPath {
            elected = (docPath, environment.now())
        }
    }

    func edit(_ change: DocChanged) {
        guard let project else { return }
        let key = Self.key(project, change.docPath)
        let count = Int(change.wordCount)

        guard change.userEdit else {
            // A load: the count the next edit is measured against.
            wordCounts[key] = count
            if session?.docPath == change.docPath, session?.startWords == nil {
                session?.startWords = count
                session?.endWords = count
            }
            return
        }

        if change.docPath != docPath {
            switchTo(change.docPath)
        }
        let now = environment.now()
        awaySince = nil
        begin(at: now)

        let previous = wordCounts[key]
        wordCounts[key] = count
        let paste = change.paste ?? false
        let lastEditAt = self.lastEditAt
        self.lastEditAt = now

        guard var live = session else { return }
        live.end = now
        live.endWords = count
        live.charsAdded += Int(change.inserted ?? 0)
        live.charsDeleted += Int(change.deleted ?? 0)
        let delta = previous.map { count - $0 } ?? 0
        let active: Double = paste ? 0 : lastEditAt.map { now.timeIntervalSince($0) }
            .flatMap { $0 <= config.activeGap ? $0 : nil } ?? Self.burstCredit
        live.active += active
        if delta > 0, paste { live.wordsPasted += delta }
        else if delta > 0 { live.wordsAdded += delta }
        else { live.wordsDeleted += -delta }
        if delta > 0, !paste || config.countPastedWords { wordsWritten += delta }
        live.minute(at: now) { minute in
            minute.active += active
            if delta > 0, paste { minute.pasted += delta }
            else if delta > 0 { minute.added += delta }
            else { minute.deleted += -delta }
        }
        session = live
    }

    /* ---------------- the clock ---------------- */

    /// Once a second: open time, an election that has held, an absence that has become
    /// the end of the sitting, and the checkpoint.
    func tick() {
        let now = environment.now()
        let elapsed = min(lastTickAt.map { now.timeIntervalSince($0) } ?? 0, Self.maxTick)
        lastTickAt = now

        if let elected, now.timeIntervalSince(elected.since) >= Self.switchHold {
            switchTo(elected.docPath)
        }

        if isPaused {
            // Neither here nor away: the break is the timer's, and ends on its clock.
            awaySince = nil
        } else if environment.isPresent(config.idleCutoff), project != nil, docPath != nil {
            awaySince = nil
            begin(at: now)
            if elapsed > 0 {
                session?.open += elapsed
                session?.end = now
                session?.minute(at: now) { $0.open += elapsed }
            }
        } else if session != nil {
            let since = awaySince ?? now
            awaySince = since
            if now.timeIntervalSince(since) >= config.idleCutoff {
                endSession()
            }
        }

        if let session, session != recorded,
           now.timeIntervalSince(lastRecordAt ?? session.start) >= Self.checkpointInterval {
            record(session, at: now)
        }
        onTick?()
    }

    /// Record the session in progress, if it is worth keeping, and stop it.
    func endSession() {
        defer {
            session = nil
            recorded = nil
            lastEditAt = nil
            awaySince = nil
        }
        guard let session, session != recorded else { return }
        let worthKeeping = session.hasEdits || session.open >= config.minimumSession
        // A checkpoint of a session that has since turned out not to be worth keeping
        // cannot happen: a checkpoint needs a minute of it.
        if worthKeeping { record(session, at: environment.now()) }
    }

    /// Something other than a record changed the store — a reset. Views reading it read
    /// it again.
    func noteStoreChanged() {
        revision += 1
        onRecord?()
    }

    /// The live session's work that is not in the store yet.
    var pending: Pending {
        guard let session else { return Pending() }
        let base = recorded
        return Pending(
            written: session.written(countingPastes: config.countPastedWords)
                - (base?.written(countingPastes: config.countPastedWords) ?? 0),
            deleted: session.wordsDeleted - (base?.wordsDeleted ?? 0),
            open: session.open - (base?.open ?? 0),
            active: session.active - (base?.active ?? 0),
            isNewSession: base == nil)
    }

    /* ---------------- running ---------------- */

    /// Start the tick and listen for the Mac going to sleep and the app quitting.
    func start() {
        guard ticker == nil else { return }
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        timer.tolerance = 0.2
        RunLoop.main.add(timer, forMode: .common)
        ticker = timer

        #if os(macOS)
        let ends: [(NotificationCenter, Notification.Name)] = [
            (NotificationCenter.default, NSApplication.willTerminateNotification),
            (NSWorkspace.shared.notificationCenter, NSWorkspace.willSleepNotification),
            (NSWorkspace.shared.notificationCenter, NSWorkspace.sessionDidResignActiveNotification),
        ]
        #else
        let ends: [(NotificationCenter, Notification.Name)] = [
            (NotificationCenter.default, UIApplication.willTerminateNotification),
            (NotificationCenter.default, UIApplication.didEnterBackgroundNotification),
        ]
        #endif
        observers = ends.map { center, name in
            center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.endSession() }
            }
        }
    }

    /* ---------------- internals ---------------- */

    private func switchTo(_ next: String?) {
        elected = nil
        guard next != docPath else { return }
        endSession()
        docPath = next
    }

    private func begin(at now: Date) {
        guard session == nil, let project, let docPath else { return }
        let count = wordCounts[Self.key(project, docPath)]
        session = LiveSession(
            id: UUID().uuidString, project: project, docPath: docPath, start: now,
            utcOffsetMinutes: environment.utcOffsetMinutes(now), end: now,
            startWords: count, endWords: count, timerRunId: timerRunId)
        lastRecordAt = now
        lastEditAt = nil
    }

    private func record(_ session: LiveSession, at now: Date) {
        environment.record(session.record)
        recorded = session
        lastRecordAt = now
        revision += 1
        onRecord?()
    }

    private static func key(_ project: String, _ docPath: String) -> String {
        "\(project)\u{0}\(docPath)"
    }
}

extension StatsTracker.Environment {
    /// The real clock, and the real writer: frontmost, and touching something.
    static func live(record: @escaping (WritingSession) -> Void) -> Self {
        Self(
            isPresent: { cutoff in
                #if os(macOS)
                guard NSApp.isActive else { return false }
                // Any input anywhere in the login session, not just in Inkblot — but
                // Inkblot is frontmost, so it is input to Inkblot.
                let idle = CGEventSource.secondsSinceLastEventType(
                    .combinedSessionState, eventType: CGEventType(rawValue: ~0)!)
                return idle < cutoff
                #else
                return UIApplication.shared.applicationState == .active
                #endif
            },
            record: record)
    }
}
