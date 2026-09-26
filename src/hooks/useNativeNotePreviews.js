/**
 * useNativeNotePreviews — the note markers, reported to a shell that draws the cards.
 *
 * Under the Swift shell the cards that open over a note's marker are native Liquid
 * Glass: glass samples what is *behind* it, and only a view above the page can sample
 * the document. So the page stops drawing NoteHoverPreview
 * and says instead where the marker is and what happened to it:
 *
 *   - hover, leave and pin, as the marker's own mouse events fire
 *   - where it moved to, once per frame, while a card is open and the document scrolls
 *     or reflows — the shell cannot see the page scroll
 *   - a click anywhere else in the page, which is what closes a pinned card
 *
 * It also reports every visible marker (`noteMarkersChanged`), because the dots
 * themselves are the shell's to draw, as Liquid Glass — which only a view above the page
 * can be. The page's dots stay where they are, invisible (`.native-note-dots`), and go
 * on taking the hover and the click.
 *
 * And it takes one thing back: which note's cards are open (`highlightNote`), so the
 * text that note is about is highlighted while they are — the cards do not quote it.
 *
 * Rects are the marker's `getBoundingClientRect()`: page coordinates, which are the web
 * view's own at page zoom 1, which is the only zoom the shell uses.
 */
import { useEffect } from 'react'
import { documentSurface } from '../bridge'
import {
  NOTE_HIGHLIGHT_EVENT,
  NOTE_PREVIEW_ENTER_EVENT,
  NOTE_PREVIEW_LEAVE_EVENT,
  NOTE_PREVIEW_PIN_EVENT,
} from '../extensions/NoteAnnotation'

// Note ids are UUIDs today, but a selector is no place to trust that.
const escapeId = (id) => (globalThis.CSS?.escape ? globalThis.CSS.escape(id) : id.replace(/["\\]/g, '\\$&'))

const markerFor = (noteId) => {
  if (!noteId || typeof document === 'undefined') return null
  return document.querySelector(`.note-marker[data-note-id="${escapeId(String(noteId))}"]`)
}

const toEvent = (note, docPath, rect) => ({
  noteId: String(note?.id || ''),
  docPath: String(docPath || note?.docName || ''),
  anchorLeft: rect.left,
  anchorTop: rect.top,
  anchorRight: rect.right,
  anchorBottom: rect.bottom,
  ...(note ? { note: withoutDocName(note) } : {}),
})

// NoteAnnotation adds `docName` to the note it reports; the protocol's Note has no such
// field and the path travels beside it.
const withoutDocName = (note) => {
  const { docName: _docName, ...rest } = note
  return rest
}

const isClipping = (style) => style.overflowX !== 'visible' || style.overflowY !== 'visible'

/**
 * A dot's rect, or null if it cannot be seen: not laid out, or scrolled out of one of
 * the panes around it. `clips` caches each ancestor's clipping rect for one pass. The
 * bubble chips (`useBubbleSessions`) are measured the same way.
 */
export const visibleRect = (dot, clips) => {
  const rect = dot.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  const x = (rect.left + rect.right) / 2
  const y = (rect.top + rect.bottom) / 2
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return null
  for (let node = dot.parentElement; node && node !== document.body; node = node.parentElement) {
    let clip = clips.get(node)
    if (clip === undefined) {
      clip = isClipping(getComputedStyle(node)) ? node.getBoundingClientRect() : null
      clips.set(node, clip)
    }
    if (clip && (x < clip.left || x > clip.right || y < clip.top || y > clip.bottom)) return null
  }
  return rect
}

const collectMarkers = () => {
  const clips = new Map()
  const markers = []
  for (const marker of document.querySelectorAll('.note-marker')) {
    const dot = marker.querySelector('.note-dot') || marker
    const rect = visibleRect(dot, clips)
    if (!rect) continue
    markers.push({
      noteId: String(marker.dataset.noteId || ''),
      color: marker.style.getPropertyValue('--note-color') || '#007aff',
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    })
  }
  return markers
}

export function useNativeNotePreviews({ enabled }) {
  useEffect(() => {
    if (!enabled) return undefined
    let open = null // { noteId, docPath } of the card the shell is showing

    const report = (kind) => (event) => {
      const { note, anchorRect } = event?.detail || {}
      if (!note?.id || !anchorRect) return
      const payload = toEvent(note, note.docName, anchorRect)
      if (kind !== 'leave') open = { noteId: payload.noteId, docPath: payload.docPath }
      documentSurface.publishNoteMarker(kind, payload)
    }
    const onEnter = report('hover')
    const onLeave = report('leave')
    const onPin = report('pin')

    let frame = 0
    const onMove = () => {
      if (!open || frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        if (!open) return
        const marker = markerFor(open.noteId)
        if (!marker) {
          // The document changed under it — switched, or the quote deleted.
          documentSurface.publishNotePreviewDismissed({ noteId: open.noteId })
          open = null
          return
        }
        const rect = marker.getBoundingClientRect()
        documentSurface.publishNoteMarkerMoved(toEvent({ id: open.noteId }, open.docPath, rect))
      })
    }

    const onPointerDown = (event) => {
      if (!open) return
      if (event.target instanceof Element && event.target.closest('.note-marker')) return
      documentSurface.publishNotePreviewDismissed({ noteId: open.noteId })
      open = null
    }

    // The dots: measured at most once a frame, whatever moved them — a scroll, a
    // resize, an edit, a pane opening — and sent only when something did move.
    document.documentElement.classList.add('native-note-dots')
    let lastMarkers = ''
    let markersFrame = 0
    const publishMarkers = () => {
      if (markersFrame) return
      markersFrame = window.requestAnimationFrame(() => {
        markersFrame = 0
        // Mid-zoom the pages are a picture being stretched (PrintLayoutView), moved every
        // frame. Following it would measure every dot and cross the bridge each frame;
        // the dots step aside instead and come back where the zoom lands.
        const markers = document.querySelector('.pl-sizer.is-zooming') ? [] : collectMarkers()
        const key = JSON.stringify(markers)
        if (key === lastMarkers) return
        lastMarkers = key
        documentSurface.publishNoteMarkersChanged({ markers })
      })
    }
    // Absent in the test harness's DOM; everywhere real it is there.
    const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(publishMarkers)
    mutations?.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    })
    publishMarkers()

    const offHighlight = documentSurface.onCommand('highlightNote', ({ noteId }) => {
      window.dispatchEvent(new CustomEvent(NOTE_HIGHLIGHT_EVENT, { detail: { noteId: noteId ?? null } }))
    })

    window.addEventListener(NOTE_PREVIEW_ENTER_EVENT, onEnter)
    window.addEventListener(NOTE_PREVIEW_LEAVE_EVENT, onLeave)
    window.addEventListener(NOTE_PREVIEW_PIN_EVENT, onPin)
    // Capture: the document scrolls inside a pane, not the window, and scroll does not
    // bubble.
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', publishMarkers, true)
    window.addEventListener('resize', publishMarkers)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      offHighlight()
      mutations?.disconnect()
      if (markersFrame) window.cancelAnimationFrame(markersFrame)
      window.removeEventListener('scroll', publishMarkers, true)
      window.removeEventListener('resize', publishMarkers)
      document.documentElement.classList.remove('native-note-dots')
      documentSurface.publishNoteMarkersChanged({ markers: [] })
      window.dispatchEvent(new CustomEvent(NOTE_HIGHLIGHT_EVENT, { detail: { noteId: null } }))
      window.removeEventListener(NOTE_PREVIEW_ENTER_EVENT, onEnter)
      window.removeEventListener(NOTE_PREVIEW_LEAVE_EVENT, onLeave)
      window.removeEventListener(NOTE_PREVIEW_PIN_EVENT, onPin)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('pointerdown', onPointerDown, true)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [enabled])
}
