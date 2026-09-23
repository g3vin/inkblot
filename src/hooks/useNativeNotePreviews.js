/**
 * useNativeNotePreviews — the note markers, reported to a shell that draws the cards.
 *
 * Under the Swift shell the cards that open over a note's marker are native Liquid
 * Glass: glass samples what is *behind* it, and only a view above the page can sample
 * the document. So the page stops drawing NoteHoverPreview and says instead where the
 * marker is and what happened to it:
 *
 *   - hover, leave and pin, as the marker's own mouse events fire
 *   - where it moved to, once per frame, while a card is open and the document scrolls
 *     or reflows — the shell cannot see the page scroll
 *   - a click anywhere else in the page, which is what closes a pinned card
 *
 * Rects are the marker's `getBoundingClientRect()`: page coordinates, which are the web
 * view's own at page zoom 1, which is the only zoom the shell uses.
 */
import { useEffect } from 'react'
import { documentSurface } from '../bridge'
import {
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

    window.addEventListener(NOTE_PREVIEW_ENTER_EVENT, onEnter)
    window.addEventListener(NOTE_PREVIEW_LEAVE_EVENT, onLeave)
    window.addEventListener(NOTE_PREVIEW_PIN_EVENT, onPin)
    // Capture: the document scrolls inside a pane, not the window, and scroll does not
    // bubble.
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
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
