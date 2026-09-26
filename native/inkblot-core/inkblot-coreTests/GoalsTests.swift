import Foundation
import Testing
@testable import inkblot_core

/// Goals, streaks, deadlines, reminders and rhythm — the arithmetic, on a fixed
/// calendar so a test means the same thing in every time zone.
@MainActor
struct GoalsTests {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        calendar.firstWeekday = 1
        return calendar
    }

    /// 2026-03-02 is a Monday.
    private func day(_ n: Int) -> String { String(format: "2026-03-%02d", n) }

    private func words(_ n: Int) -> DayProgress { DayProgress(words: n, netWords: n) }

    private func plan(everyDay goal: DayGoal) -> GoalPlan {
        GoalPlan(weekly: Array(repeating: goal, count: 7))
    }

    /* ---------------- goals ---------------- */

    @Test func allNeedsEveryTargetAndAnyNeedsOne() {
        let targets = [GoalTarget(metric: .words, amount: 500), GoalTarget(metric: .typingMinutes, amount: 30)]
        let progress = DayProgress(words: 600, typingSecs: 20 * 60)
        #expect(GoalStatus(goal: DayGoal(targets: targets, requireAll: true), progress: progress).met == false)
        #expect(GoalStatus(goal: DayGoal(targets: targets, requireAll: false), progress: progress).met == true)
        let all = GoalStatus(goal: DayGoal(targets: targets), progress: progress)
        #expect(all.remainingText == "10 min to go")
        #expect(abs(all.fraction - 2.0 / 3.0) < 0.001)
        #expect(GoalStatus(goal: DayGoal(), progress: progress).met == nil)
    }

    @Test func aParticularDayOverridesItsWeekday() {
        var goals = plan(everyDay: DayGoal(targets: [GoalTarget(metric: .words, amount: 500)]))
        goals.overrides = [GoalOverride(day: day(7), goal: DayGoal(rest: true))]
        #expect(goals.goal(for: day(7), calendar: calendar).rest)
        #expect(goals.goal(for: day(8), calendar: calendar).targets.first?.amount == 500)
    }

    /* ---------------- streaks ---------------- */

    @Test func withNoGoalsAStreakIsDaysWrittenAndTodayInProgressBreaksNothing() {
        let history = [day(2): words(10), day(3): words(5), day(4): words(1)]
        let streak = StreakCalculator.summarize(progress: history, plan: GoalPlan(), today: day(5), freezesPerMonth: 0, calendar: calendar)
        #expect(streak.current == 3)
        #expect(streak.todayCounts == false)
        #expect(streak.best == 3)
    }

    @Test func aMissedGoalBreaksTheStreakAndARestDayDoesNot() {
        var goals = plan(everyDay: DayGoal(targets: [GoalTarget(metric: .words, amount: 100)]))
        goals.weekly[0].rest = true  // Sundays off
        // Fri 6, Sat 7 met; Sun 8 rest; Mon 9 met; Tue 10 short; Wed 11 met.
        let history = [day(6): words(150), day(7): words(120), day(9): words(100), day(10): words(40), day(11): words(300)]
        let streak = StreakCalculator.summarize(progress: history, plan: goals, today: day(11), freezesPerMonth: 0, calendar: calendar)
        #expect(streak.current == 1)
        #expect(streak.best == 3)
        #expect(streak.todayCounts)
    }

    @Test func aFreezeCoversAMissedDayUntilTheMonthRunsOut() {
        let history = [day(2): words(1), day(4): words(1), day(6): words(1), day(7): words(1)]
        let one = StreakCalculator.summarize(progress: history, plan: GoalPlan(), today: day(7), freezesPerMonth: 1, calendar: calendar)
        // The 3rd is frozen; the 5th has no freeze left.
        #expect(one.current == 2)
        #expect(one.freezesUsed == 1)
        let two = StreakCalculator.summarize(progress: history, plan: GoalPlan(), today: day(7), freezesPerMonth: 2, calendar: calendar)
        #expect(two.current == 4)
    }

    /* ---------------- deadlines ---------------- */

    @Test func aDeadlinesQuotaIsMeasuredFromWhereTodayBegan() {
        let deadline = Deadline(project: "Novel", targetWords: 10_000, due: day(11), created: day(2))
        // 8,000 words now, 500 of them written today; ten days left counting today.
        var net: [String: Int] = [day(2): 0]
        net[day(2)] = 500
        let status = DeadlineStatus.compute(deadline, currentWords: 8_000, net: net, today: day(2), calendar: calendar)
        #expect(status.writingDaysLeft == 10)
        #expect(status.quota == 250)  // (10,000 − 7,500) ÷ 10
        #expect(status.remaining == 2_000)
    }

    @Test func aDeadlineProjectsFromRecentPaceOnWritingDaysOnly() {
        var deadline = Deadline(project: "Novel", targetWords: 1_000, due: day(31), created: day(1))
        deadline.writingDays = [2, 3, 4, 5, 6]  // weekdays
        // Over the fourteen days before the 15th: 1,000 words across its ten weekdays.
        var net: [String: Int] = [:]
        for n in 1...14 { net[day(n)] = 0 }
        net[day(10)] = 1_000
        let status = DeadlineStatus.compute(deadline, currentWords: 500, net: net, today: day(15), calendar: calendar)
        #expect(status.pace == 100)
        // 500 left at 100 a weekday: Mon 16 … Fri 20.
        #expect(status.projectedFinish.map { StatsDay.key($0, calendar: calendar) } == day(20))
        #expect(status.onTrack)
        #expect(status.burndown.first?.remaining == 1_000 - (500 - 1_000))
        #expect(status.burndown.last?.remaining == 500)
    }

    /* ---------------- reminders ---------------- */

    private func today(met: Bool?, counts: Bool, streak: Int) -> ReminderPlanner.Today {
        ReminderPlanner.Today(day: day(2), goalMet: met, remainingText: "400 words to go", wroteToday: counts, streak: streak)
    }

    private var morning: Date { calendar.date(from: DateComponents(year: 2026, month: 3, day: 2, hour: 8))! }

    @Test func aWriteReminderRepeatsWeeklyOnItsDays() {
        let reminder = Reminder(kind: .write, hour: 9, minute: 30, weekdays: [2, 4])
        let planned = ReminderPlanner.plan([reminder], quiet: QuietHours(), goals: GoalPlan(), today: today(met: nil, counts: false, streak: 0), now: morning, calendar: calendar)
        #expect(planned.count == 2)
        #expect(planned.allSatisfy { $0.repeats })
        #expect(planned.map { $0.components.weekday } == [2, 4])
    }

    @Test func aNudgeSaysHowFarOffTheGoalIsAndIsNotSentOnceItIsMet() {
        let goals = plan(everyDay: DayGoal(targets: [GoalTarget(metric: .words, amount: 1000)]))
        let reminder = Reminder(kind: .goalNudge, hour: 19, minute: 0)
        let open = ReminderPlanner.plan([reminder], quiet: QuietHours(), goals: goals, today: today(met: false, counts: false, streak: 0), now: morning, calendar: calendar)
        #expect(open.count == ReminderPlanner.daysAhead)
        #expect(open.first?.body == "400 words to go for today’s goal.")
        #expect(open.dropFirst().first?.body == "Today’s goal: 1,000 words.")

        let met = ReminderPlanner.plan([reminder], quiet: QuietHours(), goals: goals, today: today(met: true, counts: true, streak: 3), now: morning, calendar: calendar)
        #expect(met.count == ReminderPlanner.daysAhead - 1)
        #expect(!met.contains { $0.id.hasSuffix(day(2)) })
    }

    @Test func aStreakReminderComesOnlyWhenThereIsAStreakToLose() {
        let reminder = Reminder(kind: .streakAtRisk, hour: 21, minute: 0)
        let atRisk = ReminderPlanner.plan([reminder], quiet: QuietHours(), goals: GoalPlan(), today: today(met: nil, counts: false, streak: 5), now: morning, calendar: calendar)
        #expect(atRisk.first?.body.contains("5-day streak") == true)
        let safe = ReminderPlanner.plan([reminder], quiet: QuietHours(), goals: GoalPlan(), today: today(met: nil, counts: true, streak: 5), now: morning, calendar: calendar)
        #expect(!safe.contains { $0.id.hasSuffix(day(2)) })
    }

    @Test func quietHoursRunOverMidnightAndSilenceWhatFallsInThem() {
        let quiet = QuietHours(enabled: true, startHour: 22, endHour: 7)
        #expect(quiet.contains(hour: 23) && quiet.contains(hour: 3))
        #expect(!quiet.contains(hour: 7) && !quiet.contains(hour: 12))
        let late = Reminder(kind: .write, hour: 23, minute: 0)
        #expect(ReminderPlanner.plan([late], quiet: quiet, goals: GoalPlan(), today: today(met: nil, counts: false, streak: 0), now: morning, calendar: calendar).isEmpty)
    }

    /* ---------------- rhythm ---------------- */

    @Test func flowIsTheLongestRunOfMinutesMostlyTyping() {
        let minutes = [0, 1, 2, 4, 5, 6, 7].map { StatsMinute(minute: UInt32($0), openSecs: 60, activeSecs: 40, wordsAdded: nil, wordsDeleted: nil, wordsPasted: nil) }
            + [StatsMinute(minute: 8, openSecs: 60, activeSecs: 5, wordsAdded: nil, wordsDeleted: nil, wordsPasted: nil)]
        #expect(RhythmInsights.longestRun(minutes) == 4)
    }

    @Test func thisWeekIsComparedWithTheOneBefore() {
        let stat = { (day: String, words: UInt32) in
            DayStat(day: day, openSecs: 0, activeSecs: 600, wordsAdded: words, wordsDeleted: words / 4, wordsPasted: 0, sessions: 1,
                    hours: (0..<24).map { $0 == 21 ? 600 : 0 })
        }
        let insights = RhythmInsights.compute(
            days: [stat(day(14), 1_200), stat(day(5), 1_000)], sessions: [], today: day(14), flowMinutes: 15,
            countingPastes: false, calendar: calendar)
        #expect(insights.thisWeekWords == 1_200)
        #expect(insights.lastWeekWords == 1_000)
        #expect(insights.weekChange == "+20%")
        #expect(insights.bestHour == 21)
        #expect(abs(insights.editingRatio - 0.25) < 0.001)
    }
}
