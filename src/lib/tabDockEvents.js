/**
 * tabDockEvents.js — how the file tree talks to the tab dock.
 *
 * The tree's drag is pointer-driven (not HTML5 DnD), so the dock can't be a
 * drop target on its own: only the tree knows a drag is in flight, and only it
 * sees the mouseup. It therefore hit-tests the dock on release and hands the
 * document over, exactly as it already does for a canvas (see canvasEvents).
 *
 * The start/end announcements are separate from the drop: the dock uses them to
 * open itself while a document is being dragged anywhere, so there is a target
 * to aim at before the pointer arrives.
 */

export const TAB_DOCK_DROP_DOC_EVENT = 'tabdock:drop-doc'
export const TREE_DRAG_START_EVENT = 'filetree:drag-start'
export const TREE_DRAG_END_EVENT = 'filetree:drag-end'

/** The `.tab-dock` under a point, or null. Used to hit-test a dropped document. */
export const tabDockAt = (clientX, clientY) =>
  document.elementFromPoint(clientX, clientY)?.closest('.tab-dock') || null

/** Drop a project document onto the dock, opening it as a tab. */
export function dispatchTabDockDropDoc(dock, { path }) {
  if (!dock || !path) return false
  dock.dispatchEvent(new CustomEvent(TAB_DOCK_DROP_DOC_EVENT, { detail: { path } }))
  return true
}

/** A document drag began in the file tree. */
export function announceTreeDragStart({ path, type }) {
  window.dispatchEvent(new CustomEvent(TREE_DRAG_START_EVENT, { detail: { path, type } }))
}

/** The drag ended — however it ended (dropped, cancelled, or nowhere). */
export function announceTreeDragEnd() {
  window.dispatchEvent(new CustomEvent(TREE_DRAG_END_EVENT))
}
