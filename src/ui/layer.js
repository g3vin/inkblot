/**
 * The element a pop-up portals into. A Dialog provides its own layer, so a Popover or
 * Menu opened inside it sits above it, not under it (docs/DESIGN.md §9 → Pop-ups).
 */
import { createContext } from 'react'

export const LayerContext = createContext(null)
