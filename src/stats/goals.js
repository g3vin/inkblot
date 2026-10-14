/**
 * Goals, streaks, deadlines, reminders and rhythm — pure functions over days of
 * figures. Days are `YYYY-MM-DD` keys; weekdays are 1 = Sunday.
 */
import { addDays, dayDate, dayKey, formatNumber, newId, shiftDay, weekdayOf } from './day.js'

/* ============================================================
   Goals: what a day asks for, and whether it got it
   ============================================================ */

export const GOAL_METRICS = ['words', 'netWords', 'typingMinutes', 'openMinutes', 'sessions', 'sprints']

export const METRIC_INFO = {
  words: { title: 'Words written', unit: 'words', icon: 'text-cursor', defaultAmount: 1000 },
  netWords: { title: 'Net words', unit: 'words', icon: 'plus-minus', defaultAmount: 1000 },
  typingMinutes: { title: 'Time typing', unit: 'min', icon: 'keyboard', defaultAmount: 45 },
  openMinutes: { title: 'Time open', unit: 'min', icon: 'clock', defaultAmount: 60 },
  sessions: { title: 'Sessions', unit: 'sessions', icon: 'clock', defaultAmount: 2 },
  sprints: { title: 'Sprints', unit: 'sprints', icon: 'timer', defaultAmount: 3 },
}

/** "1,000 words", "45 min". */
export const describeMetric = (metric, amount) => `${formatNumber(amount)} ${METRIC_INFO[metric]?.unit ?? ''}`.trim()

export const emptyDayGoal = () => ({ targets: [], requireAll: true, rest: false })

export const goalTarget = (metric, amount = METRIC_INFO[metric].defaultAmount) => ({ id: newId(), metric, amount })

/** "1,000 words and 45 min", "Rest day". */
export function goalSummary(goal) {
  if (goal.rest) return 'Rest day'
  if (!goal.targets.length) return 'No goal'
  return goal.targets.map((target) => describeMetric(target.metric, target.amount)).join(goal.requireAll ? ' and ' : ' or ')
}

export const emptyGoalPlan = () => ({ weekly: Array.from({ length: 7 }, emptyDayGoal), overrides: [], project: null })

/** Nothing asked of any day: then a streak is simply days written. */
export function planIsEmpty(plan) {
  return plan.weekly.every((goal) => goal.targets.length === 0) && plan.overrides.every((o) => o.goal.targets.length === 0)
}

export function goalFor(plan, day) {
  const override = plan.overrides.find((o) => o.day === day)
  if (override) return override.goal
  const date = dayDate(day)
  if (!date) return emptyDayGoal()
  return plan.weekly[weekdayOf(date) - 1] ?? emptyDayGoal()
}

/** A day's figures, in the units goals are set in. */
export const emptyProgress = () => ({ words: 0, netWords: 0, typingSecs: 0, openSecs: 0, sessions: 0, sprints: 0 })

export const written = (stat, countingPastes) => (stat.wordsAdded ?? 0) + (countingPastes ? stat.wordsPasted ?? 0 : 0)

export function progressFromDay(stat, sprints, countingPastes) {
  const words = stat ? written(stat, countingPastes) : 0
  return {
    words,
    netWords: words - (stat?.wordsDeleted ?? 0),
    typingSecs: stat?.activeSecs ?? 0,
    openSecs: stat?.openSecs ?? 0,
    sessions: stat?.sessions ?? 0,
    sprints,
  }
}

export function addProgress(a, b) {
  return {
    words: a.words + b.words, netWords: a.netWords + b.netWords,
    typingSecs: a.typingSecs + b.typingSecs, openSecs: a.openSecs + b.openSecs,
    sessions: a.sessions + b.sessions, sprints: a.sprints + b.sprints,
  }
}

export function metricValue(progress, metric) {
  switch (metric) {
    case 'words': return progress.words
    case 'netWords': return progress.netWords
    case 'typingMinutes': return progress.typingSecs / 60
    case 'openMinutes': return progress.openSecs / 60
    case 'sessions': return progress.sessions
    case 'sprints': return progress.sprints
    default: return 0
  }
}

/** How a day is doing against its goal. */
export function goalStatus(goal, progress) {
  const targets = goal.targets.map((target) => {
    const value = metricValue(progress, target.metric)
    return {
      target, value,
      fraction: target.amount > 0 ? Math.min(1, Math.max(0, value / target.amount)) : 1,
      met: value >= target.amount,
      shortfall: Math.max(0, target.amount - value),
    }
  })
  const met = targets.length === 0 ? null : goal.requireAll ? targets.every((t) => t.met) : targets.some((t) => t.met)
  const fractions = targets.map((t) => t.fraction)
  const fraction = targets.length === 0 ? 0 : goal.requireAll ? Math.min(...fractions) : Math.max(...fractions)
  let remainingText = null
  if (met === false) {
    const parts = targets.filter((t) => !t.met).map((t) => describeMetric(t.target.metric, Math.ceil(t.shortfall)))
    if (parts.length) remainingText = `${parts.join(goal.requireAll ? ' and ' : ' or ')} to go`
  }
  return { goal, targets, met, fraction, remainingText }
}

/* ============================================================
   Streaks
   ============================================================ */

/** What a finished day was: 'counts', 'skipped' (neither counts nor breaks), or 'missed'. */
export function classifyDay(day, progress, plan) {
  if (planIsEmpty(plan)) return progress.words > 0 ? 'counts' : 'missed'
  const goal = goalFor(plan, day)
  if (goal.rest) return 'skipped'
  if (!goal.targets.length) return progress.words > 0 ? 'counts' : 'skipped'
  return goalStatus(goal, progress).met === true ? 'counts' : 'missed'
}

/**
 * Walk the days from the first with anything to today. A missed day is forgiven by
 * a freeze while the month has one left; today, still in progress, only counts.
 *
 * @param {Record<string, object>} progress by day
 */
export function summarizeStreak(progress, plan, today, freezesPerMonth) {
  const summary = { current: 0, best: 0, todayCounts: false, freezesUsed: 0, freezesAllowed: freezesPerMonth }
  const keys = Object.keys(progress).sort()
  const start = dayDate(keys[0])
  const end = dayDate(today)
  if (!start || !end || start > end) return summary

  let run = 0
  const freezes = {}
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const key = dayKey(date)
    const month = key.slice(0, 7)
    const kind = classifyDay(key, progress[key] ?? emptyProgress(), plan)
    if (kind === 'counts') {
      run += 1
      if (key === today) summary.todayCounts = true
    } else if (kind === 'missed' && key !== today) {
      if ((freezes[month] ?? 0) < freezesPerMonth) freezes[month] = (freezes[month] ?? 0) + 1
      else run = 0
    }
    summary.best = Math.max(summary.best, run)
  }
  summary.current = run
  summary.freezesUsed = freezes[today.slice(0, 7)] ?? 0
  return summary
}

/* ============================================================
   Deadlines
   ============================================================ */

export function newDeadline(project, today) {
  return {
    id: newId(), project, targetWords: 80000, due: shiftDay(today, 90),
    writingDays: [1, 2, 3, 4, 5, 6, 7], created: today, feedsDailyGoal: true,
  }
}

/**
 * Where a deadline stands today.
 * @param {Record<string, number>} net net words per local day in the project
 */
export function deadlineStatus(deadline, currentWords, net, today) {
  const todayDate = dayDate(today) ?? new Date()
  const due = dayDate(deadline.due) ?? todayDate
  const writingDays = new Set(deadline.writingDays)
  const isWritingDay = (date) => writingDays.has(weekdayOf(date))

  let daysLeft = 0
  for (let date = todayDate; date <= due; date = addDays(date, 1)) {
    if (isWritingDay(date)) daysLeft += 1
  }

  const atStartOfToday = currentWords - (net[today] ?? 0)
  const left = Math.max(0, deadline.targetWords - atStartOfToday)
  const quota = daysLeft > 0 ? Math.ceil(left / daysLeft) : null

  let paceWords = 0
  let paceDays = 0
  for (let back = 1; back <= 14; back += 1) {
    const day = addDays(todayDate, -back)
    if (isWritingDay(day)) paceDays += 1
    paceWords += net[dayKey(day)] ?? 0
  }
  const pace = paceDays > 0 ? paceWords / paceDays : 0

  const remaining = Math.max(0, deadline.targetWords - currentWords)
  let projectedFinish = null
  if (remaining === 0) {
    projectedFinish = todayDate
  } else if (pace > 0) {
    let covered = 0
    let day = todayDate
    for (let i = 0; i < 365 * 5; i += 1) {
      day = addDays(day, 1)
      if (isWritingDay(day)) covered += pace
      if (covered >= remaining) { projectedFinish = day; break }
    }
  }

  const burndown = []
  const created = dayDate(deadline.created)
  if (created && created <= todayDate) {
    let after = 0
    for (let day = todayDate; day >= created; day = addDays(day, -1)) {
      const key = dayKey(day)
      burndown.push({ day: key, date: day, remaining: Math.max(0, deadline.targetWords - (currentWords - after)) })
      after += net[key] ?? 0
    }
    burndown.reverse()
  }

  const isDone = remaining === 0
  return {
    deadline, currentWords, remaining, writingDaysLeft: daysLeft, quota, pace, projectedFinish, burndown,
    isDone,
    isOverdue: daysLeft === 0 && !isDone,
    onTrack: isDone || (projectedFinish != null && projectedFinish <= due),
  }
}

/* ============================================================
   Reminders
   ============================================================ */

export const REMINDER_KINDS = {
  write: 'Time to write',
  goalNudge: 'Goal not met yet',
  streakAtRisk: 'Streak at risk',
}

export function newReminder(kind = 'write') {
  return {
    id: newId(), kind, hour: kind === 'streakAtRisk' ? 20 : 9, minute: 0,
    weekdays: [1, 2, 3, 4, 5, 6, 7], message: '', enabled: true,
  }
}

export const defaultQuietHours = () => ({ enabled: false, startHour: 22, endHour: 8 })

/** Whether `hour` falls in the quiet window, which may run over midnight. */
export function isQuiet(quiet, hour) {
  if (!quiet.enabled || quiet.startHour === quiet.endHour) return false
  return quiet.startHour < quiet.endHour
    ? hour >= quiet.startHour && hour < quiet.endHour
    : hour >= quiet.startHour || hour < quiet.endHour
}

export const REMINDER_DAYS_AHEAD = 7

/**
 * The notifications the reminders call for over the next week, as concrete fire
 * times — a web shell has no repeating system schedule, so a `write` reminder is
 * one per matching day too.
 *
 * @param {{day: string, goalMet: boolean|null, remainingText: string|null, wroteToday: boolean, streak: number}} today
 */
export function planReminders(reminders, quiet, goals, today, now) {
  const planned = []
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  for (const reminder of reminders) {
    if (!reminder.enabled || isQuiet(quiet, reminder.hour)) continue
    for (let offset = 0; offset < REMINDER_DAYS_AHEAD; offset += 1) {
      const date = addDays(startOfToday, offset)
      if (!reminder.weekdays.includes(weekdayOf(date))) continue
      const fire = new Date(date.getFullYear(), date.getMonth(), date.getDate(), reminder.hour, reminder.minute)
      if (fire <= now) continue
      const day = dayKey(date)
      const body = reminderBody(reminder, day, day === today.day, goals, today)
      if (body == null) continue
      planned.push({ id: `inkblot.reminder.${reminder.id}.${day}`, at: fire.getTime(), title: REMINDER_KINDS[reminder.kind], body })
    }
  }
  return planned.sort((a, b) => a.at - b.at).slice(0, 60)
}

function reminderBody(reminder, day, isToday, goals, today) {
  const goal = goalFor(goals, day)
  switch (reminder.kind) {
    case 'write':
      return reminder.message || 'Your writing time has come round.'
    case 'goalNudge':
      if (goal.rest || !goal.targets.length) return null
      if (isToday) {
        if (today.goalMet !== false) return null
        if (reminder.message) return reminder.message
        return today.remainingText ? `${today.remainingText} for today’s goal.` : 'Today’s goal is still open.'
      }
      return reminder.message || `Today’s goal: ${goalSummary(goal)}.`
    case 'streakAtRisk':
      if (goal.rest) return null
      if (isToday) {
        if (today.wroteToday || today.streak <= 0) return null
        return reminder.message || `Keep your ${today.streak}-day streak going — write something today.`
      }
      return reminder.message || 'Don’t let your streak slip — there’s still time to write today.'
    default:
      return null
  }
}

/* ============================================================
   Rhythm
   ============================================================ */

/** A minute counts toward flow when at least this much of it was typing. */
export const FLOW_MINUTE_ACTIVE_SECS = 20

/** The longest run of consecutive minutes spent mostly typing. */
export function longestRun(minutes) {
  let best = 0
  let run = 0
  let previous = null
  for (const minute of [...(minutes ?? [])].sort((a, b) => a.minute - b.minute)) {
    const typing = (minute.activeSecs ?? 0) >= FLOW_MINUTE_ACTIVE_SECS
    if (typing && previous != null && minute.minute === previous + 1 && run > 0) run += 1
    else run = typing ? 1 : 0
    previous = minute.minute
    best = Math.max(best, run)
  }
  return best
}

/** When and how the writer writes, from a stretch of days and sessions. */
export function rhythmInsights(days, sessions, today, flowMinutes, countingPastes) {
  const insights = {
    grid: {}, bestHour: null, bestWeekday: null, flowSessions: 0, longestFlowMinutes: 0,
    sessions: 0, averageSessionSecs: 0, editingRatio: 0, pastedShare: 0,
    thisWeekWords: 0, lastWeekWords: 0, thisWeekTypingSecs: 0, weekChange: null,
  }
  const byHour = new Array(24).fill(0)
  const byWeekday = new Array(8).fill(0)
  let added = 0
  let deleted = 0
  let pasted = 0
  const todayDate = dayDate(today) ?? new Date()
  const weekAgo = addDays(todayDate, -6)
  const twoWeeksAgo = addDays(todayDate, -13)

  for (const day of days) {
    const date = dayDate(day.day)
    if (!date) continue
    const weekday = weekdayOf(date)
    const row = insights.grid[weekday] ?? new Array(24).fill(0)
    ;(day.hours ?? []).forEach((secs, hour) => {
      if (hour >= 24) return
      row[hour] += secs
      byHour[hour] += secs
    })
    insights.grid[weekday] = row
    byWeekday[weekday] += day.activeSecs
    added += day.wordsAdded
    deleted += day.wordsDeleted
    pasted += day.wordsPasted
    const words = written(day, countingPastes)
    if (date >= weekAgo) {
      insights.thisWeekWords += words
      insights.thisWeekTypingSecs += day.activeSecs
    } else if (date >= twoWeeksAgo) {
      insights.lastWeekWords += words
    }
  }

  const bestHour = byHour.indexOf(Math.max(...byHour))
  if (byHour[bestHour] > 0) insights.bestHour = bestHour
  let bestWeekday = 1
  for (let weekday = 2; weekday <= 7; weekday += 1) if (byWeekday[weekday] > byWeekday[bestWeekday]) bestWeekday = weekday
  if (byWeekday[bestWeekday] > 0) insights.bestWeekday = bestWeekday
  insights.editingRatio = added > 0 ? deleted / added : 0
  insights.pastedShare = added + pasted > 0 ? pasted / (added + pasted) : 0

  insights.sessions = sessions.length
  if (sessions.length) insights.averageSessionSecs = sessions.reduce((sum, s) => sum + (s.openSecs ?? 0), 0) / sessions.length
  for (const session of sessions) {
    const longest = longestRun(session.minutes)
    insights.longestFlowMinutes = Math.max(insights.longestFlowMinutes, longest)
    if (longest >= flowMinutes) insights.flowSessions += 1
  }
  if (insights.lastWeekWords > 0) {
    const change = (insights.thisWeekWords - insights.lastWeekWords) / insights.lastWeekWords
    insights.weekChange = `${change >= 0 ? '+' : '−'}${Math.round(Math.abs(change) * 100)}%`
  }
  return insights
}
