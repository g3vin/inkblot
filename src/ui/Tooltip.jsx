/**
 * Tooltip.jsx — a short label on hover or keyboard focus, after a brief delay.
 *
 * Wraps exactly one focusable child. Plain language, no trailing period; add the
 * keyboard shortcut with `shortcut` ("⌘B"). Tooltips name things — they never hold
 * anything a user must read to succeed.
 */
import { cloneElement, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition } from './hooks'
import Kbd from './Kbd'
import './Tooltip.css'

const OPEN_DELAY_MS = 500

export default function Tooltip({ content, shortcut, placement = 'bottom', children }) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef(null)
  const tipRef = useRef(null)
  const timer = useRef(0)
  const id = useId()
  const style = useAnchoredPosition(open, tipRef, { anchorRef, placement, offset: 6 })

  useEffect(() => () => window.clearTimeout(timer.current), [])

  if (!content) return children

  const show = () => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpen(true), OPEN_DELAY_MS)
  }
  const hide = () => {
    window.clearTimeout(timer.current)
    setOpen(false)
  }

  const child = cloneElement(children, {
    ref: (node) => {
      anchorRef.current = node
      const { ref } = children.props
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    },
    'aria-describedby': open ? id : undefined,
    onPointerEnter: (e) => { children.props.onPointerEnter?.(e); show() },
    onPointerLeave: (e) => { children.props.onPointerLeave?.(e); hide() },
    onPointerDown: (e) => { children.props.onPointerDown?.(e); hide() },
    onFocus: (e) => { children.props.onFocus?.(e); if (e.target.matches(':focus-visible')) show() },
    onBlur: (e) => { children.props.onBlur?.(e); hide() },
  })

  return (
    <>
      {child}
      {open && createPortal(
        <div ref={tipRef} id={id} role="tooltip" className="ib-tooltip" style={style}>
          <span>{content}</span>
          {shortcut ? <Kbd>{shortcut}</Kbd> : null}
        </div>,
        document.body,
      )}
    </>
  )
}
