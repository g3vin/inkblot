/**
 * Toast.jsx — a short line at the foot of the window saying something finished, with
 * at most one action (docs/DESIGN.md §9).
 *
 *   showToast({ message: 'Bug report saved', action: { label: 'Show in Finder', run } })
 *
 * `<Toaster />` is mounted once, in App, and shows the newest toast; a new one
 * replaces the one showing. It leaves after six seconds, but not while the pointer or
 * focus is on it, so its action can always be reached. It is a `status` region:
 * screen readers announce it without moving focus. It sits on `--z-toast`, above an
 * open dialog, since what it reports may have come from one.
 *
 * Not for errors that need a decision (a Dialog) or for anything the writer must read
 * to carry on.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import Button from './Button'
import IconButton from './IconButton'
import Icon from './Icon'
import { useExitAnimation } from './hooks'
import { currentToast, dismissToast, subscribeToasts } from './toastStore'
import './Toast.css'

const SHOW_MS = 6000

export default function Toaster() {
  const toast = useSyncExternalStore(subscribeToasts, currentToast, currentToast)
  if (!toast) return null
  return createPortal(<ToastCard key={toast.id} toast={toast} />, document.body)
}

function ToastCard({ toast }) {
  const ref = useRef(null)
  const [held, setHeld] = useState(false)
  useExitAnimation(ref)

  useEffect(() => {
    if (held) return undefined
    const timer = setTimeout(() => dismissToast(toast.id), SHOW_MS)
    return () => clearTimeout(timer)
  }, [held, toast.id])

  const hold = () => setHeld(true)
  const release = (event) => {
    if (event.type === 'blur' && ref.current?.contains(event.relatedTarget)) return
    setHeld(false)
  }

  return (
    <div
      ref={ref}
      className="ib-toast"
      role="status"
      aria-live="polite"
      onPointerEnter={hold}
      onPointerLeave={release}
      onFocus={hold}
      onBlur={release}
    >
      {toast.icon ? <Icon name={toast.icon} className="ib-toast-icon" /> : null}
      <span className="ib-toast-message">{toast.message}</span>
      {toast.action ? (
        <Button
          variant="tinted"
          onClick={() => {
            dismissToast(toast.id)
            toast.action.run()
          }}
        >
          {toast.action.label}
        </Button>
      ) : null}
      <IconButton icon="close" label="Dismiss" size="circle" onClick={() => dismissToast(toast.id)} />
    </div>
  )
}
