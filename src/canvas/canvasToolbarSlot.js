/**
 * canvasToolbarSlot.js — where the canvas toolbar is allowed to render.
 *
 * The canvas toolbar lives in the titlebar, sharing the one slot with the text
 * Toolbar, but its state (zoom, undo stack, selection, recorder) belongs to
 * CanvasSurface and cannot sensibly be lifted out of it. So the layout publishes
 * the titlebar's slot element through this context and the active CanvasSurface
 * portals its toolbar into it.
 *
 * The value is `null` whenever the slot is not available — no canvas is active,
 * or a card is being edited and the text Toolbar has the titlebar instead. A
 * null slot is how CanvasSurface knows not to render a toolbar at all, so the
 * two toolbars can never both be up.
 */
import { createContext } from 'react'

/**
 * The slot's value under a shell that draws the canvas toolbar itself (the Swift
 * shell's window toolbar): the canvas publishes its toolbar state over the bridge
 * instead of portaling buttons anywhere. Same rule as an element — present only while
 * the canvas toolbar should be up.
 */
export const NATIVE_CANVAS_TOOLBAR = 'native'

export const CanvasToolbarSlotContext = createContext(null)
