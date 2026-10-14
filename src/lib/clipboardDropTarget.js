/**
 * clipboardDropTarget.js — where a clipboard piece being dragged can land.
 *
 * The clipboard panel drags its pieces with the pointer, not with the browser's
 * drag and drop, so that the text itself can travel with the cursor and settle into
 * the page as a preview. The panel owns the gesture; the editor panes own the page.
 * EditorCanvas registers the panes here, and the panel asks them, as the pointer
 * moves, whether it is over the page and where the text would go.
 *
 * The target answers:
 *   hover(x, y)          → true over a pane; shows the drop caret there
 *   preview(x, y, text)  → the preview's first-line rect, once the text is set in place
 *   clear()              → takes the caret and the preview away
 *   drop(x, y, entry)    → true if the text went into a pane
 */
let target = null

export function setClipboardDropTarget(next) {
  target = next
  return () => { if (target === next) target = null }
}

export const clipboardDropTarget = () => target
