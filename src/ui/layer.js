/**
 * Where a pop-up renders.
 *
 * - `LayerContext`: the element a pop-up portals into. A Dialog provides its own layer,
 *   so a Popover or Menu opened inside it sits above it, not under it
 *   (docs/DESIGN.md §9 → Pop-ups).
 * - `ToolbarDockContext`: a toolbar that a Popover opened from its row opens into
 *   (§6 → the dynamic toolbar). Its value:
 *     owns(anchor)          the anchor is a button in this toolbar's row
 *     whole                 the element a pop-up taking the whole toolbar renders into
 *     inlineFor(anchor)     the element beside the anchor's item, for one in place
 *     watch(anchor, onOut)  calls onOut when the anchor's item no longer fits the row;
 *                           returns a function that stops watching
 */
import { createContext } from 'react'

export const LayerContext = createContext(null)

export const ToolbarDockContext = createContext(null)
