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
 * - Opened from a button in a toolbar that takes it (`ToolbarDockContext`, the card's
 *   toolbar), it opens *in* the toolbar (§6 → the dynamic toolbar): a form (a field to
 *   fill in) takes the whole toolbar, with a close button, as find does; a choice
 *   opens in place beside its button, and takes the toolbar if it doesn't fit there.
 *   The button stays pressed (`data-opener`) while it's open.
 */
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { focusableWithin, trapTab, useExitAnimation } from './hooks'
import IconButton from './IconButton.jsx'
import { LayerContext, ToolbarDockContext } from './layer'
import { placePopover } from './placePopover.js'
import './Popover.css'

/** What makes a pop-up a form, which needs the whole toolbar. */
const FORM = 'input:not([type="color"]), select, textarea'

const placeBy = (anchor, node, align) =>
  placePopover(anchor, { width: node.offsetWidth, height: node.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, align)

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

  // Opened from a toolbar's row, it opens in the toolbar: decided from what it holds,
  // once it has rendered, and before it paints.
  const toolbar = useContext(ToolbarDockContext)
  const [dock, setDock] = useState(null)
  useLayoutEffect(() => {
    const anchor = anchorRef?.current
    if (!toolbar || !anchor || !toolbar.owns(anchor)) return
    const slot = ref.current?.querySelector(FORM) ? null : toolbar.inlineFor(anchor)
    setDock(slot ? { mode: 'inline', target: slot } : { mode: 'whole', target: toolbar.whole })
  }, [toolbar, anchorRef])
  // In place but pushed behind » for want of room: it takes the toolbar instead.
  useEffect(() => {
    if (dock?.mode !== 'inline') return undefined
    return toolbar.watch(anchorRef.current, () => setDock({ mode: 'whole', target: toolbar.whole }))
  }, [dock, toolbar, anchorRef])
  useEffect(() => {
    const opener = dock ? anchorRef?.current : null
    opener?.setAttribute('data-opener', '')
    return () => opener?.removeAttribute('data-opener')
  }, [dock, anchorRef])

  useLayoutEffect(() => {
    const node = ref.current
    const anchor = anchorRect ?? anchorRef?.current?.getBoundingClientRect()
    if (dock || !anchor || !node) return
    setPosition(placeBy(anchor, node, align))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [align, dock])

  useEffect(() => {
    // Read when each event comes: the element is replaced when it docks.
    const onKey = (event) => {
      const node = ref.current
      if (event.key === 'Escape') {
        const { onEscape: escape, onClose: close } = handlers.current
        if (escape) escape()
        else close?.()
      } else if (node?.contains(document.activeElement)) {
        trapTab(event, node)
      }
    }
    const onDown = (event) => {
      const node = ref.current
      if (node?.contains(event.target) || anchorRef?.current?.contains?.(event.target)) return
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
    const before = document.activeElement
    const anchor = anchorRef?.current
    // The element as of the frame after opening: it is replaced when it docks.
    let node = ref.current
    const frame = window.requestAnimationFrame(() => {
      node = ref.current ?? node
      if (node && !node.contains(document.activeElement)) (focusableWithin(node)[0] ?? node).focus({ preventScroll: true })
    })
    return () => {
      window.cancelAnimationFrame(frame)
      // Focus already moved on (a click on another control): leave it there.
      const now = document.activeElement
      if (now && now !== document.body && !node?.contains(now)) return
      const target = anchor instanceof HTMLElement && anchor.isConnected ? anchor : before
      target?.focus?.({ preventScroll: true })
    }
  }, [anchorRef])

  useExitAnimation(ref)

  if (dock) {
    return createPortal(
      <div
        ref={ref}
        tabIndex={-1}
        className={['ib-dock', className].filter(Boolean).join(' ')}
        data-mode={dock.mode}
        role="group"
        aria-label={eyebrow || undefined}
        {...rest}
      >
        {eyebrow ? <span className="ib-eyebrow ib-dock-eyebrow">{eyebrow}</span> : null}
        <div className="ib-dock-body">{children}</div>
        {dock.mode === 'whole'
          ? <IconButton icon="close" label="Close" title="Close (Esc)" size="capsule" onClick={() => handlers.current.onClose?.()} />
          : null}
      </div>,
      dock.target,
    )
  }
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
