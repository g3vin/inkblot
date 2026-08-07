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

export const CanvasToolbarSlotContext = createContext(null)
