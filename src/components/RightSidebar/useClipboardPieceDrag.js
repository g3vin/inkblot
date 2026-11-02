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
 *      (or on Escape) it glides home, and a press on it on the way catches it and
 *      carries on the drag from there.
 *
 * The panes answer through lib/clipboardDropTarget; the drag's payload is on
 * bridge/dragHandoff like every other in-app drag.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { dragHandoff, DragPayloadKind } from '../../bridge'
import { clipboardDropTarget } from '../../lib/clipboardDropTarget'
import { SPRINGS, pastSlop, prefersReducedMotion, releaseSpring, spring, springAt, trackSample, velocityFrom } from '../../ui/physics.js'

// How far the pointer travels before a press becomes a drag.
// How long the pointer rests before the text settles into the page, and how far it
// may wander while resting.
const DWELL_MS = 650
const DWELL_TOLERANCE = 4
// The glide to the pointer or into the page, and the glide home, which sets off at
// the speed the hand let go at.
const GLIDE = spring(SPRINGS.quick)

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

  // Spring the ghost from where it is, at the speed it is going, to `to()`, re-read
  // each frame so a glide toward the pointer follows the pointer while it moves.
  const glide = (drag, to, params, done) => {
    cancelAnimationFrame(drag.frame)
    let last = performance.now()
    const step = () => {
      const now = performance.now()
      const dt = Math.min(64, Math.max(0, now - last))
      last = now
      const target = to()
      if (prefersReducedMotion()) {
        drag.at = { ...target }
        drag.v = { x: 0, y: 0 }
      } else {
        const x = springAt(params, drag.at.left, target.left, drag.v.x, dt)
        const y = springAt(params, drag.at.top, target.top, drag.v.y, dt)
        drag.at = { left: x.value, top: y.value }
        drag.v = { x: x.velocity, y: y.velocity }
      }
      const arrived = Math.hypot(target.left - drag.at.left, target.top - drag.at.top) < 0.5
        && Math.hypot(drag.v.x, drag.v.y) * 16 < 0.5
      if (arrived) drag.at = { ...target }
      place(drag.at.left, drag.at.top)
      if (!arrived) drag.frame = requestAnimationFrame(step)
      else { drag.frame = 0; drag.gliding = false; drag.v = { x: 0, y: 0 }; done?.() }
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
    window.removeEventListener('pointerdown', drag.onCatch, true)
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
    // Thrown, it keeps the throw's speed on the way home.
    if (!drag.gliding) drag.v = velocityFrom(drag.samples)
    drag.returning = true
    window.addEventListener('pointerdown', drag.onCatch, true)
    glide(drag, () => drag.home, spring(releaseSpring(Math.hypot(drag.v.x, drag.v.y))), finish)
  }

  // Caught on its way home: the hand has it again, and it glides from where it is, at
  // the speed it is going, to the pointer.
  const catchAgain = (drag, event) => {
    drag.returning = false
    window.removeEventListener('pointerdown', drag.onCatch, true)
    dragHandoff.begin({ kind: DragPayloadKind.ClipboardEntry, text: drag.entry.text || '', sourceId: drag.entry.id })
    drag.pointer = { x: event.clientX, y: event.clientY }
    drag.samples = []
    window.addEventListener('pointermove', drag.onMove, true)
    window.removeEventListener('pointerup', drag.onUp, true)
    window.addEventListener('pointerup', drag.onUp, true)
    glide(drag, () => atPointer(drag), GLIDE)
  }

  const settleIntoPage = (drag) => {
    if (!drag.overPage) return
    const rect = clipboardDropTarget()?.preview(drag.pointer.x, drag.pointer.y, drag.entry.text)
    if (!rect) return
    drag.previewAt = { ...drag.pointer }
    glide(drag, () => ({ left: rect.left, top: rect.top }), GLIDE, () => {
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
    trackSample(drag.samples, { t: performance.now(), x, y })
    dragHandoff.moveTo(x, y)

    if (drag.previewAt) {
      if (Math.hypot(x - drag.previewAt.x, y - drag.previewAt.y) <= DWELL_TOLERANCE) return
      // Moving again lifts the text back out of the page to the pointer.
      drag.previewAt = null
      setGhostVisible(true)
      glide(drag, () => atPointer(drag), GLIDE)
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
      v: { x: 0, y: 0 },
      samples: [],
      width: rect.width,
      lineHeight,
      lifted: false,
      overPage: false,
      previewAt: null,
      gliding: false,
      returning: false,
      frame: 0,
      dwell: 0,
    }

    drag.onMove = (moveEvent) => {
      if (!drag.lifted) {
        if (!pastSlop(moveEvent.clientX - drag.start.x, moveEvent.clientY - drag.start.y, moveEvent.pointerType)) return
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
    drag.onCatch = (downEvent) => {
      const box = ghostRef.current?.getBoundingClientRect()
      if (downEvent.button !== 0 || !box) return
      const { clientX: x, clientY: y } = downEvent
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) return
      downEvent.preventDefault()
      downEvent.stopPropagation()
      catchAgain(drag, downEvent)
    }
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
    glide(drag, () => atPointer(drag), GLIDE)
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
