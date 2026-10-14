/**
 * Inlay.jsx — a panel's own controls (filter, search, add) set bare on the panel's
 * paper (docs/DESIGN.md → Layout → Inlay): glyphs and text with no fill, border or
 * channel. A field shows focus by inking its glyphs.
 *
 *   Inlay        one piece (a field, or `round` for a single round button)
 *   InlaySlot    a row of pieces (the + and the filter), a kerf apart
 *
 * It is all CSS (Surfaces.css → Inlay).
 */
import { forwardRef } from 'react'
import './Surfaces.css'

const classes = (...names) => names.filter(Boolean).join(' ')

/**
 * A panel's own control, bare on its paper. `round` for a single round button.
 */
export const Inlay = forwardRef(function Inlay({ round = false, className, children, ...rest }, ref) {
  return (
    <div ref={ref} className={classes('ib-inlay', round && 'ib-inlay--round', className)} {...rest}>
      {children}
    </div>
  )
})

/**
 * A row of pieces: lay Inlays out inside it (it is a flex row), a kerf apart.
 */
export const InlaySlot = forwardRef(function InlaySlot({ className, children, ...rest }, ref) {
  return (
    <div ref={ref} className={classes('ib-inlay-slot', className)} {...rest}>
      {children}
    </div>
  )
})
