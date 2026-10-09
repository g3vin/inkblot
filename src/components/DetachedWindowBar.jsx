/**
 * DetachedWindowBar — a detached window's own controls (useWindowPop): keep it on top
 * of the others, and put its document back in the main window. It sits at the foot of
 * the document's pane, on the right, level with the word count on the left.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { FloatingToolbar, IconButton } from '../ui'
import './DetachedWindowBar.css'

export default function DetachedWindowBar({ onTop, onKeepOnTop, onDock }) {
  const [pane, setPane] = useState(null)

  // The pane mounts with the document, after this; look until it is there.
  useEffect(() => {
    let frame = 0
    const find = () => {
      const found = document.querySelector('.pane.primary-pane')
      if (found) setPane(found)
      else frame = requestAnimationFrame(find)
    }
    find()
    return () => cancelAnimationFrame(frame)
  }, [])

  if (!pane || !pane.isConnected) return null
  return createPortal(
    <div className="detached-window-bar">
      <FloatingToolbar label="Window">
        <IconButton
          icon="pin"
          label={onTop ? 'Stop keeping on top' : 'Keep on top'}
          size="capsule"
          filled={onTop}
          aria-pressed={onTop}
          onClick={() => onKeepOnTop(!onTop)}
        />
        <IconButton icon="pop-in" label="Move back to the main window" size="capsule" onClick={onDock} />
      </FloatingToolbar>
    </div>,
    pane,
  )
}
