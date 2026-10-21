/**
 * storyCursor.js — the project's "now" and its time lens, shared by everything open.
 *
 *   day   the story day being looked at. A map scrubbing its journeys sets it, a
 *         timeline view draws it as a line and can drag it, and every map that follows
 *         the timeline (the default) jumps there.
 *   lens  a window of the axis — `{ from, to, scale }`, days or sequence positions —
 *         that the editor highlights: every passage whose event it touches. `on` shows
 *         it; `editing` lets its window be dragged and resized.
 *   editingRanges  every attached passage shows handles at its ends, to be dragged
 *
 * Neither is saved with a document: it is where the writer is looking, not what they
 * wrote. Each change says who made it (`source`), so the one that made it does not
 * react to its own echo.
 */

export const STORY_CURSOR_CHANGED_EVENT = 'story-cursor:changed'

const DEFAULT_LENS = { on: false, editing: false, from: 0, to: 7, scale: 'time' }

const cursors = new Map()
const listeners = new Map()

// Kept once made: React reads the cursor with useSyncExternalStore, which needs the
// same object back until something changes.
const cursorFor = (projectName) => {
  if (!cursors.has(projectName)) cursors.set(projectName, { day: null, lens: DEFAULT_LENS, editingRanges: false })
  return cursors.get(projectName)
}

export const getStoryCursor = (projectName) => cursorFor(projectName)

export function subscribeStoryCursor(projectName, listener) {
  let set = listeners.get(projectName)
  if (!set) {
    set = new Set()
    listeners.set(projectName, set)
  }
  set.add(listener)
  return () => set.delete(listener)
}

function update(projectName, patch, source) {
  if (!projectName) return
  const next = { ...cursorFor(projectName), ...patch }
  cursors.set(projectName, next)
  for (const listener of [...(listeners.get(projectName) || [])]) listener(next, source)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(STORY_CURSOR_CHANGED_EVENT, { detail: { projectName, cursor: next, source } }))
  }
}

export function setStoryDay(projectName, day, source = null) {
  if (!Number.isFinite(day) || cursorFor(projectName).day === day) return
  update(projectName, { day }, source)
}

/** A patch of the lens; `from`/`to` are put in order. */
export function setTimeLens(projectName, patch, source = null) {
  const lens = { ...cursorFor(projectName).lens, ...patch }
  if (Number.isFinite(lens.from) && Number.isFinite(lens.to) && lens.from > lens.to) [lens.from, lens.to] = [lens.to, lens.from]
  lens.scale = lens.scale === 'sequence' ? 'sequence' : 'time'
  update(projectName, { lens }, source)
}

export function setRangeEditing(projectName, editingRanges, source = null) {
  update(projectName, { editingRanges: Boolean(editingRanges) }, source)
}
