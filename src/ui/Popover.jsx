/**
 * Popover.jsx — a floating surface anchored to a control (or a point).
 *
 * Wears the one pop-up surface (--menu-* tokens). Closes on Escape and outside
 * clicks, and returns focus to the anchor. Use Menu for lists of actions; use Popover
 * for small forms and pickers.
 */
import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismiss } from './hooks'
import './Popover.css'

export default function Popover({
  open,
  onClose,
  anchorRef,
  point,
  placement = 'bottom-start',
  offset,
  className,
  label,
  role = 'dialog',
  children,
  ...rest
}) {
  const ref = useRef(null)
  const style = useAnchoredPosition(open, ref, { anchorRef, point, placement, offset })
  useDismiss(open, onClose, anchorRef ? [ref, anchorRef] : [ref])

  if (!open) return null
  return createPortal(
    <div
      ref={ref}
      role={role}
      aria-label={label}
      className={['ib-popover', className].filter(Boolean).join(' ')}
      style={style}
      {...rest}
    >
      {children}
    </div>,
    document.body,
  )
}
