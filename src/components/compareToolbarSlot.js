/**
 * compareToolbarSlot.js — where the version-compare toolbar is allowed to render.
 *
 * Same arrangement as canvasToolbarSlot: the compare pane's controls (which two
 * versions, swap, merge, apply) belong in the titlebar next to where the text and
 * canvas toolbars live, but their state belongs to VersionComparePane. The layout
 * publishes the titlebar slot through this context and the pane portals into it.
 *
 * The value is null whenever compare is not up. Compare outranks the other two
 * toolbars: while it holds the titlebar, the layout hands the canvas a null slot,
 * so only one toolbar can ever be mounted there.
 */
import { createContext } from 'react'

export const CompareToolbarSlotContext = createContext(null)
