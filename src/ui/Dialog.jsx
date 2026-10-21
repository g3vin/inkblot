/**
 * Dialog.jsx — the one modal (docs/DESIGN.md §9): anything that takes over the window
 * until it is dismissed, from a decision to Settings.
 *
 *   <Dialog open onClose={close} eyebrow="Book" title="Rename" size="small"
 *     footer={<><Button onClick={close}>Cancel</Button><Button variant="filled">Rename</Button></>}>
 *     …
 *   </Dialog>
 *
 * - Header: an eyebrow saying where it came from, the title, a description if it needs
 *   one.
 * - Close: one visible way out. The footer's Cancel or Done is it; a dialog with no
 *   footer, or whose footer doesn't close it (`footerCloses={false}`), shows a ×.
 *   Escape and a click on the scrim always close it.
 * - Footer: the actions at the trailing edge, the primary last. A leading utility (a
 *   unit, a reset) goes before a `<span className="ib-dialog-footer-spacer" />`. In a
 *   small dialog, a footer of exactly two buttons shares the width between them.
 * - Size: `small` (400), `medium` (560) or `large` (720).
 * - Motion: it fades in on `--z-dialog` (medium and large over `--dur-slow`) and leaves
 *   the way it came.
 * - Focus: the first control inside, never the ×; Tab stays in; the app behind is inert;
 *   focus goes back where it was. `placement="top"` drops it from under the titlebar and
 *   leaves the toolbar live (Customize toolbar drags into it).
 *
 * - Pop-ups: a Popover or Menu opened inside renders in the dialog's layer, above it,
 *   and Escape closes it before the dialog.
 *
 * Settings and Help are NavSheet, built on this.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FOCUSABLE_SELECTOR, focusableWithin, useExitAnimation, useFocusTrap } from './hooks'
import IconButton from './IconButton'
import { LayerContext } from './layer'
import './Dialog.css'

export default function Dialog({
  open = true, onClose, eyebrow, title, description, footer, footerCloses = true,
  size = 'medium', placement = 'center', className, initialFocusRef, children,
}) {
  if (!open) return null
  return (
    <DialogOpen
      {...{ onClose, eyebrow, title, description, footer, footerCloses, size, placement, className, initialFocusRef }}
    >
      {children}
    </DialogOpen>
  )
}

function DialogOpen({ onClose, eyebrow, title, description, footer, footerCloses, size, placement, className, initialFocusRef, children }) {
  const scrimRef = useRef(null)
  // Pop-ups opened inside portal into the scrim, above the dialog (layer.js).
  const [layer, setLayer] = useState(null)
  const scrim = useCallback((node) => { scrimRef.current = node; setLayer(node) }, [])
  const ref = useRef(null)
  const firstRef = useRef(null)
  const titleId = useId()
  const descId = useId()
  const top = placement === 'top'

  // The first control inside, never the × (unless it's the only one).
  useLayoutEffect(() => {
    const panel = ref.current
    const notClose = (el) => !el.closest('.ib-dialog-close')
    // focusableWithin skips what isn't laid out; without layout (tests), any focusable.
    const laidOut = focusableWithin(panel)
    const candidates = laidOut.length ? laidOut : [...(panel?.querySelectorAll(FOCUSABLE_SELECTOR) ?? [])]
    firstRef.current = initialFocusRef?.current
      ?? candidates.find(notClose)
      ?? panel?.querySelector('.ib-dialog-close')
      ?? panel
  }, [initialFocusRef])
  useFocusTrap(true, ref, firstRef)
  useExitAnimation(scrimRef)

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      // A pop-up opened in the dialog closes first.
      if (event.target instanceof Element && event.target.closest('.ib-popover, .ib-menu')) return
      event.stopPropagation()
      onClose?.()
    }
    window.addEventListener('keydown', onKey, true)
    if (top) return () => window.removeEventListener('keydown', onKey, true)
    const root = document.getElementById('root')
    root?.setAttribute('inert', '')
    return () => {
      window.removeEventListener('keydown', onKey, true)
      root?.removeAttribute('inert')
    }
  }, [onClose, top])

  const close = !footer || !footerCloses
    ? <IconButton className="ib-dialog-close" icon="close" label="Close" size="circle" onClick={onClose} />
    : null

  return createPortal(
    <div
      ref={scrim}
      className="ib-dialog-scrim"
      data-placement={placement}
      onPointerDown={(event) => { if (event.target === event.currentTarget) onClose?.() }}
    >
      <LayerContext.Provider value={layer}>
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-describedby={description ? descId : undefined}
          tabIndex={-1}
          className={['ib-dialog', `ib-dialog--${size}`, className].filter(Boolean).join(' ')}
        >
          {(title || eyebrow || close) && (
            <header className="ib-dialog-header">
              <div className="ib-dialog-heading">
                {eyebrow ? <p className="ib-eyebrow">{eyebrow}</p> : null}
                {title ? <h2 id={titleId} className="ib-title">{title}</h2> : null}
                {description ? <p id={descId} className="ib-dialog-description">{description}</p> : null}
              </div>
              {close}
            </header>
          )}
          <div className="ib-dialog-body">{children}</div>
          {footer ? (
            <footer className="ib-dialog-footer">{footer}</footer>
          ) : null}
        </div>
      </LayerContext.Provider>
    </div>,
    document.body,
  )
}
