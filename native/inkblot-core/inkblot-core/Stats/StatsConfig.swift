import Foundation

/// The writer's stats settings: how sittings are measured.
///
/// Kept by the core in `stats/config.json`, which stores it as given; the schema is the
/// shell's, so it is versioned here. Every field has a default and decoding tolerates a
/// missing one, so a file written by an older build reads as that build's settings with
/// the new ones at their defaults.
struct StatsConfig: Codable, Equatable {
    static let currentVersion = 1

    var version = Self.currentVersion

    /// Away longer than this and the sitting is over: open time stops, and the next
    /// keystroke starts a new session.
    var idleCutoff: TimeInterval = 5 * 60
    /// Edits closer together than this are one run of typing, and the time between them
    /// counts as active. A longer pause is thinking, not typing.
    var activeGap: TimeInterval = 30
    /// Count pasted and dropped words as written. Off by default: pasting a chapter in
    /// is not writing it.
    var countPastedWords = false
    /// A session shorter than this with nothing written is not kept — clicking through
    /// documents to find one is not a sitting at each.
    var minimumSession: TimeInterval = 30

    /* ---------------- the writing timer ---------------- */

    /// The writer's own routines. The built-in ones are not stored.
    var routines: [WritingRoutine] = []
    /// The routine Start runs, when none is picked.
    var lastRoutineID: UUID?
    /// Post a notification when a segment ends.
    var timerNotifications = true
    /// Play each segment's sound when it begins.
    var timerSounds = true

    /// Enter focus mode and hide the sidebars during the timer's writing segments.
    var sprintFocus = false
    /// The timer and today's progress in the menu bar.
    var menuBarExtra = false

    /* ---------------- goals, reminders, deadlines ---------------- */

    var goals = GoalPlan()
    var deadlines: [Deadline] = []
    var reminders: [Reminder] = []
    var quietHours = QuietHours()
    /// Missed days a month that do not break a streak.
    var streakFreezesPerMonth = 0
    /// A notification and a sound when the day's goal is met.
    var celebrateGoals = true
    /// A session with this many minutes of typing in a row is in flow.
    var flowMinutes = 15

    /// Built-in routines first, then the writer's.
    var allRoutines: [WritingRoutine] { WritingRoutine.builtIns + routines }

    func routine(_ id: UUID?) -> WritingRoutine? {
        allRoutines.first { $0.id == id }
    }

    init() {}

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let defaults = StatsConfig()
        version = try container.decodeIfPresent(Int.self, forKey: .version) ?? defaults.version
        idleCutoff = try container.decodeIfPresent(TimeInterval.self, forKey: .idleCutoff) ?? defaults.idleCutoff
        activeGap = try container.decodeIfPresent(TimeInterval.self, forKey: .activeGap) ?? defaults.activeGap
        countPastedWords = try container.decodeIfPresent(Bool.self, forKey: .countPastedWords) ?? defaults.countPastedWords
        minimumSession = try container.decodeIfPresent(TimeInterval.self, forKey: .minimumSession) ?? defaults.minimumSession
        // A routine list that does not decode is dropped rather than failing the whole
        // config — the tracking settings above are worth more than a broken routine.
        routines = (try? container.decodeIfPresent([WritingRoutine].self, forKey: .routines)) ?? defaults.routines
        lastRoutineID = try? container.decodeIfPresent(UUID.self, forKey: .lastRoutineID)
        timerNotifications = try container.decodeIfPresent(Bool.self, forKey: .timerNotifications) ?? defaults.timerNotifications
        timerSounds = try container.decodeIfPresent(Bool.self, forKey: .timerSounds) ?? defaults.timerSounds
        sprintFocus = try container.decodeIfPresent(Bool.self, forKey: .sprintFocus) ?? defaults.sprintFocus
        menuBarExtra = try container.decodeIfPresent(Bool.self, forKey: .menuBarExtra) ?? defaults.menuBarExtra
        // Each of these on its own, for the same reason as the routines.
        goals = (try? container.decodeIfPresent(GoalPlan.self, forKey: .goals)) ?? defaults.goals
        deadlines = (try? container.decodeIfPresent([Deadline].self, forKey: .deadlines)) ?? defaults.deadlines
        reminders = (try? container.decodeIfPresent([Reminder].self, forKey: .reminders)) ?? defaults.reminders
        quietHours = (try? container.decodeIfPresent(QuietHours.self, forKey: .quietHours)) ?? defaults.quietHours
        streakFreezesPerMonth = try container.decodeIfPresent(Int.self, forKey: .streakFreezesPerMonth) ?? defaults.streakFreezesPerMonth
        celebrateGoals = try container.decodeIfPresent(Bool.self, forKey: .celebrateGoals) ?? defaults.celebrateGoals
        flowMinutes = try container.decodeIfPresent(Int.self, forKey: .flowMinutes) ?? defaults.flowMinutes
    }
}
