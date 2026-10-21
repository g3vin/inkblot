/**
 * Popover — small forms and pickers anchored to a control (docs/DESIGN.md §9 → Pop-ups).
 *
 *   <Popover open anchorRef={buttonRef} onClose={close} eyebrow="Cell fill">…</Popover>
 *
 * - Surface: `.ib-popover`, the one pop-up surface (Popover.css), on `--z-popover`. It
 *   owns the padding; don't add your own.
 * - Title: an `eyebrow` over a pop-up of more than one control. A one-line form or a
 *   strip of tools has none.
 * - Motion: it floats in over `--dur-base` and leaves the way it came.
 * - Focus: the first control inside takes it; Tab and ⇧Tab stay inside; Escape or a
 *   click outside closes it, and focus goes back to the control that opened it.
 * - Anchor: `anchorRef` (an element), or `anchorRect` (a rect, for a place in the text).
 *   Opened from inside a Dialog, it renders in the dialog's layer, above it.
 *   `onEscape` is for a pop-up whose Escape means something other than close (the
 *   footnote's "leave it as it was").
 */
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { focusableWithin, trapTab, useExitAnimation } from './hooks'
import { LayerContext } from './layer'
import { placePopover } from './placePopover.js'
import './Popover.css'

export default function Popover({ open, ...props }) {
  return open ? <OpenPopover {...props} /> : null
}

function OpenPopover({ anchorRef, anchorRect, onClose, onEscape, align = 'start', eyebrow, className = '', children, ...rest }) {
  const ref = useRef(null)
  const [position, setPosition] = useState(null)
  // Opened from inside a dialog, it goes in the dialog's layer, so it isn't under it.
  const layer = useContext(LayerContext) ?? document.body
  const handlers = useRef({ onClose, onEscape })
  useEffect(() => { handlers.current = { onClose, onEscape } })

  // Placed once, when it opens.
  useLayoutEffect(() => {
    const anchor = anchorRect ?? anchorRef?.current?.getBoundingClientRect()
    const node = ref.current
    if (!anchor || !node) return
    setPosition(placePopover(anchor, { width: node.offsetWidth, height: node.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, align))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [align])

  useEffect(() => {
    const node = ref.current
    const onKey = (event) => {
      if (event.key === 'Escape') {
        const { onEscape: escape, onClose: close } = handlers.current
        if (escape) escape()
        else close?.()
      } else if (node.contains(document.activeElement)) {
        trapTab(event, node)
      }
    }
    const onDown = (event) => {
      if (node.contains(event.target) || anchorRef?.current?.contains?.(event.target)) return
      handlers.current.onClose?.()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [anchorRef])

  // Focus the first control inside; on close, back to the opener (or where focus was).
  useEffect(() => {
    const node = ref.current
    const before = document.activeElement
    const anchor = anchorRef?.current
    const frame = window.requestAnimationFrame(() => {
      if (!node.contains(document.activeElement)) (focusableWithin(node)[0] ?? node).focus({ preventScroll: true })
    })
    return () => {
      window.cancelAnimationFrame(frame)
      // Focus already moved on (a click on another control): leave it there.
      const now = document.activeElement
      if (now && now !== document.body && !node.contains(now)) return
      const target = anchor instanceof HTMLElement && anchor.isConnected ? anchor : before
      target?.focus?.({ preventScroll: true })
    }
  }, [anchorRef])

  useExitAnimation(ref)

  return createPortal(
    <div
      ref={ref}
      tabIndex={-1}
      className={['ib-popover', className].filter(Boolean).join(' ')}
      style={position ? { left: position.left, top: position.top } : { left: -9999, top: -9999 }}
      {...rest}
    >
      {eyebrow ? <p className="ib-eyebrow ib-popover-eyebrow">{eyebrow}</p> : null}
      {children}
    </div>,
    layer,
  )
}
