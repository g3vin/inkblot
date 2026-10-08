/**
 * canvasEvents.js — how the rest of the app talks to a mounted canvas.
 *
 * The canvas is reached from three places that have no React path to it: the file
 * tree (drop a document), the search panel (reveal a node), and the native context
 * menu (run a command). All three use CustomEvents, matching the repo's existing
 * `filetree:*` / `open-note` convention.
 *
 * Commands and drops are dispatched ON THE SURFACE ELEMENT, not on window: split
 * view can show two canvases at once, and the element is what says which one the
 * user actually aimed at. Only reveal goes through window, because the canvas it
 * targets may not be mounted yet.
 */

export const CANVAS_COMMAND_EVENT = 'canvas:command'
export const CANVAS_DROP_DOC_EVENT = 'canvas:drop-doc'
export const CANVAS_DROP_NOTE_EVENT = 'canvas:drop-note'
export const CANVAS_DROP_TIMELINE_EVENT = 'canvas:drop-timeline-event'
export const CANVAS_REVEAL_EVENT = 'canvas:reveal-node'
export const CANVAS_RESTORE_EVENT = 'canvas:restore-version'

/** The `.canvas-surface` under a point, or null. Used to hit-test drops and menus. */
export const canvasSurfaceAt = (clientX, clientY) =>
  document.elementFromPoint(clientX, clientY)?.closest('.canvas-surface') || null

/* ------------------------------------------------------------------
   Surface ids.

   Hit-testing the DOM is how the app aims a command at one of two open
   canvases, and it works because the app and the DOM are the same process.
   A native shell has neither — it cannot call `elementFromPoint` inside a
   web view — so the bridge protocol addresses a canvas by id instead
   (`CanvasCommandRequest.surface_id`), and this is where an id is turned
   back into the element the existing CustomEvents are dispatched on.

   The id lives on the element as a data attribute as well as in the map, so
   anything already holding an element — a card editor looking for the canvas
   it is inside — can name it without a second lookup.
------------------------------------------------------------------ */

const surfacesById = new Map()
let nextSurfaceId = 0

/** Claim an id for a mounted surface. Returns a function that releases it. */
export function registerCanvasSurface(element) {
  if (!element) return () => {}
  const id = `canvas-surface-${nextSurfaceId++}`
  element.dataset.surfaceId = id
  surfacesById.set(id, element)
  return () => {
    // Only release the entry if it is still ours: StrictMode runs setup twice, and a
    // cleanup that deletes unconditionally would unregister the live surface.
    if (surfacesById.get(id) === element) surfacesById.delete(id)
  }
}

/** The surface element with this id, or null. */
export const canvasSurfaceById = (surfaceId) =>
  (surfaceId ? surfacesById.get(surfaceId) || null : null)

/** The id of the surface containing `element`, or null. */
export const canvasSurfaceIdOf = (element) =>
  element?.closest?.('.canvas-surface')?.dataset?.surfaceId || null

/** Run a canvas command (see CanvasSurface's handler for the vocabulary). */
export function dispatchCanvasCommand(surface, command, detail = {}) {
  if (!surface) return false
  surface.dispatchEvent(
    new CustomEvent(CANVAS_COMMAND_EVENT, { detail: { command, ...detail } })
  )
  return true
}

/** Drop a project document onto a canvas as a file card. */
export function dispatchCanvasDropDoc(surface, { path, clientX, clientY }) {
  if (!surface) return false
  surface.dispatchEvent(
    new CustomEvent(CANVAS_DROP_DOC_EVENT, { detail: { path, clientX, clientY } })
  )
  return true
}

/**
 * Drop a note onto a canvas. `docPath` is the document that OWNS the note — the card
 * references it there rather than copying it, which is what keeps the two in sync.
 */
export function dispatchCanvasDropNote(surface, { docPath, noteId, clientX, clientY }) {
  if (!surface) return false
  surface.dispatchEvent(
    new CustomEvent(CANVAS_DROP_NOTE_EVENT, { detail: { docPath, noteId, clientX, clientY } })
  )
  return true
}

/** Drop a timeline event onto a canvas, as a card that shows it live. */
export function dispatchCanvasDropTimelineEvent(surface, { eventId, clientX, clientY }) {
  if (!surface || !eventId) return false
  surface.dispatchEvent(new CustomEvent(CANVAS_DROP_TIMELINE_EVENT, { detail: { eventId, clientX, clientY } }))
  return true
}

/**
 * A note dragged as a URL, `inkblot-note://note?doc=…&id=…`, which WebKit hands over as
 * `text/uri-list` on an ordinary drop. Null for anything else.
 */
export function noteDragURL(uriList) {
  for (const line of String(uriList || '').split(/\r?\n/)) {
    if (!line.startsWith('inkblot-note:')) continue
    try {
      const url = new URL(line.trim())
      const docPath = url.searchParams.get('doc')
      const noteId = url.searchParams.get('id')
      if (docPath && noteId) return { docPath, noteId }
    } catch {
      // Not a URL after all; keep looking.
    }
  }
  return null
}

/**
 * Restore a canvas to a version-history state. Window-level like reveal — the
 * history panel has no reference to the surface element — and carrying the doc
 * path so only the targeted canvas replaces itself. `canvas` is the serialized
 * (on-disk-shaped) canvas from the version entry.
 */
export function dispatchCanvasRestore(docPath, canvas) {
  if (!docPath || !canvas) return
  window.dispatchEvent(new CustomEvent(CANVAS_RESTORE_EVENT, { detail: { docPath, canvas } }))
}

/**
 * Reveal a node in a canvas that may not be open yet.
 *
 * The pending slot is what makes a cross-document search result work: the panel
 * asks for the reveal, the layout switches documents, and the canvas that mounts a
 * moment later claims the request on mount. A canvas that is ALREADY open never
 * remounts, so it takes the same request from the event instead. Exactly one of the
 * two paths consumes it — takePendingCanvasReveal clears the slot.
 */
let pendingReveal = null

export function requestCanvasReveal(docPath, nodeId) {
  if (!docPath || !nodeId) return
  pendingReveal = { docPath, nodeId }
  window.dispatchEvent(new CustomEvent(CANVAS_REVEAL_EVENT, { detail: { docPath, nodeId } }))
}

export function takePendingCanvasReveal(docPath) {
  if (pendingReveal?.docPath !== docPath) return null
  const { nodeId } = pendingReveal
  pendingReveal = null
  return nodeId
}
