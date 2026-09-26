/**
 * mapEvents.js — how the rest of the app talks to a mounted map.
 *
 * The same arrangement as canvasEvents.js, for the same reasons: the file tree
 * (drop a doc to pin it), the search panel (reveal an item), the history panel
 * (restore a version) and the native menus have no React path to a map, so they use
 * CustomEvents. Commands and drops go to the surface element, because split view can
 * show two maps; reveal and restore go through window, because their map may not be
 * mounted yet or the sender has no element to aim at.
 */

export const MAP_COMMAND_EVENT = 'map:command'
export const MAP_DROP_DOC_EVENT = 'map:drop-doc'
export const MAP_REVEAL_EVENT = 'map:reveal-item'
export const MAP_RESTORE_EVENT = 'map:restore-version'

/** The `.map-surface` under a point, or null. Used to hit-test drops. */
export const mapSurfaceAt = (clientX, clientY) =>
  document.elementFromPoint(clientX, clientY)?.closest('.map-surface') || null

/* Surface ids — see canvasEvents.js: a native shell cannot hit-test the web view,
   so it names a map by id and this turns the id back into the element. */

const surfacesById = new Map()
let nextSurfaceId = 0

/** Claim an id for a mounted surface. Returns a function that releases it. */
export function registerMapSurface(element) {
  if (!element) return () => {}
  const id = `map-surface-${nextSurfaceId++}`
  element.dataset.surfaceId = id
  surfacesById.set(id, element)
  return () => {
    // StrictMode runs setup twice; only release the entry if it is still ours.
    if (surfacesById.get(id) === element) surfacesById.delete(id)
  }
}

/** The mounted surface with this id, or null. */
export const mapSurfaceById = (surfaceId) => (surfaceId ? surfacesById.get(surfaceId) || null : null)

/** Run a map command (see MapSurface's handler for the vocabulary). */
export function dispatchMapCommand(surface, command, detail = {}) {
  if (!surface) return false
  surface.dispatchEvent(new CustomEvent(MAP_COMMAND_EVENT, { detail: { command, ...detail } }))
  return true
}

/** Drop a project doc onto a map: a pin, or a traveler if it is a character. */
export function dispatchMapDropDoc(surface, { path, clientX, clientY }) {
  if (!surface) return false
  surface.dispatchEvent(new CustomEvent(MAP_DROP_DOC_EVENT, { detail: { path, clientX, clientY } }))
  return true
}

/** Restore a map to a version-history state (`map` is the entry's serialized map). */
export function dispatchMapRestore(docPath, map) {
  if (!docPath || !map) return
  window.dispatchEvent(new CustomEvent(MAP_RESTORE_EVENT, { detail: { docPath, map } }))
}

/**
 * Reveal an item on a map that may not be open yet. As with canvases, the pending
 * slot is claimed by the map that mounts next, or the event by one already open —
 * exactly one of the two, because taking the request clears the slot.
 */
let pendingReveal = null

export function requestMapReveal(docPath, itemId) {
  if (!docPath || !itemId) return
  pendingReveal = { docPath, itemId }
  window.dispatchEvent(new CustomEvent(MAP_REVEAL_EVENT, { detail: { docPath, itemId } }))
}

export function takePendingMapReveal(docPath) {
  if (pendingReveal?.docPath !== docPath) return null
  const { itemId } = pendingReveal
  pendingReveal = null
  return itemId
}
