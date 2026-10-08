/**
 * Writing routines: a sequence of writing and break segments the timer runs
 * through — a Pomodoro, a ladder, a single sprint. The writer's own are kept in the
 * stats config (`routines`).
 */
import { newId, formatNumber } from './day.js'

export const TIMER_SOUNDS = ['none', 'glass', 'ping', 'hero', 'submarine', 'purr', 'tink', 'blow', 'bottle', 'funk', 'pop']

export const soundTitle = (sound) => (sound === 'none' ? 'None' : sound[0].toUpperCase() + sound.slice(1))

export const kindTitle = (kind) => (kind === 'write' ? 'Write' : 'Break')

export const segmentTitle = (segment) => (segment.label ? segment.label : kindTitle(segment.kind))

/** Seconds on the segment's clock, or `null` for one without a clock. */
export const segmentDuration = (segment) => (segment.minutes == null ? null : segment.minutes * 60)

export function writeSegment(minutes, { goal = null, label = '', id = newId() } = {}) {
  return { id, kind: 'write', minutes, wordGoal: goal, label, sound: 'glass' }
}

export function restSegment(minutes, { label = '', id = newId() } = {}) {
  return { id, kind: 'rest', minutes, wordGoal: null, label, sound: 'purr' }
}

function normalizeSegment(raw) {
  if (!raw || typeof raw !== 'object') return null
  const kind = raw.kind === 'rest' ? 'rest' : 'write'
  const whole = (value) => (Number.isFinite(value) && value > 0 ? Math.round(value) : null)
  return {
    id: typeof raw.id === 'string' ? raw.id : newId(),
    kind,
    minutes: whole(raw.minutes),
    wordGoal: whole(raw.wordGoal),
    label: typeof raw.label === 'string' ? raw.label : '',
    sound: TIMER_SOUNDS.includes(raw.sound) ? raw.sound : kind === 'write' ? 'glass' : 'purr',
  }
}

export function normalizeRoutine(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string') return null
  const segments = Array.isArray(raw.segments) ? raw.segments.map(normalizeSegment).filter(Boolean) : []
  return {
    id: typeof raw.id === 'string' ? raw.id : newId(),
    name: raw.name,
    segments,
    repeats: Number.isInteger(raw.repeats) && raw.repeats >= 0 ? raw.repeats : 1,
    autoAdvance: raw.autoAdvance !== false,
    pauseTrackingOnBreaks: raw.pauseTrackingOnBreaks !== false,
  }
}

/** Fixed ids, so a routine chosen last time is found again after a relaunch. */
function builtIn(id, name, segments, repeats = 1) {
  const hex = (index) => index.toString(16).toUpperCase().padStart(2, '0')
  return {
    id, name, repeats, autoAdvance: true, pauseTrackingOnBreaks: true,
    segments: segments.map((segment, index) => ({
      ...segment,
      id: `5C0F1E6B-7A0D-4B8E-8A11-00000000${id.slice(-2)}${hex(index)}`,
    })),
  }
}

export const SPRINT = builtIn('5C0F1E6B-7A0D-4B8E-9E57-2A1C3D4E5F00', 'Sprint', [writeSegment(25)])
export const POMODORO = builtIn('5C0F1E6B-7A0D-4B8E-9E57-2A1C3D4E5F10', 'Pomodoro', [
  writeSegment(25), restSegment(5), writeSegment(25), restSegment(5),
  writeSegment(25), restSegment(5), writeSegment(25), restSegment(15, { label: 'Long Break' }),
])
export const LADDER = builtIn('5C0F1E6B-7A0D-4B8E-9E57-2A1C3D4E5F20', 'Ladder', [
  writeSegment(60), restSegment(10), writeSegment(30), restSegment(10), writeSegment(20),
])
export const WORD_SPRINT = builtIn('5C0F1E6B-7A0D-4B8E-9E57-2A1C3D4E5F30', '500 Words', [writeSegment(null, { goal: 500 })])
export const STOPWATCH = builtIn('5C0F1E6B-7A0D-4B8E-9E57-2A1C3D4E5F40', 'Stopwatch', [writeSegment(null)])

export const BUILT_IN_ROUTINES = [SPRINT, POMODORO, LADDER, WORD_SPRINT, STOPWATCH]

export const isBuiltIn = (routine) => BUILT_IN_ROUTINES.some((builtin) => builtin.id === routine?.id)

/** Total planned seconds, when every segment has a clock and the routine ends. */
export function plannedDuration(routine) {
  if (routine.repeats <= 0) return null
  let total = 0
  for (const segment of routine.segments) {
    const duration = segmentDuration(segment)
    if (duration == null) return null
    total += duration
  }
  return total * routine.repeats
}

/** "25 · 5 · 25 · 5 …", for a menu or a list. */
export function routineSummary(routine) {
  const joined = routine.segments
    .map((segment) => (segment.minutes != null ? `${segment.minutes}` : segment.wordGoal != null ? `${formatNumber(segment.wordGoal)}w` : '∞'))
    .join(' · ')
  if (routine.repeats === 0) return `${joined}, repeating`
  if (routine.repeats === 1) return joined
  return `${joined} ×${routine.repeats}`
}

/** A copy the writer can edit. */
export function duplicateRoutine(routine, name) {
  return {
    ...routine,
    id: newId(),
    name: name ?? `${routine.name} Copy`,
    segments: routine.segments.map((segment) => ({ ...segment, id: newId() })),
  }
}
