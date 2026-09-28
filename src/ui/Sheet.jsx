/**
 * Sheet — a centred, opaque modal over a scrim. Focus is kept inside it while it is
 * open and returned to where it was when it closes; Escape closes it, as does a click
 * on the scrim.
 */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import './ui.css'

// Anything that takes focus from Tab — so not a roving group's inactive members.
const FOCUSABLE = ['button:not([disabled])', '[href]', 'input:not([disabled])', 'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]']
  .map((selector) => `${selector}:not([tabindex="-1"])`).join(', ')

/**
 * `placement="top"` drops the sheet from under the titlebar and leaves the titlebar
 * uncovered and live, as Customize Toolbar… needs: its toolbar is what items are
 * dragged into and out of.
 */
export default function Sheet({ open = true, title, onClose, width = 520, footer, className = '', children, labelledBy, placement = 'center' }) {
  const sheetRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const previous = document.activeElement
    const sheet = sheetRef.current
    const first = sheet?.querySelector(FOCUSABLE)
    ;(first || sheet)?.focus()

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose?.()
        return
      }
      if (event.key !== 'Tab' || !sheet) return
      const items = [...sheet.querySelectorAll(FOCUSABLE)]
      if (!items.length) { event.preventDefault(); return }
      const at = items.indexOf(document.activeElement)
      if (event.shiftKey && at <= 0) { event.preventDefault(); items[items.length - 1].focus() }
      else if (!event.shiftKey && at === items.length - 1) { event.preventDefault(); items[0].focus() }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      if (previous && typeof previous.focus === 'function') previous.focus()
    }
  }, [open, onClose])

  if (!open) return null
  const titleId = labelledBy ?? (title ? 'ui-sheet-title' : undefined)

  return createPortal(
    <div className="ui-sheet-scrim scrim" data-placement={placement} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.() }}>
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`ui-sheet ${className}`.trim()}
        style={{ width }}
      >
        {title ? <header className="ui-sheet-header"><h2 id={titleId} className="ui-sheet-title">{title}</h2></header> : null}
        <div className="ui-sheet-body">{children}</div>
        {footer ? <footer className="ui-sheet-footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  )
}
