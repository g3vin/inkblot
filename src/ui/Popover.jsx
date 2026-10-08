/**
 * Popover — a flat, opaque surface anchored under (or over) an element, portaled to
 * the body so no clipping ancestor cuts it. Closes on Escape and on a click outside.
 */
import { useLayoutEffect, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { placePopover } from './placePopover.js'
import './ui.css'

export default function Popover({ anchorRef, open, onClose, align = 'start', className = '', children, ...rest }) {
  const ref = useRef(null)
  const [position, setPosition] = useState(null)

  useLayoutEffect(() => {
    if (!open) { setPosition(null); return }
    const anchor = anchorRef?.current?.getBoundingClientRect()
    const node = ref.current
    if (!anchor || !node) return
    setPosition(placePopover(anchor, { width: node.offsetWidth, height: node.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, align))
  }, [open, anchorRef, align])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => { if (event.key === 'Escape') onClose?.() }
    const onDown = (event) => {
      if (ref.current?.contains(event.target) || anchorRef?.current?.contains(event.target)) return
      onClose?.()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [open, onClose, anchorRef])

  if (!open) return null
  return createPortal(
    <div
      ref={ref}
      className={`ui-popover ${className}`.trim()}
      style={position ? { left: position.left, top: position.top } : { left: -9999, top: -9999 }}
      {...rest}
    >
      {children}
    </div>,
    document.body,
  )
}
