/**
 * recentSelectionDrag.ts — the selection drag that just left the page.
 *
 * Dropping an editor selection on the clipboard panel is a *move*: the text leaves the
 * document. With the panel in the page, the drop and the drag's end are two events in
 * one event loop, a tick apart. With the panel in Swift, the drop arrives as a bridge
 * command some time after the page's `dragend` has already let the selection go — so
 * the page would add the text to the clipboard and leave it in the document too.
 *
 * So when a selection drag ends *outside the page*, it is remembered here for a
 * moment, and a `clipboardDrop` of the same text within that moment claims it. Once,
 * and only for the same text: a later drop of something else is an ordinary add.
 */
export interface EndedSelectionDrag {
  text: string
  from: number
  to: number
  source?: string
  docName?: string
}

const GRACE_MS = 2000

let recent: { drag: EndedSelectionDrag; at: number } | null = null

export function rememberEndedSelectionDrag(drag: EndedSelectionDrag, now = Date.now()): void {
  recent = { drag, at: now }
}

/** The drag that ended with `text`, if it was recent enough — consumed on read. */
export function claimEndedSelectionDrag(text: string, now = Date.now()): EndedSelectionDrag | null {
  const held = recent
  recent = null
  if (!held || now - held.at > GRACE_MS) return null
  return held.drag.text.trim() === text.trim() ? held.drag : null
}
