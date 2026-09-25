import Foundation

/* ============================================================
   Goals: what a day asks for, and whether it got it
   ============================================================ */

/// What a goal measures.
enum GoalMetric: String, Codable, CaseIterable, Identifiable {
    /// Words written, pastes counted or not by the tracking setting.
    case words
    /// Words written less words deleted: the document's growth.
    case netWords
    case typingMinutes
    case openMinutes
    case sessions
    /// Writing segments of the timer run to their end.
    case sprints

    var id: String { rawValue }

    var title: String {
        switch self {
        case .words: "Words written"
        case .netWords: "Net words"
        case .typingMinutes: "Time typing"
        case .openMinutes: "Time open"
        case .sessions: "Sessions"
        case .sprints: "Sprints"
        }
    }

    var unit: String {
        switch self {
        case .words, .netWords: "words"
        case .typingMinutes, .openMinutes: "min"
        case .sessions: "sessions"
        case .sprints: "sprints"
        }
    }

    var symbol: String {
        switch self {
        case .words: "character.cursor.ibeam"
        case .netWords: "plus.forwardslash.minus"
        case .typingMinutes: "keyboard"
        case .openMinutes: "doc.text"
        case .sessions: "clock"
        case .sprints: "timer"
        }
    }

    var defaultAmount: Int {
        switch self {
        case .words, .netWords: 1000
        case .typingMinutes: 45
        case .openMinutes: 60
        case .sessions: 2
        case .sprints: 3
        }
    }

    /// "1,000 words", "45 min".
    func describe(_ amount: Double) -> String {
        "\(Int(amount.rounded()).formatted()) \(unit)"
    }
}

struct GoalTarget: Codable, Equatable, Hashable, Identifiable {
    var id = UUID()
    var metric: GoalMetric
    var amount: Int
}

/// What one day asks for.
struct DayGoal: Codable, Equatable, Hashable {
    var targets: [GoalTarget] = []
    /// Every target, or any one of them.
    var requireAll = true
    /// A day off. It neither counts toward a streak nor breaks one.
    var rest = false

    var isEmpty: Bool { targets.isEmpty && !rest }

    /// "1,000 words and 45 min", "Rest day".
    var summary: String {
        if rest { return "Rest day" }
        if targets.isEmpty { return "No goal" }
        return targets.map { $0.metric.describe(Double($0.amount)) }
            .joined(separator: requireAll ? " and " : " or ")
    }
}

/// A day that asks for something other than its weekday does.
struct GoalOverride: Codable, Equatable, Hashable, Identifiable {
    var id = UUID()
    /// `YYYY-MM-DD`.
    var day: String
    var goal: DayGoal
}

/// The writer's goals: a week, and the days that differ from it.
struct GoalPlan: Codable, Equatable {
    /// Sunday first, as `Calendar`'s weekdays count (1 = Sunday).
    var weekly: [DayGoal] = Array(repeating: DayGoal(), count: 7)
    var overrides: [GoalOverride] = []
    /// The project the goals are about. `nil` is all writing, everywhere.
    var project: String?

    /// Nothing asked of any day: then a streak is simply days written.
    var isEmpty: Bool {
        weekly.allSatisfy { $0.targets.isEmpty } && overrides.allSatisfy { $0.goal.targets.isEmpty }
    }

    func goal(for day: String, calendar: Calendar = .current) -> DayGoal {
        if let override = overrides.first(where: { $0.day == day }) { return override.goal }
        guard let date = StatsDay.date(day, calendar: calendar) else { return DayGoal() }
        let weekday = calendar.component(.weekday, from: date)
        return weekly.indices.contains(weekday - 1) ? weekly[weekday - 1] : DayGoal()
    }
}

/// A day's figures, in the units goals are set in.
struct DayProgress: Equatable {
    var words = 0
    var netWords = 0
    var typingSecs: Double = 0
    var openSecs: Double = 0
    var sessions = 0
    var sprints = 0

    init(words: Int = 0, netWords: Int = 0, typingSecs: Double = 0, openSecs: Double = 0, sessions: Int = 0, sprints: Int = 0) {
        self.words = words
        self.netWords = netWords
        self.typingSecs = typingSecs
        self.openSecs = openSecs
        self.sessions = sessions
        self.sprints = sprints
    }

    init(_ stat: DayStat?, sprints: Int, countingPastes: Bool) {
        let written = stat.map { $0.written(countingPastes: countingPastes) } ?? 0
        self.init(
            words: written, netWords: written - Int(stat?.wordsDeleted ?? 0),
            typingSecs: Double(stat?.activeSecs ?? 0), openSecs: Double(stat?.openSecs ?? 0),
            sessions: Int(stat?.sessions ?? 0), sprints: sprints)
    }

    func value(_ metric: GoalMetric) -> Double {
        switch metric {
        case .words: Double(words)
        case .netWords: Double(netWords)
        case .typingMinutes: typingSecs / 60
        case .openMinutes: openSecs / 60
        case .sessions: Double(sessions)
        case .sprints: Double(sprints)
        }
    }

    static func + (lhs: DayProgress, rhs: DayProgress) -> DayProgress {
        DayProgress(
            words: lhs.words + rhs.words, netWords: lhs.netWords + rhs.netWords,
            typingSecs: lhs.typingSecs + rhs.typingSecs, openSecs: lhs.openSecs + rhs.openSecs,
            sessions: lhs.sessions + rhs.sessions, sprints: lhs.sprints + rhs.sprints)
    }
}

/// How a day is doing against its goal.
struct GoalStatus: Equatable {
    struct Target: Equatable, Identifiable {
        let target: GoalTarget
        let value: Double
        var id: UUID { target.id }
        var fraction: Double { target.amount > 0 ? min(1, max(0, value / Double(target.amount))) : 1 }
        var met: Bool { value >= Double(target.amount) }
        var shortfall: Double { max(0, Double(target.amount) - value) }
    }

    let goal: DayGoal
    let targets: [Target]

    init(goal: DayGoal, progress: DayProgress) {
        self.goal = goal
        targets = goal.targets.map { Target(target: $0, value: progress.value($0.metric)) }
    }

    /// `nil` for a day with nothing asked of it.
    var met: Bool? {
        guard !targets.isEmpty else { return nil }
        return goal.requireAll ? targets.allSatisfy(\.met) : targets.contains(where: \.met)
    }

    /// How far along, as one number: the least-met target for "all", the most-met for "any".
    var fraction: Double {
        guard !targets.isEmpty else { return 0 }
        let fractions = targets.map(\.fraction)
        return (goal.requireAll ? fractions.min() : fractions.max()) ?? 0
    }

    /// "400 words and 12 min to go" — what is left, for a reminder or the panel.
    var remainingText: String? {
        guard met == false else { return nil }
        let left = targets.filter { !$0.met }
        let parts = left.map { $0.target.metric.describe($0.shortfall.rounded(.up)) }
        guard !parts.isEmpty else { return nil }
        return parts.joined(separator: goal.requireAll ? " and " : " or ") + " to go"
    }
}

/* ============================================================
   Streaks
   ============================================================ */

struct StreakSummary: Equatable {
    var current = 0
    var best = 0
    /// Today already counts toward `current`.
    var todayCounts = false
    /// Freezes used this month, and how many there are.
    var freezesUsed = 0
    var freezesAllowed = 0
}

enum StreakCalculator {
    enum Day: Equatable {
        case counts
        /// Neither counts nor breaks: a rest day, or a day with no goal of its own in a
        /// plan that has goals.
        case skipped
        case missed
    }

    /// What a finished day was.
    static func classify(_ day: String, progress: DayProgress, plan: GoalPlan, calendar: Calendar = .current) -> Day {
        if plan.isEmpty { return progress.words > 0 ? .counts : .missed }
        let goal = plan.goal(for: day, calendar: calendar)
        if goal.rest { return .skipped }
        if goal.targets.isEmpty { return progress.words > 0 ? .counts : .skipped }
        return GoalStatus(goal: goal, progress: progress).met == true ? .counts : .missed
    }

    /// Walk the days from the first with anything to today. A missed day is forgiven by
    /// a freeze while the month has one left; today, still in progress, only counts —
    /// not writing yet today breaks nothing.
    static func summarize(
        progress: [String: DayProgress], plan: GoalPlan, today: String,
        freezesPerMonth: Int, calendar: Calendar = .current
    ) -> StreakSummary {
        var summary = StreakSummary(freezesAllowed: freezesPerMonth)
        guard let first = progress.keys.min(), let start = StatsDay.date(first, calendar: calendar),
              let end = StatsDay.date(today, calendar: calendar), start <= end else { return summary }

        var run = 0
        var freezes: [String: Int] = [:]
        var date = start
        while date <= end {
            let key = StatsDay.key(date, calendar: calendar)
            let month = String(key.prefix(7))
            let kind = classify(key, progress: progress[key] ?? DayProgress(), plan: plan, calendar: calendar)
            switch kind {
            case .counts:
                run += 1
                if key == today { summary.todayCounts = true }
            case .skipped:
                break
            case .missed where key == today:
                break
            case .missed:
                if freezes[month, default: 0] < freezesPerMonth {
                    freezes[month, default: 0] += 1
                } else {
                    run = 0
                }
            }
            summary.best = max(summary.best, run)
            guard let next = calendar.date(byAdding: .day, value: 1, to: date) else { break }
            date = next
        }
        summary.current = run
        summary.freezesUsed = freezes[String(today.prefix(7)), default: 0]
        return summary
    }
}

/* ============================================================
   Deadlines
   ============================================================ */

/// A project's word count to reach by a date.
struct Deadline: Codable, Equatable, Hashable, Identifiable {
    var id = UUID()
    var project: String
    var targetWords: Int
    /// `YYYY-MM-DD`.
    var due: String
    /// Weekdays the writer writes on, 1 = Sunday.
    var writingDays: Set<Int> = Set(1...7)
    /// When it was set, for the burndown's ideal line.
    var created: String
    /// Show the day's quota as a goal of its own on the Today page.
    var feedsDailyGoal = true
}

/// Where a deadline stands today.
struct DeadlineStatus: Equatable {
    struct Point: Equatable, Identifiable {
        let day: String
        let date: Date
        let remaining: Int
        var id: String { day }
    }

    let deadline: Deadline
    let currentWords: Int
    var remaining: Int { max(0, deadline.targetWords - currentWords) }
    /// Writing days from today to the due date, today included.
    let writingDaysLeft: Int
    /// Words a writing day from here, measured from where today began — so writing
    /// today does not shrink today's quota.
    let quota: Int?
    /// Net words per writing day, over the last two weeks.
    let pace: Double
    let projectedFinish: Date?
    let burndown: [Point]

    var isDone: Bool { remaining == 0 }
    var isOverdue: Bool { writingDaysLeft == 0 && !isDone }

    var onTrack: Bool {
        guard !isDone else { return true }
        guard let projectedFinish, let due = StatsDay.date(deadline.due) else { return false }
        return projectedFinish <= due
    }

    /// - Parameter net: net words per local day in the project (written less deleted).
    static func compute(
        _ deadline: Deadline, currentWords: Int, net: [String: Int], today: String,
        calendar: Calendar = .current
    ) -> DeadlineStatus {
        let todayDate = StatsDay.date(today, calendar: calendar) ?? Date()
        let due = StatsDay.date(deadline.due, calendar: calendar) ?? todayDate
        let isWritingDay = { (date: Date) in deadline.writingDays.contains(calendar.component(.weekday, from: date)) }

        var daysLeft = 0
        var date = todayDate
        while date <= due {
            if isWritingDay(date) { daysLeft += 1 }
            guard let next = calendar.date(byAdding: .day, value: 1, to: date) else { break }
            date = next
        }

        let atStartOfToday = currentWords - (net[today] ?? 0)
        let left = max(0, deadline.targetWords - atStartOfToday)
        let quota = daysLeft > 0 ? Int((Double(left) / Double(daysLeft)).rounded(.up)) : nil

        // Pace: the last fourteen days before today, over the writing days among them.
        var paceWords = 0
        var paceDays = 0
        for back in 1...14 {
            guard let day = calendar.date(byAdding: .day, value: -back, to: todayDate) else { continue }
            if isWritingDay(day) { paceDays += 1 }
            paceWords += net[StatsDay.key(day, calendar: calendar)] ?? 0
        }
        let pace = paceDays > 0 ? Double(paceWords) / Double(paceDays) : 0

        var projected: Date?
        let remaining = max(0, deadline.targetWords - currentWords)
        if remaining == 0 {
            projected = todayDate
        } else if pace > 0 {
            var covered = 0.0
            var day = todayDate
            for _ in 0..<(365 * 5) {
                guard let next = calendar.date(byAdding: .day, value: 1, to: day) else { break }
                day = next
                if isWritingDay(day) { covered += pace }
                if covered >= Double(remaining) { projected = day; break }
            }
        }

        // Remaining words on each day since the deadline was set, worked back from
        // today's length by the net words written after each day.
        var burndown: [Point] = []
        if let created = StatsDay.date(deadline.created, calendar: calendar), created <= todayDate {
            var after = 0
            var day = todayDate
            while day >= created {
                let key = StatsDay.key(day, calendar: calendar)
                burndown.append(Point(day: key, date: day, remaining: max(0, deadline.targetWords - (currentWords - after))))
                after += net[key] ?? 0
                guard let previous = calendar.date(byAdding: .day, value: -1, to: day) else { break }
                day = previous
            }
            burndown.reverse()
        }

        return DeadlineStatus(
            deadline: deadline, currentWords: currentWords, writingDaysLeft: daysLeft, quota: quota,
            pace: pace, projectedFinish: projected, burndown: burndown)
    }
}

/* ============================================================
   Reminders
   ============================================================ */

struct Reminder: Codable, Equatable, Hashable, Identifiable {
    enum Kind: String, Codable, CaseIterable, Identifiable {
        /// At a time, on the days chosen.
        case write
        /// At a time, only if today's goal is not met yet — saying how far off it is.
        case goalNudge
        /// In the evening, only if nothing has been written today and there is a streak
        /// to lose.
        case streakAtRisk

        var id: String { rawValue }
        var title: String {
            switch self {
            case .write: "Time to write"
            case .goalNudge: "Goal not met yet"
            case .streakAtRisk: "Streak at risk"
            }
        }
    }

    var id = UUID()
    var kind: Kind
    var hour: Int
    var minute: Int
    var weekdays: Set<Int> = Set(1...7)
    /// The writer's own words, in place of Inkblot's.
    var message = ""
    var enabled = true
}

struct QuietHours: Codable, Equatable {
    var enabled = false
    var startHour = 22
    var endHour = 8

    /// Whether `hour` falls in the quiet window, which may run over midnight.
    func contains(hour: Int) -> Bool {
        guard enabled, startHour != endHour else { return false }
        return startHour < endHour ? (hour >= startHour && hour < endHour) : (hour >= startHour || hour < endHour)
    }
}

/// One notification to have pending.
struct PlannedReminder: Equatable {
    let id: String
    let components: DateComponents
    let repeats: Bool
    let title: String
    let body: String
}

/// The notifications the reminders call for, from today's standing. Pure, so the
/// tests can ask it what would be scheduled; `ReminderScheduler` hands the answer to
/// the notification center.
enum ReminderPlanner {
    static let prefix = "inkblot.reminder."
    /// The system keeps 64 pending per app; the timer's are posted, not pending.
    static let limit = 60
    static let daysAhead = 7

    struct Today: Equatable {
        var day: String
        var goalMet: Bool?
        var remainingText: String?
        var wroteToday: Bool
        var streak: Int
    }

    static func plan(
        _ reminders: [Reminder], quiet: QuietHours, goals: GoalPlan, today: Today,
        now: Date, calendar: Calendar = .current
    ) -> [PlannedReminder] {
        var planned: [PlannedReminder] = []
        for reminder in reminders where reminder.enabled && !quiet.contains(hour: reminder.hour) {
            switch reminder.kind {
            case .write:
                for weekday in reminder.weekdays.sorted() {
                    planned.append(PlannedReminder(
                        id: "\(prefix)\(reminder.id.uuidString).\(weekday)",
                        components: DateComponents(hour: reminder.hour, minute: reminder.minute, weekday: weekday),
                        repeats: true, title: "Time to write",
                        body: reminder.message.isEmpty ? "Your writing time has come round." : reminder.message))
                }
            case .goalNudge, .streakAtRisk:
                for offset in 0..<daysAhead {
                    guard let date = calendar.date(byAdding: .day, value: offset, to: calendar.startOfDay(for: now)),
                          reminder.weekdays.contains(calendar.component(.weekday, from: date)),
                          let fire = calendar.date(bySettingHour: reminder.hour, minute: reminder.minute, second: 0, of: date),
                          fire > now
                    else { continue }
                    let day = StatsDay.key(date, calendar: calendar)
                    let isToday = day == today.day
                    guard let body = body(for: reminder, day: day, isToday: isToday, goals: goals, today: today, calendar: calendar)
                    else { continue }
                    planned.append(PlannedReminder(
                        id: "\(prefix)\(reminder.id.uuidString).\(day)",
                        components: calendar.dateComponents([.year, .month, .day, .hour, .minute], from: fire),
                        repeats: false, title: reminder.kind.title, body: body))
                }
            }
        }
        return Array(planned.prefix(limit))
    }

    /// What the reminder says on that day, or `nil` when it has nothing to say.
    private static func body(
        for reminder: Reminder, day: String, isToday: Bool, goals: GoalPlan, today: Today, calendar: Calendar
    ) -> String? {
        let goal = goals.goal(for: day, calendar: calendar)
        switch reminder.kind {
        case .write:
            return nil
        case .goalNudge:
            guard !goal.rest, !goal.targets.isEmpty else { return nil }
            if isToday {
                guard today.goalMet == false else { return nil }
                if !reminder.message.isEmpty { return reminder.message }
                return today.remainingText.map { "\($0) for today’s goal." } ?? "Today’s goal is still open."
            }
            return reminder.message.isEmpty ? "Today’s goal: \(goal.summary)." : reminder.message
        case .streakAtRisk:
            if goal.rest { return nil }
            if isToday {
                guard !today.wroteToday, today.streak > 0 else { return nil }
                if !reminder.message.isEmpty { return reminder.message }
                return "Keep your \(today.streak)-day streak going — write something today."
            }
            return reminder.message.isEmpty ? "Don’t let your streak slip — there’s still time to write today." : reminder.message
        }
    }
}

/* ============================================================
   Rhythm
   ============================================================ */

/// When and how the writer writes, from a stretch of days and sessions.
struct RhythmInsights: Equatable {
    /// Active seconds by weekday (1 = Sunday) and hour.
    var grid: [Int: [Int]] = [:]
    var bestHour: Int?
    var bestWeekday: Int?
    /// Sessions with a run of at least the flow length of minutes spent typing.
    var flowSessions = 0
    var longestFlowMinutes = 0
    var sessions = 0
    var averageSessionSecs: Double = 0
    /// Deleted per written: how much of the writing is rewriting.
    var editingRatio: Double = 0
    var pastedShare: Double = 0

    var thisWeekWords = 0
    var lastWeekWords = 0
    var thisWeekTypingSecs: Double = 0

    /// A minute counts toward flow when at least this much of it was typing.
    static let flowMinuteActiveSecs: UInt32 = 20

    static func compute(
        days: [DayStat], sessions: [WritingSession], today: String, flowMinutes: Int,
        countingPastes: Bool, calendar: Calendar = .current
    ) -> RhythmInsights {
        var insights = RhythmInsights()
        var byHour = Array(repeating: 0, count: 24)
        var byWeekday = Array(repeating: 0, count: 8)
        var added = 0, deleted = 0, pasted = 0

        let todayDate = StatsDay.date(today, calendar: calendar) ?? Date()
        let weekAgo = calendar.date(byAdding: .day, value: -6, to: todayDate) ?? todayDate
        let twoWeeksAgo = calendar.date(byAdding: .day, value: -13, to: todayDate) ?? todayDate

        for day in days {
            guard let date = StatsDay.date(day.day, calendar: calendar) else { continue }
            let weekday = calendar.component(.weekday, from: date)
            var row = insights.grid[weekday] ?? Array(repeating: 0, count: 24)
            for (hour, secs) in day.hours.enumerated() where hour < 24 {
                row[hour] += Int(secs)
                byHour[hour] += Int(secs)
            }
            insights.grid[weekday] = row
            byWeekday[weekday] += Int(day.activeSecs)
            added += Int(day.wordsAdded)
            deleted += Int(day.wordsDeleted)
            pasted += Int(day.wordsPasted)

            let written = day.written(countingPastes: countingPastes)
            if date >= weekAgo {
                insights.thisWeekWords += written
                insights.thisWeekTypingSecs += Double(day.activeSecs)
            } else if date >= twoWeeksAgo {
                insights.lastWeekWords += written
            }
        }

        if let best = byHour.indices.max(by: { byHour[$0] < byHour[$1] }), byHour[best] > 0 { insights.bestHour = best }
        if let best = (1...7).max(by: { byWeekday[$0] < byWeekday[$1] }), byWeekday[best] > 0 { insights.bestWeekday = best }
        insights.editingRatio = added > 0 ? Double(deleted) / Double(added) : 0
        insights.pastedShare = added + pasted > 0 ? Double(pasted) / Double(added + pasted) : 0

        insights.sessions = sessions.count
        if !sessions.isEmpty {
            insights.averageSessionSecs = Double(sessions.map { Int($0.openSecs ?? 0) }.reduce(0, +)) / Double(sessions.count)
        }
        for session in sessions {
            let longest = longestRun(session.minutes ?? [])
            insights.longestFlowMinutes = max(insights.longestFlowMinutes, longest)
            if longest >= flowMinutes { insights.flowSessions += 1 }
        }
        return insights
    }

    /// The longest run of consecutive minutes spent mostly typing.
    static func longestRun(_ minutes: [StatsMinute]) -> Int {
        var best = 0, run = 0
        var previous: UInt32?
        for minute in minutes.sorted(by: { $0.minute < $1.minute }) {
            let typing = (minute.activeSecs ?? 0) >= flowMinuteActiveSecs
            if typing, let previous, minute.minute == previous + 1, run > 0 {
                run += 1
            } else {
                run = typing ? 1 : 0
            }
            previous = minute.minute
            best = max(best, run)
        }
        return best
    }

    /// This week against last, as "+18%", or `nil` without a last week to compare with.
    var weekChange: String? {
        guard lastWeekWords > 0 else { return nil }
        let change = Double(thisWeekWords - lastWeekWords) / Double(lastWeekWords)
        return change.formatted(.percent.precision(.fractionLength(0)).sign(strategy: .always()))
    }
}

extension Calendar {
    /// "Monday", for weekday 2.
    func weekdayName(_ weekday: Int) -> String {
        let names = weekdaySymbols
        return names.indices.contains(weekday - 1) ? names[weekday - 1] : ""
    }

    func shortWeekdayName(_ weekday: Int) -> String {
        let names = shortWeekdaySymbols
        return names.indices.contains(weekday - 1) ? names[weekday - 1] : ""
    }

    /// Weekdays in the order this locale's week runs.
    var orderedWeekdays: [Int] {
        (0..<7).map { (firstWeekday - 1 + $0) % 7 + 1 }
    }
}

/// "9–10 pm".
func hourRange(_ hour: Int) -> String {
    let start = Calendar.current.date(bySettingHour: hour, minute: 0, second: 0, of: Date()) ?? Date()
    let end = start.addingTimeInterval(3600)
    return "\(start.formatted(.dateTime.hour()))–\(end.formatted(.dateTime.hour()))"
}
