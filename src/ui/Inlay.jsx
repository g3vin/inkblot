/**
 * Inlay.jsx — a panel's own controls (filter, search, add) engraved into the panel
 * instead of floated on it (docs/DESIGN.md → Layout → Inlay). The panel is one sheet
 * of paper, and each Inlay is a piece left standing inside a channel cut around it, a
 * kerf wide, as an engraver cuts a plate. Light falls from above: the channel's floor
 * is a step darker, its top wall in shade, its bottom lip catching the light, and the
 * piece casts a little shadow onto the floor. When a piece takes focus, ink runs into
 * its channel (intaglio: the ink sits in the cut).
 *
 *   Inlay        the piece, with its channel around it
 *   InlaySlot    one long channel around a row of pieces (the + and the filter), each
 *                still its own piece, a kerf apart
 *
 * It is all CSS (Surfaces.css → Inlay): each piece paints its channel and its own paper
 * behind its contents, so it needs nothing from the panel it sits in.
 */
import { forwardRef } from 'react'
import './Surfaces.css'

const classes = (...names) => names.filter(Boolean).join(' ')

/**
 * A control engraved into the panel, a pill. `round` for a single round button: the
 * piece is the button's size, and settles onto the floor when pressed.
 */
export const Inlay = forwardRef(function Inlay({ round = false, className, children, ...rest }, ref) {
  return (
    <div ref={ref} className={classes('ib-inlay', round && 'ib-inlay--round', className)} {...rest}>
      {children}
    </div>
  )
})

/**
 * One channel for several pieces: lay Inlays out inside it (it is a flex row). The
 * pieces stay separate, a kerf apart, and cut no channels of their own; the one with
 * focus gets an inked channel of its own, inside the long one.
 */
export const InlaySlot = forwardRef(function InlaySlot({ className, children, ...rest }, ref) {
  return (
    <div ref={ref} className={classes('ib-inlay-slot', className)} {...rest}>
      {children}
    </div>
  )
})
