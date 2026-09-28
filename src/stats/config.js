/**
 * The writer's stats settings: how sittings are measured, the timer, goals,
 * deadlines and reminders. Kept by the core in `stats/config.json` exactly as the
 * Swift app wrote it (`StatsConfig.swift`), so either reads the other's.
 *
 * Every field has a default and a missing or broken one reads as it — a file
 * written by an older build is that build's settings with the new ones at their
 * defaults. A list that does not decode is dropped on its own rather than failing
 * the whole config.
 */
import { BUILT_IN_ROUTINES, SPRINT, normalizeRoutine } from './routines.js'
import { GOAL_METRICS, defaultQuietHours, emptyDayGoal, emptyGoalPlan, REMINDER_KINDS } from './goals.js'

export const STATS_CONFIG_VERSION = 1

export function defaultStatsConfig() {
  return {
    version: STATS_CONFIG_VERSION,
    idleCutoff: 5 * 60,
    activeGap: 30,
    countPastedWords: false,
    minimumSession: 30,
    routines: [],
    lastRoutineID: null,
    timerNotifications: true,
    timerSounds: true,
    sprintFocus: false,
    menuBarExtra: false,
    goals: emptyGoalPlan(),
    deadlines: [],
    reminders: [],
    quietHours: defaultQuietHours(),
    streakFreezesPerMonth: 0,
    celebrateGoals: true,
    flowMinutes: 15,
  }
}

const num = (value, fallback, min = 0) => (Number.isFinite(value) && value >= min ? value : fallback)
const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback)
const weekdays = (value) => {
  const days = Array.isArray(value) ? value.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7) : []
  return days.length || Array.isArray(value) ? [...new Set(days)].sort() : [1, 2, 3, 4, 5, 6, 7]
}

function normalizeDayGoal(raw) {
  if (!raw || typeof raw !== 'object') return emptyDayGoal()
  const targets = Array.isArray(raw.targets)
    ? raw.targets
        .filter((t) => t && GOAL_METRICS.includes(t.metric) && Number.isFinite(t.amount))
        .map((t) => ({ id: typeof t.id === 'string' ? t.id : crypto.randomUUID(), metric: t.metric, amount: Math.max(0, Math.round(t.amount)) }))
    : []
  return { targets, requireAll: bool(raw.requireAll, true), rest: bool(raw.rest, false) }
}

function normalizeGoalPlan(raw) {
  const plan = emptyGoalPlan()
  if (!raw || typeof raw !== 'object') return plan
  if (Array.isArray(raw.weekly) && raw.weekly.length === 7) plan.weekly = raw.weekly.map(normalizeDayGoal)
  if (Array.isArray(raw.overrides)) {
    plan.overrides = raw.overrides
      .filter((o) => o && typeof o.day === 'string')
      .map((o) => ({ id: typeof o.id === 'string' ? o.id : crypto.randomUUID(), day: o.day, goal: normalizeDayGoal(o.goal) }))
  }
  plan.project = typeof raw.project === 'string' ? raw.project : null
  return plan
}

function normalizeDeadline(raw) {
  if (!raw || typeof raw.project !== 'string' || typeof raw.due !== 'string') return null
  return {
    id: typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
    project: raw.project,
    targetWords: num(raw.targetWords, 0),
    due: raw.due,
    writingDays: weekdays(raw.writingDays),
    created: typeof raw.created === 'string' ? raw.created : raw.due,
    feedsDailyGoal: bool(raw.feedsDailyGoal, true),
  }
}

function normalizeReminder(raw) {
  if (!raw || !(raw.kind in REMINDER_KINDS)) return null
  return {
    id: typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
    kind: raw.kind,
    hour: Math.min(23, Math.max(0, Math.round(num(raw.hour, 9)))),
    minute: Math.min(59, Math.max(0, Math.round(num(raw.minute, 0)))),
    weekdays: weekdays(raw.weekdays),
    message: typeof raw.message === 'string' ? raw.message : '',
    enabled: bool(raw.enabled, true),
  }
}

function list(value, normalize) {
  return Array.isArray(value) ? value.map((item) => normalize(item)).filter(Boolean) : []
}

export function normalizeStatsConfig(raw) {
  const defaults = defaultStatsConfig()
  if (!raw || typeof raw !== 'object') return defaults
  const quiet = raw.quietHours && typeof raw.quietHours === 'object' ? raw.quietHours : {}
  return {
    version: Number.isInteger(raw.version) ? raw.version : defaults.version,
    idleCutoff: num(raw.idleCutoff, defaults.idleCutoff, 1),
    activeGap: num(raw.activeGap, defaults.activeGap, 1),
    countPastedWords: bool(raw.countPastedWords, defaults.countPastedWords),
    minimumSession: num(raw.minimumSession, defaults.minimumSession),
    routines: list(raw.routines, normalizeRoutine).filter((r) => r.segments.length > 0),
    lastRoutineID: typeof raw.lastRoutineID === 'string' ? raw.lastRoutineID : null,
    timerNotifications: bool(raw.timerNotifications, defaults.timerNotifications),
    timerSounds: bool(raw.timerSounds, defaults.timerSounds),
    sprintFocus: bool(raw.sprintFocus, defaults.sprintFocus),
    menuBarExtra: bool(raw.menuBarExtra, defaults.menuBarExtra),
    goals: normalizeGoalPlan(raw.goals),
    deadlines: list(raw.deadlines, normalizeDeadline),
    reminders: list(raw.reminders, normalizeReminder),
    quietHours: {
      enabled: bool(quiet.enabled, false),
      startHour: Math.round(num(quiet.startHour, 22)) % 24,
      endHour: Math.round(num(quiet.endHour, 8)) % 24,
    },
    streakFreezesPerMonth: Math.round(num(raw.streakFreezesPerMonth, 0)),
    celebrateGoals: bool(raw.celebrateGoals, defaults.celebrateGoals),
    flowMinutes: Math.round(num(raw.flowMinutes, defaults.flowMinutes, 1)),
  }
}

export function parseStatsConfig(json) {
  if (!json) return defaultStatsConfig()
  try {
    return normalizeStatsConfig(JSON.parse(json))
  } catch {
    return defaultStatsConfig()
  }
}

/** Swift's encoder omits a nil optional; so does this, so the file stays the same shape. */
export function serializeStatsConfig(config) {
  return JSON.stringify(config, (_key, value) => (value === null ? undefined : value))
}

/** Built-in routines first, then the writer's. */
export const allRoutines = (config) => [...BUILT_IN_ROUTINES, ...config.routines]

export const findRoutine = (config, id) => allRoutines(config).find((routine) => routine.id === id) ?? null

/** The routine Start runs: the last one run, or a sprint. */
export const defaultRoutine = (config) => findRoutine(config, config.lastRoutineID) ?? SPRINT
