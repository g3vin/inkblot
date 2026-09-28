/**
 * Dialog.jsx — a modal: Dialog (centred) and Sheet (slides from the right edge).
 *
 *   <Dialog open onClose={close} eyebrow="Appearance" title="Accent colour"
 *     description="Tints selections, focus rings and primary buttons."
 *     footer={<Button variant="primary" onClick={close}>Done</Button>}>
 *     …
 *   </Dialog>
 *
 * Focus is trapped inside and returned on close; Escape and the scrim close it; the
 * rest of the app is inert. Keep dialogs for decisions and small settings — anything a
 * writer keeps open while working belongs in a floating Panel instead.
 */
import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from './hooks'
import IconButton from './IconButton'
import './Dialog.css'

function Modal({ open, onClose, variant, eyebrow, title, description, footer, width, className, initialFocusRef, children }) {
  const ref = useRef(null)
  const titleId = useId()
  const descId = useId()
  useFocusTrap(open, ref, initialFocusRef)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose?.()
      }
    }
    document.addEventListener('keydown', onKey)
    const root = document.getElementById('root')
    root?.setAttribute('inert', '')
    return () => {
      document.removeEventListener('keydown', onKey)
      root?.removeAttribute('inert')
    }
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className={`ib-dialog-scrim ib-dialog-scrim--${variant}`} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={['ib-dialog', `ib-dialog--${variant}`, className].filter(Boolean).join(' ')}
        style={width ? { width } : undefined}
      >
        {(title || eyebrow) && (
          <header className="ib-dialog-header">
            <div className="ib-dialog-heading">
              {eyebrow ? <p className="ib-eyebrow">{eyebrow}</p> : null}
              {title ? <h2 id={titleId} className="ib-title">{title}</h2> : null}
              {description ? <p id={descId} className="ib-dialog-description">{description}</p> : null}
            </div>
            <IconButton icon="close" label="Close" size="sm" onClick={onClose} />
          </header>
        )}
        <div className="ib-dialog-body">{children}</div>
        {footer ? <footer className="ib-dialog-footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  )
}

export default function Dialog(props) {
  return <Modal {...props} variant="center" />
}

export function Sheet(props) {
  return <Modal {...props} variant="sheet" />
}
