/**
 * noteReveal.js — how a tree of notes opens and closes, wherever it is drawn.
 *
 * The hover notes (NoteHoverPreview) and the notes panel (NotesPanel) open a branch
 * the same way, a generation at a time: the line to a note draws itself from its
 * parent at an even pace, so a longer one takes longer (within a floor and a ceiling);
 * the note grows out of the line's end as it arrives; its children's lines start once
 * that pop looks done. Closing plays it backwards and quicker. One set of numbers, so
 * the two never drift apart. The pop's keyframes are in Notes.css.
 */

export const STRING_PX_PER_MS = 2.9
export const STRING_MIN_MS = 36
export const STRING_MAX_MS = 150
export const STRING_ARRIVES_AT = 1
export const NOTE_POP_MS = 240
/** The pop eases out: the note looks in place well before it ends, the rest a last
 *  creep too small to see. Its children's lines start then, not after the creep,
 *  which read as a pause between one generation and the next. */
export const CHILDREN_START_AT = 0.45
/** Closing, the opening backwards and quicker: a note shrinks in NOTE_CLOSE_MS, then
 *  its line draws back into its parent, never quicker than STRING_CLOSE_MIN_MS so
 *  even a short one is seen to go; a parent shrinks once all its lines are in. */
export const NOTE_CLOSE_MS = 110
export const STRING_CLOSE_MIN_MS = 90
export const STRING_CLOSE_SPEED = 0.8

/** How long a line of this length takes to draw. */
export const drawMs = (length) => (
  Math.round(Math.min(STRING_MAX_MS, Math.max(STRING_MIN_MS, (length || 0) / STRING_PX_PER_MS)))
)

/** When a child's line starts, given its parent's timing (none for the first generation). */
export const lineStart = (parentTiming) => (
  parentTiming ? parentTiming.pop + Math.round(NOTE_POP_MS * CHILDREN_START_AT) : 0
)

/** A note's opening: its line starts at `line`, takes `draw`, and the note pops on arrival. */
export const openTiming = (line, draw) => ({ line, draw, pop: line + Math.round(draw * STRING_ARRIVES_AT) })

/**
 * When each note and line goes as a tree closes, from the deepest up. `edges` are
 * { fromNoteId, toNoteId, duration }, the first generation with no `fromNoteId`.
 * Returns, by note id, its card's { delay, ms } and its line's; and how long it takes.
 */
export const closeSchedule = (edges) => {
  const children = new Map()
  edges.forEach((edge) => {
    if (!edge.fromNoteId) return
    if (!children.has(edge.fromNoteId)) children.set(edge.fromNoteId, [])
    children.get(edge.fromNoteId).push(edge)
  })
  const schedule = new Map()
  let total = 0
  // A note's card goes once its children's lines are all in; then its own line.
  const visit = (edge) => {
    const start = (children.get(edge.toNoteId) || []).reduce((latest, child) => Math.max(latest, visit(child)), 0)
    const stringMs = Math.max(STRING_CLOSE_MIN_MS, Math.round((edge.duration || 0) * STRING_CLOSE_SPEED))
    const stringDelay = start + Math.round(NOTE_CLOSE_MS * 0.7)
    schedule.set(edge.toNoteId, { card: { delay: start, ms: NOTE_CLOSE_MS }, string: { delay: stringDelay, ms: stringMs } })
    total = Math.max(total, stringDelay + stringMs)
    return stringDelay + stringMs
  }
  edges.filter((edge) => !edge.fromNoteId).forEach(visit)
  return { schedule, total }
}

export { prefersReducedMotion } from '../ui/physics.js'
