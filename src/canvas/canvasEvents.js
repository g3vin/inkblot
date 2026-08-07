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
export const CANVAS_REVEAL_EVENT = 'canvas:reveal-node'
export const CANVAS_RESTORE_EVENT = 'canvas:restore-version'

/** The `.canvas-surface` under a point, or null. Used to hit-test drops and menus. */
export const canvasSurfaceAt = (clientX, clientY) =>
  document.elementFromPoint(clientX, clientY)?.closest('.canvas-surface') || null

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
