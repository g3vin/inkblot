/**
 * splitDropTarget.js — where a document dragged from the file tree can open a split.
 *
 * The tree drags its entries with the pointer (useFileTreeDrag); the panes belong to
 * EditorCanvas, which registers them here (useSplitDrop). As the pointer moves, the
 * tree asks whether it is over a side of the page; held still there, the split opens
 * for real, and moving on puts the panes back, as a clipboard piece settles into the
 * page and lifts out again (useClipboardPieceDrag).
 *
 * The target answers:
 *   hover(x, y, docPath)   → true over a side; outlines the pane the document would take
 *   spring(x, y, docPath)  → true if the split opened there, the drag still going
 *   unspring()             → puts the panes back as they were before `spring`
 *   drop(x, y, docPath)    → true if the document went into a side (a sprung split stays)
 *   clear()                → takes the outline away
 */
let target = null

export function setSplitDropTarget(next) {
  target = next
  return () => { if (target === next) target = null }
}

export const splitDropTarget = () => target

// How long the pointer rests before the split opens, and how far it may wander after,
// as a clipboard piece settles into the page (useClipboardPieceDrag).
export const SPLIT_DWELL_MS = 650
export const SPLIT_DWELL_TOLERANCE = 4
