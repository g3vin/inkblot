/**
 * NotePanelTether — a note's dot strung to its card in the notes panel.
 *
 * With the notes panel open the note is already on screen, so hovering (or clicking)
 * its dot in the text doesn't float a second copy over the page (NoteHoverPreview):
 * a string draws from the dot to the card of the branch's root note in the panel
 * instead, at a hover note's pace (lib/noteReveal), and the card scrolls into view.
 * A hover lets go as the pointer leaves the dot; a click holds it until a click
 * elsewhere or Escape.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { STRING_CLOSE_MIN_MS, STRING_CLOSE_SPEED, drawMs, prefersReducedMotion } from '../lib/noteReveal'
import { getDotPoint, getStringPath } from '../lib/notePreviewGeometry'
import { noteColor } from '../lib/noteUtils'
import { panelCardFor } from '../lib/notePanelCard'
import {
  NOTE_HIGHLIGHT_EVENT,
  NOTE_PREVIEW_ENTER_EVENT,
  NOTE_PREVIEW_LEAVE_EVENT,
  NOTE_PREVIEW_PIN_EVENT,
} from '../extensions/NoteAnnotation'

const findMarker = (noteId, editorView) => {
  const selector = `.note-marker[data-note-id="${CSS.escape(String(noteId))}"]`
  return editorView?.dom?.querySelector?.(selector) || document.querySelector(selector)
}

// The band the string shows in: the page as its pane shows it, below the toolbar,
// and across to the panel. A dot scrolled off the page strings out from under the
// toolbar or the tray, as the text it marks has gone.
const clipFor = (marker) => {
  const pane = marker.closest('.pane-scroll')?.getBoundingClientRect()
  const sheet = marker.closest('.document-card')
  const page = sheet?.getBoundingClientRect()
  const toolbar = sheet?.querySelector(':scope > .app-titlebar')?.getBoundingClientRect()
  if (!pane) return null
  const top = Math.max(pane.top, page?.top ?? pane.top, toolbar?.bottom ?? pane.top)
  const bottom = Math.max(Math.min(pane.bottom, page?.bottom ?? pane.bottom), top)
  return { x: pane.left, y: top, width: Math.max(0, window.innerWidth - pane.left), height: bottom - top }
}

// The string runs to the part of the card the panel shows, so it never ends under
// the panel's edge while the card scrolls in.
const measure = (noteId, editorView, card) => {
  const marker = findMarker(noteId, editorView)
  const dot = marker?.getBoundingClientRect?.()
  if (!dot || !card.isConnected) return null
  const box = card.getBoundingClientRect()
  const view = card.closest('.notes-list')?.getBoundingClientRect()
  const top = Math.min(Math.max(box.top, view?.top ?? box.top), box.bottom)
  const bottom = Math.max(Math.min(box.bottom, view?.bottom ?? box.bottom), top)
  const shown = { x: box.left, y: top, width: box.width, height: bottom - top }
  const centre = { x: shown.x + shown.width / 2, y: shown.y + shown.height / 2 }
  const { d, length } = getStringPath(getDotPoint(dot), centre, null, shown)
  return { d, length, clip: clipFor(marker) || { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight } }
}

const sameRect = (a, b) => (
  a === b || Boolean(a && b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height)
)

// Scrolls the panel's list only: scrollIntoView would scroll the window's frames too.
const revealCard = (card) => {
  const list = card.closest('.notes-list')
  if (!list) return
  const box = card.getBoundingClientRect()
  const view = list.getBoundingClientRect()
  const fade = parseFloat(getComputedStyle(list).getPropertyValue('--sidebar-top-fade-height')) || 0
  if (box.top >= view.top + fade && box.bottom <= view.bottom) return
  const room = view.height - fade
  const offset = box.height > room ? fade : fade + (room - box.height) / 2
  list.scrollTo({
    top: list.scrollTop + box.top - view.top - offset,
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  })
}

export default function NotePanelTether({ notesByDoc = {}, panelOpen = false }) {
  const [tether, setTether] = useState(null)
  const [string, setString] = useState(null)
  const tetherRef = useRef(null)
  const notesByDocRef = useRef(notesByDoc)
  const panelOpenRef = useRef(panelOpen)
  const closeTimerRef = useRef(0)
  const keyRef = useRef(0)
  const clipId = `note-tether-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const pathRef = useRef(null)
  const clipRectRef = useRef(null)

  useEffect(() => {
    notesByDocRef.current = notesByDoc
    panelOpenRef.current = panelOpen
  }, [notesByDoc, panelOpen])

  const commit = useCallback((next) => {
    tetherRef.current = next
    setTether(next)
  }, [])

  const release = useCallback(() => {
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = 0
    commit(null)
    setString(null)
  }, [commit])

  // Lets go the way a hover note's string does: drawn back into the dot.
  const letGo = useCallback(() => {
    const current = tetherRef.current
    if (!current || current.closing) return
    const closeMs = prefersReducedMotion() ? 0 : Math.max(STRING_CLOSE_MIN_MS, Math.round(current.draw * STRING_CLOSE_SPEED))
    commit({ ...current, closing: true, closeMs })
    closeTimerRef.current = window.setTimeout(release, closeMs)
  }, [commit, release])

  useEffect(() => () => window.clearTimeout(closeTimerRef.current), [])

  useEffect(() => {
    const open = (detail, locked) => {
      const note = detail?.note
      if (!panelOpenRef.current || !note) return
      const card = panelCardFor(note, notesByDocRef.current?.[note.docName] || [])
      if (!card) return
      const current = tetherRef.current
      if (current?.locked && !current.closing && current.noteId !== note.id) return

      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = 0
      revealCard(card)
      const same = current && !current.closing && current.noteId === note.id
      const geometry = measure(note.id, detail.editorView, card)
      if (!geometry) return
      if (!same) keyRef.current += 1
      commit({
        key: keyRef.current,
        noteId: note.id,
        card,
        editorView: detail.editorView || null,
        color: noteColor(note.color),
        locked: Boolean(locked || (same && current.locked)),
        closing: false,
        draw: same ? current.draw : drawMs(geometry.length),
      })
      setString(geometry)
    }

    const handleEnter = (event) => open(event.detail, false)
    const handlePin = (event) => open(event.detail, true)
    const handleLeave = (event) => {
      const current = tetherRef.current
      if (!current || current.locked || current.noteId !== event?.detail?.note?.id) return
      letGo()
    }

    window.addEventListener(NOTE_PREVIEW_ENTER_EVENT, handleEnter)
    window.addEventListener(NOTE_PREVIEW_PIN_EVENT, handlePin)
    window.addEventListener(NOTE_PREVIEW_LEAVE_EVENT, handleLeave)
    return () => {
      window.removeEventListener(NOTE_PREVIEW_ENTER_EVENT, handleEnter)
      window.removeEventListener(NOTE_PREVIEW_PIN_EVENT, handlePin)
      window.removeEventListener(NOTE_PREVIEW_LEAVE_EVENT, handleLeave)
    }
  }, [commit, letGo])

  // The panel closing takes the string with it, at once: there's nothing to draw back to.
  useEffect(() => {
    if (!panelOpen && tetherRef.current) release()
  }, [panelOpen, release])

  const noteId = tether?.noteId ?? null
  const card = tether?.card ?? null
  const editorView = tether?.editorView ?? null
  const closing = Boolean(tether?.closing)
  const locked = Boolean(tether?.locked)

  // Follow the dot and the card as the page and the panel scroll, the window resizes
  // and the card grows; a dot or card gone (deleted, filtered out) drops the string.
  // Written to the SVG directly, not through state: a render a frame behind the
  // scroll leaves the string trailing the dot. Scroll events come late and few
  // with momentum scrolling, so a scroll also follows frame by frame until it settles.
  useLayoutEffect(() => {
    if (!noteId || !card) return undefined
    let last = null
    let frame = 0
    let still = 0
    const sync = () => {
      const next = measure(noteId, editorView, card)
      if (!next) {
        release()
        return false
      }
      if (last && last.d === next.d && sameRect(last.clip, next.clip)) return false
      last = next
      pathRef.current?.setAttribute('d', next.d)
      const rect = clipRectRef.current
      if (rect) {
        rect.setAttribute('x', next.clip.x)
        rect.setAttribute('y', next.clip.y)
        rect.setAttribute('width', next.clip.width)
        rect.setAttribute('height', next.clip.height)
      }
      return true
    }
    const follow = () => {
      still = sync() ? 0 : still + 1
      frame = still < 8 ? requestAnimationFrame(follow) : 0
    }
    const handleScroll = () => {
      sync()
      still = 0
      if (!frame) frame = requestAnimationFrame(follow)
    }
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', sync)
    const observer = new ResizeObserver(sync)
    observer.observe(card)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', sync)
      observer.disconnect()
    }
  }, [noteId, card, editorView, release])

  // The card it's strung to, and the text the note is about, light up while it holds.
  useEffect(() => {
    if (!noteId || closing) return undefined
    card?.setAttribute('data-tethered', '')
    window.dispatchEvent(new CustomEvent(NOTE_HIGHLIGHT_EVENT, { detail: { noteId } }))
    return () => {
      card?.removeAttribute('data-tethered')
      window.dispatchEvent(new CustomEvent(NOTE_HIGHLIGHT_EVENT, { detail: { noteId: null } }))
    }
  }, [noteId, card, closing])

  useEffect(() => {
    if (!locked || closing) return undefined
    const handlePointerDown = (event) => {
      if (event.target instanceof Element && (event.target.closest('.note-marker') || card?.contains(event.target))) return
      letGo()
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') letGo()
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [locked, closing, card, letGo])

  if (!tether || !string) return null

  return (
    <div
      className={`note-preview-layer${closing ? ' is-closing' : ''}`}
      style={{ '--note-color': tether.color }}
      aria-hidden="true"
    >
      <svg
        className="note-preview-string"
        viewBox={`0 0 ${window.innerWidth} ${window.innerHeight}`}
        preserveAspectRatio="none"
      >
        <defs>
          <clipPath id={clipId}>
            <rect ref={clipRectRef} x={string.clip.x} y={string.clip.y} width={string.clip.width} height={string.clip.height} />
          </clipPath>
        </defs>
        <path
          ref={pathRef}
          key={tether.key}
          clipPath={`url(#${clipId})`}
          className="note-preview-string-path"
          d={string.d}
          pathLength="1"
          style={{
            '--string-ms': `${tether.draw}ms`,
            '--string-close-ms': `${tether.closeMs ?? STRING_CLOSE_MIN_MS}ms`,
          }}
        />
      </svg>
    </div>
  )
}
