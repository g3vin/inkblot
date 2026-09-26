import Foundation
import Observation

/// Today against the writer's goals, live; the streak; the deadlines; and the
/// reminders that depend on them.
///
/// The store is read for the goal plan's scope — all writing, or one project — over the
/// last year and a bit, once at launch and again whenever something is recorded (a
/// session checkpoint, a timer run) or the day changes. Today is that record plus the
/// live session's unrecorded part, so a ring moves as the writer types.
///
/// Every second (the tracker's tick) it checks whether today's goal has just been met —
/// the celebration, once a day — and whether the reminders pending should change: a
/// nudge that says "400 words to go" is re-worded as the number falls, and withdrawn
/// the moment the goal is met.
@MainActor
@Observable
final class GoalsModel {
    /// How far back the streak and the heatmap look.
    static let historyDays = 400

    private(set) var todayKey: String
    /// Stored figures per day, in the plan's scope.
    private(set) var history: [String: DayProgress] = [:]
    /// Stored net growth per day, per project with a deadline: written, pasted and
    /// deleted all count — it is the length of the book that has to reach the target.
    private(set) var deadlineStatus: [UUID: DeadlineStatus] = [:]
    private(set) var deadlineNet: [UUID: [String: Int]] = [:]
    private(set) var isLoaded = false
    /// Today's goal was met in this launch, for the panel to mark the moment.
    private(set) var metJustNow = false

    /// What the menu bar's label shows: today's words against the goal. Kept apart from
    /// `status`, and set only when it changes, because the label is an `NSStatusItem`
    /// that AppKit re-lays-out on every change — and `status` changes every second a
    /// session is open.
    struct MenuBarSummary: Equatable {
        let words: Int
        let target: Int
        let met: Bool
    }
    private(set) var menuBarSummary: MenuBarSummary?

    @ObservationIgnored private let service: StatsService
    @ObservationIgnored private let stats: StatsTracker
    @ObservationIgnored private let notifier: TimerAnnouncer
    @ObservationIgnored private let calendar: Calendar
    @ObservationIgnored private var loading: Task<Void, Never>?
    @ObservationIgnored private var lastReminderCheck: Date = .distantPast
    /// A new day's reload in flight, so the tick does not start it again every second.
    @ObservationIgnored private var loadingDay: String?

    private static let celebratedKey = "inkblot.goals.celebrated"

    init(service: StatsService, stats: StatsTracker, notifier: TimerAnnouncer, calendar: Calendar = .current) {
        self.service = service
        self.stats = stats
        self.notifier = notifier
        self.calendar = calendar
        todayKey = StatsDay.key(Date(), calendar: calendar)
    }

    var plan: GoalPlan { stats.config.goals }
    var todayGoal: DayGoal { plan.goal(for: todayKey, calendar: calendar) }

    /// Today: the store's record and the live session's unrecorded work, when the live
    /// session is inside the plan's scope.
    var today: DayProgress {
        (history[todayKey] ?? DayProgress()) + live(in: plan.project)
    }

    var status: GoalStatus { GoalStatus(goal: todayGoal, progress: today) }

    var streak: StreakSummary {
        var days = history
        days[todayKey] = today
        return StreakCalculator.summarize(
            progress: days, plan: plan, today: todayKey,
            freezesPerMonth: stats.config.streakFreezesPerMonth, calendar: calendar)
    }

    /// Net words today in a deadline's project, stored and live.
    func netToday(for deadline: Deadline) -> Int {
        let pending = live(in: deadline.project)
        let stored = deadlineNet[deadline.id]?[todayKey] ?? 0
        return stored + pending.netWords
    }

    private func live(in project: String?) -> DayProgress {
        guard let session = stats.session, project == nil || session.project == project else { return DayProgress() }
        let pending = stats.pending
        return DayProgress(
            words: pending.written, netWords: pending.written - pending.deleted,
            typingSecs: pending.active, openSecs: pending.open, sessions: pending.isNewSession ? 1 : 0)
    }

    /* ---------------- reading the store ---------------- */

    func refresh() {
        loading?.cancel()
        loading = Task { [weak self] in await self?.load() }
    }

    private func load() async {
        let now = Date()
        let today = StatsDay.key(now, calendar: calendar)
        let from = StatsDay.key(calendar.date(byAdding: .day, value: -Self.historyDays, to: now) ?? now, calendar: calendar)
        let plan = self.plan
        let countPastes = stats.config.countPastedWords

        async let days = service.daily(StatsScope(project: plan.project, docPath: nil), from: from, to: today)
        async let runs = service.timerRuns(project: plan.project, from: from, to: today)
        let (stored, timerRuns) = await (days, runs)
        guard !Task.isCancelled else { return }

        var sprints: [String: Int] = [:]
        for run in timerRuns {
            let day = StatsDay.key(Date(timeIntervalSince1970: run.start / 1000), calendar: calendar)
            sprints[day, default: 0] += Int(run.sprintsCompleted ?? 0)
        }
        var progress: [String: DayProgress] = [:]
        for day in stored {
            progress[day.day] = DayProgress(day, sprints: sprints[day.day] ?? 0, countingPastes: countPastes)
        }
        for (day, count) in sprints where progress[day] == nil {
            progress[day] = DayProgress(sprints: count)
        }

        var statuses: [UUID: DeadlineStatus] = [:]
        var nets: [UUID: [String: Int]] = [:]
        for deadline in stats.config.deadlines {
            let start = min(deadline.created, StatsDay.key(calendar.date(byAdding: .day, value: -15, to: now) ?? now, calendar: calendar))
            let days = await service.daily(StatsScope(project: deadline.project, docPath: nil), from: start, to: today)
            let net = Dictionary(days.map { ($0.day, Int($0.wordsAdded) + Int($0.wordsPasted) - Int($0.wordsDeleted)) },
                                 uniquingKeysWith: { $1 })
            let length = await service.projectWordCounts(deadline.project).values.map { Int($0.words) }.reduce(0, +)
            nets[deadline.id] = net
            statuses[deadline.id] = DeadlineStatus.compute(deadline, currentWords: length, net: net, today: today, calendar: calendar)
        }
        guard !Task.isCancelled else { return }

        todayKey = today
        loadingDay = nil
        history = progress
        deadlineStatus = statuses
        deadlineNet = nets
        isLoaded = true
        lastReminderCheck = .distantPast
        check()
    }

    /* ---------------- every second ---------------- */

    func check() {
        let now = Date()
        let day = StatsDay.key(now, calendar: calendar)
        if day != todayKey {
            if loadingDay != day {
                loadingDay = day
                metJustNow = false
                refresh()
            }
            return
        }
        guard isLoaded else { return }

        let status = self.status
        let words = status.targets.first { $0.target.metric == .words || $0.target.metric == .netWords }
        let summary = words.map { MenuBarSummary(words: Int($0.value), target: $0.target.amount, met: status.met == true) }
        if summary != menuBarSummary { menuBarSummary = summary }

        if status.met == true, UserDefaults.standard.string(forKey: Self.celebratedKey) != todayKey {
            UserDefaults.standard.set(todayKey, forKey: Self.celebratedKey)
            metJustNow = true
            if stats.config.celebrateGoals {
                notifier.celebrate(goal: todayGoal, streak: streak.current, sound: stats.config.timerSounds)
            }
            lastReminderCheck = .distantPast
        }

        // Reminders: re-planned every half minute, and handed on only when they differ.
        guard now.timeIntervalSince(lastReminderCheck) >= 30 else { return }
        lastReminderCheck = now
        let config = stats.config
        let streak = self.streak
        let planned = ReminderPlanner.plan(
            config.reminders, quiet: config.quietHours, goals: config.goals,
            today: ReminderPlanner.Today(
                day: todayKey, goalMet: status.met, remainingText: status.remainingText,
                wroteToday: streak.todayCounts, streak: streak.current),
            now: now, calendar: calendar)
        notifier.schedule(planned)
    }
}
