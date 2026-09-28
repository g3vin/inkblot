/**
 * How the Stats tab and the timer put figures into words, and the one read of the
 * store the panel makes (StatsPanelView.swift's `StatsSnapshot`, `StatsFormat`,
 * `TimerText`).
 */
import { addDays, dayDate, dayKey, formatClock, formatDuration, formatNumber } from '../../stats/day.js'
import { isBuiltIn, plannedDuration, segmentDuration } from '../../stats/routines.js'
import { allRoutines } from '../../stats/config.js'
import { written } from '../../stats/goals.js'

/** Opens the settings sheet, optionally on a pane: `{ pane: 'goals' }`. */
export { OPEN_SETTINGS as OPEN_SETTINGS_EVENT } from '../../stats/timerMenu.js'
import { OPEN_SETTINGS as OPEN_SETTINGS_EVENT } from '../../stats/timerMenu.js'

export const openSettings = (pane) => window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { pane } }))

/** Words per minute of typing, or a dash before there is a minute to divide by. */
export function pace(words, activeSecs) {
  if (activeSecs < 30) return '—'
  return `${formatNumber(words / (activeSecs / 60))} wpm`
}

export const plural = (count, one, many = `${one}s`) => `${formatNumber(count)} ${count === 1 ? one : many}`

export const capitalize = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text)

/* ---------------- the timer ---------------- */

/** Time left on a segment with a clock, time so far on one without, or the length of one waiting. */
export function timerClock(timer, now = Date.now()) {
  const segment = timer.segment
  if (!segment) return '0:00'
  if (timer.state === 'waiting') {
    const duration = segmentDuration(segment)
    return duration == null ? '0:00' : formatClock(duration)
  }
  const remaining = timer.remaining(now)
  return remaining != null ? formatClock(remaining) : formatClock(Math.floor(timer.elapsed(now)))
}

export function timerWords(words, goal) {
  if (goal == null) return `${plural(words, 'word')} this sprint`
  return `${formatNumber(words)} of ${formatNumber(goal)} words`
}

/** "8 segments, 2h 00m" — what a routine is, before it runs. */
export function routinePlan(routine) {
  const count = plural(routine.segments.length, 'segment')
  const total = plannedDuration(routine)
  if (total != null) return `${count}, ${formatDuration(total)}`
  if (routine.repeats === 0) return `${count}, repeating`
  if (routine.segments.length === 1 && routine.segments[0].wordGoal != null) return `Until ${formatNumber(routine.segments[0].wordGoal)} words`
  return `${count}, until you stop`
}

/* ---------------- the panel's read of the store ---------------- */

/** The scope as the store takes it, falling back when the chosen one has nothing to name. */
export function effectiveScope(chosen, project, docPath) {
  if (chosen === 'document' && !docPath) return project ? 'project' : 'all'
  if (chosen === 'project' && !project) return 'all'
  return chosen
}

export function storeScope(kind, project, docPath) {
  if (kind === 'all') return {}
  if (kind === 'project') return { project }
  return { project, docPath }
}

export async function loadSnapshot(service, kind, scope, rangeDays, now = new Date()) {
  const todayKey = dayKey(now)
  const fromDay = dayKey(addDays(now, -(rangeDays - 1)))
  const [days, totals, runs, counts] = await Promise.all([
    service.daily(scope, fromDay, todayKey),
    service.totals(scope),
    service.timerRuns(kind === 'all' ? null : scope.project),
    kind !== 'all' && scope.project ? service.projectWordCounts(scope.project) : Promise.resolve(null),
  ])
  let length = null
  if (counts) {
    if (kind === 'document') {
      const doc = counts.find((count) => count.docPath === scope.docPath)
      length = doc ? { words: doc.words, chars: doc.chars } : null
    } else {
      length = counts.reduce((sum, count) => ({ words: sum.words + count.words, chars: sum.chars + count.chars }), { words: 0, chars: 0 })
    }
  }
  return { fromDay, todayKey, days, totals, runs, length }
}

export const snapshotToday = (snapshot) => snapshot.days.find((day) => day.day === snapshot.todayKey) ?? null

/** Words a day over the range's days with any writing, today excluded. */
export function averageWrittenPerDay(snapshot, countingPastes) {
  const past = snapshot.days.filter((day) => day.day !== snapshot.todayKey && written(day, countingPastes) > 0)
  if (!past.length) return 0
  return Math.floor(past.reduce((sum, day) => sum + written(day, countingPastes), 0) / past.length)
}

/** Every day of the range, empty ones included, so the bars keep their places. */
export function activitySeries(snapshot, countingPastes) {
  const start = dayDate(snapshot.fromDay)
  const end = dayDate(snapshot.todayKey)
  if (!start || !end) return []
  const byDay = new Map(snapshot.days.map((day) => [day.day, day]))
  const series = []
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const key = dayKey(date)
    const stat = byDay.get(key)
    series.push({
      id: key, date,
      written: stat ? written(stat, countingPastes) : 0,
      deleted: stat?.wordsDeleted ?? 0,
      activeSecs: stat?.activeSecs ?? 0,
      openSecs: stat?.openSecs ?? 0,
    })
  }
  return series
}

export const shortDate = (date) => date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
export const mediumDate = (date) => date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

/** 1,200 → "1.2K". */
export const compact = (value) => new Intl.NumberFormat(undefined, { notation: 'compact' }).format(value)

/** The routines as SelectMenu options: built in, then the writer's. */
export function routineOptions(config) {
  const routines = allRoutines(config)
  const own = routines.filter((routine) => !isBuiltIn(routine))
  const builtIn = routines.filter(isBuiltIn).map((routine) => ({ value: routine.id, label: routine.name }))
  return own.length
    ? [{ label: 'Built In', options: builtIn }, { label: 'My Routines', options: own.map((routine) => ({ value: routine.id, label: routine.name })) }]
    : builtIn
}
