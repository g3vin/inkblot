/**
 * timelineEvents.js — how the rest of the app talks to a mounted timeline view.
 *
 * The map's arrangement (mapEvents.js): a native shell cannot hit-test the web view,
 * so it names a view by surface id, and commands go to that element as CustomEvents.
 * A reveal (select an event, scroll to it) goes through window, since its view may
 * not be mounted yet.
 */
export const TIMELINE_COMMAND_EVENT = 'timeline:command'
export const TIMELINE_REVEAL_EVENT = 'timeline:reveal-event'

const surfacesById = new Map()
let nextSurfaceId = 0

export function registerTimelineSurface(element) {
  if (!element) return () => {}
  const id = `timeline-surface-${nextSurfaceId++}`
  element.dataset.surfaceId = id
  surfacesById.set(id, element)
  return () => {
    if (surfacesById.get(id) === element) surfacesById.delete(id)
  }
}

export const timelineSurfaceById = (surfaceId) => (surfaceId ? surfacesById.get(surfaceId) || null : null)

export function dispatchTimelineCommand(surface, command, detail = {}) {
  if (!surface) return false
  surface.dispatchEvent(new CustomEvent(TIMELINE_COMMAND_EVENT, { detail: { command, ...detail } }))
  return true
}

let pendingReveal = null

/** Show an event in a timeline view: the one open, or the next to open. */
export function requestTimelineReveal(eventId, docPath = null) {
  if (!eventId) return
  pendingReveal = { eventId, docPath }
  window.dispatchEvent(new CustomEvent(TIMELINE_REVEAL_EVENT, { detail: { eventId, docPath } }))
}

export function takePendingTimelineReveal(docPath) {
  if (!pendingReveal || (pendingReveal.docPath && pendingReveal.docPath !== docPath)) return null
  const { eventId } = pendingReveal
  pendingReveal = null
  return eventId
}
