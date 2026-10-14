/**
 * useClipboardPieceDrag — carrying a clipboard piece into the page by hand.
 *
 * The browser's drag and drop shows a frozen picture of whatever was grabbed, hung
 * off the pointer wherever it was grabbed. This drags the text itself:
 *
 *   1. Past a small threshold the text lifts out of the panel, and in a quick glide
 *      its start comes to the pointer, so the writer holds the text by its start.
 *   2. Over a pane the page's own caret shows where it would go.
 *   3. Held still there, the text glides into the page and stays as a preview in
 *      the accent (extensions/DropPreview). Moving again takes it back out of the
 *      page to the pointer.
 *   4. Released over a pane, it is inserted and leaves the clipboard; anywhere else
 *      (or on Escape) it glides home.
 *
 * The panes answer through lib/clipboardDropTarget; the drag's payload is on
 * bridge/dragHandoff like every other in-app drag.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { dragHandoff, DragPayloadKind } from '../../bridge'
import { clipboardDropTarget } from '../../lib/clipboardDropTarget'

// How far the pointer travels before a press becomes a drag.
const DRAG_THRESHOLD = 4
// How long the pointer rests before the text settles into the page, and how far it
// may wander while resting.
const DWELL_MS = 650
const DWELL_TOLERANCE = 4
// --dur-fast and --dur-base: the glide to the pointer, and the glide home.
const GLIDE_MS = 120
const HOME_MS = 180

const reducedMotion = () => (
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
)

// --ease-out
const easeOut = (t) => 1 - Math.pow(1 - t, 3)

export function useClipboardPieceDrag() {
  // What the ghost shows. Its position is written straight to the element, not
  // through React: it moves at pointer rate.
  const [ghost, setGhost] = useState(null)
  const ghostRef = useRef(null)
  const dragRef = useRef(null)

  const place = (left, top) => {
    const el = ghostRef.current
    if (el) el.style.transform = `translate3d(${left}px, ${top}px, 0)`
  }

  const setGhostVisible = (visible) => {
    const el = ghostRef.current
    if (el) el.dataset.settled = visible ? 'false' : 'true'
  }

  // Ease the ghost from where it is now to `to()`, re-reading `to` each frame so a
  // glide toward the pointer follows the pointer while it moves.
  const glide = (drag, to, duration, done) => {
    cancelAnimationFrame(drag.frame)
    const from = { ...drag.at }
    const started = performance.now()
    const span = reducedMotion() ? 0 : duration
    const step = (now) => {
      const t = span ? Math.min(1, (now - started) / span) : 1
      const target = to()
      const k = easeOut(t)
      drag.at = { left: from.left + (target.left - from.left) * k, top: from.top + (target.top - from.top) * k }
      place(drag.at.left, drag.at.top)
      if (t < 1) drag.frame = requestAnimationFrame(step)
      else { drag.frame = 0; drag.gliding = false; done?.() }
    }
    drag.gliding = true
    drag.frame = requestAnimationFrame(step)
  }

  // The ghost's resting place under the pointer: its first line's start on the hotspot.
  const atPointer = (drag) => ({ left: drag.pointer.x, top: drag.pointer.y - drag.lineHeight / 2 })

  const finish = useCallback(() => {
    const drag = dragRef.current
    if (!drag) return
    cancelAnimationFrame(drag.frame)
    clearTimeout(drag.dwell)
    window.removeEventListener('pointermove', drag.onMove, true)
    window.removeEventListener('pointerup', drag.onUp, true)
    window.removeEventListener('pointercancel', drag.onCancel, true)
    window.removeEventListener('keydown', drag.onKey, true)
    document.documentElement.classList.remove('is-dragging-clipboard')
    dragRef.current = null
    setGhost(null)
  }, [])

  // Put the piece back where it came from, then end the drag.
  const sendHome = (drag) => {
    clipboardDropTarget()?.clear()
    dragHandoff.end()
    setGhostVisible(true)
    window.removeEventListener('pointermove', drag.onMove, true)
    clearTimeout(drag.dwell)
    glide(drag, () => drag.home, HOME_MS, finish)
  }

  const settleIntoPage = (drag) => {
    if (!drag.overPage) return
    const rect = clipboardDropTarget()?.preview(drag.pointer.x, drag.pointer.y, drag.entry.text)
    if (!rect) return
    drag.previewAt = { ...drag.pointer }
    glide(drag, () => ({ left: rect.left, top: rect.top }), GLIDE_MS, () => {
      if (drag.previewAt) setGhostVisible(false)
    })
  }

  const lift = (drag) => {
    drag.lifted = true
    dragHandoff.begin({ kind: DragPayloadKind.ClipboardEntry, text: drag.entry.text || '', sourceId: drag.entry.id })
    document.documentElement.classList.add('is-dragging-clipboard')
    // The text starts exactly over the panel's copy of it, then glides to the pointer.
    drag.at = { ...drag.home }
    setGhost({ text: drag.entry.text || '', width: drag.width })
  }

  const move = (drag, x, y) => {
    drag.pointer = { x, y }
    dragHandoff.moveTo(x, y)

    if (drag.previewAt) {
      if (Math.hypot(x - drag.previewAt.x, y - drag.previewAt.y) <= DWELL_TOLERANCE) return
      // Moving again lifts the text back out of the page to the pointer.
      drag.previewAt = null
      setGhostVisible(true)
      glide(drag, () => atPointer(drag), GLIDE_MS)
    } else if (!drag.gliding) {
      drag.at = atPointer(drag)
      place(drag.at.left, drag.at.top)
    }

    drag.overPage = Boolean(clipboardDropTarget()?.hover(x, y))
    clearTimeout(drag.dwell)
    if (drag.overPage) drag.dwell = setTimeout(() => settleIntoPage(drag), DWELL_MS)
  }

  const onPointerDown = (event, entry, textEl) => {
    if (event.button !== 0 || dragRef.current || !textEl) return
    // The piece's own buttons are not handles.
    if (event.target.closest?.('button:not(.ui-section-header), a, input')) return

    const rect = textEl.getBoundingClientRect()
    const lineHeight = parseFloat(getComputedStyle(textEl).lineHeight) || 20
    const drag = {
      entry,
      start: { x: event.clientX, y: event.clientY },
      pointer: { x: event.clientX, y: event.clientY },
      home: { left: rect.left, top: rect.top },
      at: { left: rect.left, top: rect.top },
      width: rect.width,
      lineHeight,
      lifted: false,
      overPage: false,
      previewAt: null,
      gliding: false,
      frame: 0,
      dwell: 0,
    }

    drag.onMove = (moveEvent) => {
      if (!drag.lifted) {
        const travelled = Math.hypot(moveEvent.clientX - drag.start.x, moveEvent.clientY - drag.start.y)
        if (travelled < DRAG_THRESHOLD) return
        lift(drag)
      }
      moveEvent.preventDefault()
      move(drag, moveEvent.clientX, moveEvent.clientY)
    }

    drag.onUp = (upEvent) => {
      if (!drag.lifted) { finish(); return }
      // A drag is not a click: the section header under the pointer must not toggle.
      window.addEventListener('click', swallowClick, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallowClick, true), 0)

      const x = upEvent.clientX
      const y = upEvent.clientY
      const target = clipboardDropTarget()
      if (target?.drop(x, y, { id: entry.id, text: entry.text || '' })) {
        dragHandoff.end({ x, y })
        finish()
      } else {
        sendHome(drag)
      }
    }

    drag.onCancel = () => { if (drag.lifted) sendHome(drag); else finish() }
    drag.onKey = (keyEvent) => {
      if (keyEvent.key !== 'Escape' || !drag.lifted) return
      keyEvent.preventDefault()
      keyEvent.stopPropagation()
      window.removeEventListener('pointerup', drag.onUp, true)
      sendHome(drag)
    }

    dragRef.current = drag
    window.addEventListener('pointermove', drag.onMove, true)
    window.addEventListener('pointerup', drag.onUp, true)
    window.addEventListener('pointercancel', drag.onCancel, true)
    window.addEventListener('keydown', drag.onKey, true)
  }

  // Once the ghost has mounted, start it over the panel's copy and glide it to the pointer.
  useEffect(() => {
    const drag = dragRef.current
    if (!ghost || !drag) return
    place(drag.at.left, drag.at.top)
    glide(drag, () => atPointer(drag), GLIDE_MS)
  // Runs once per lift; the drag itself lives in the ref.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghost])

  // Unmounting mid-drag ends it: there is no longer a source to move from.
  useEffect(() => () => {
    if (!dragRef.current) return
    clipboardDropTarget()?.clear()
    if (dragHandoff.current()?.kind === DragPayloadKind.ClipboardEntry) dragHandoff.end()
    finish()
  }, [finish])

  return { ghost, ghostRef, onPointerDown }
}

function swallowClick(event) {
  event.preventDefault()
  event.stopPropagation()
}
