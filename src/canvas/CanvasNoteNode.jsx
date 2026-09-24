/**
 * CanvasNoteNode.jsx — a note (and its replies) from a document, shown on a canvas.
 *
 * The card is a VIEW onto the note in its owning document, not a copy: typing here
 * writes back to that document's notes, and an edit made in the document's sidebar
 * shows up here. See CanvasNotesContext for how the two directions are kept honest.
 *
 * A quote note also shows the text it was written ABOUT — the anchor. Without it the
 * note is a reply with no question: "this contradicts chapter 2" means nothing on a
 * canvas unless you can see what "this" was.
 *
 * Replies (notes whose parentNoteId points at this one) render nested beneath it, so
 * a whole note thread travels to the canvas as one card.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { touchNote, createFreeNote, collectNoteBranchIds } from '../lib/noteUtils'
import { getDocDisplayName } from '../lib/docKind'
import { useCanvasNotes } from './useCanvasNotes'
import { filePathToDocPath } from './useDocPreview'
import AudioNotes from '../components/AudioNotes'
import NoteImageGallery from '../components/NoteImageGallery'
import { readClipboardImages } from '../lib/noteImageUtils'

/** The note plus everything nested under it, depth-first. */
function buildThread(notes, rootId) {
  const byParent = new Map()
  for (const note of notes) {
    const key = note.parentNoteId || null
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key).push(note)
  }

  const root = notes.find((note) => note.id === rootId)
  if (!root) return []

  const out = []
  const walk = (note, depth) => {
    out.push({ note, depth })
    for (const child of byParent.get(note.id) || []) walk(child, depth + 1)
  }
  walk(root, 0)

  return out
}

function NoteBody({ note, depth, projectName, onChange, onChangeAudio, onChangeImages, onAddReply, onDelete }) {
  const [draft, setDraft] = useState(note.content || '')
  const dirtyRef = useRef(false)

  // Take updates from the other side (the document's sidebar) — but never while the
  // user is mid-sentence in this field, or their typing would be yanked out from
  // under them by their own round-trip.
  useEffect(() => {
    if (!dirtyRef.current) setDraft(note.content || '')
  }, [note.content])

  const commit = () => {
    dirtyRef.current = false
    if ((note.content || '') !== draft) onChange(note.id, draft)
  }

  return (
    <div
      className="canvas-note-item"
      style={{ '--note-depth': depth, '--note-color': note.color }}
    >
      {note.type === 'quote' && note.anchor ? (
        <blockquote className="canvas-note-anchor">{note.anchor}</blockquote>
      ) : null}

      <textarea
        className="canvas-note-text"
        value={draft}
        placeholder={depth ? 'Reply…' : 'Note…'}
        onChange={(event) => {
          dirtyRef.current = true
          setDraft(event.target.value)
        }}
        onBlur={commit}
        // A pasted picture attaches to the note, as it does in the notes panel.
        onPaste={async (event) => {
          const images = await readClipboardImages(event.clipboardData)
          if (!images.length) return
          event.preventDefault()
          onChangeImages(note.id, [...(note.images || []), ...images])
        }}
        // The surface would otherwise read a press here as "start a marquee" and a
        // drag as "move the card", while the user is selecting text.
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      />

      <NoteImageGallery
        images={note.images}
        onRemoveImage={(imageId) =>
          onChangeImages(note.id, (note.images || []).filter((image) => image.id !== imageId))}
      />

      {/* Voice memos live on the note itself, so one recorded here shows up in the
          notes panel and the in-line preview too — and vice versa. */}
      <AudioNotes
        audio={note.audio}
        projectName={projectName}
        onChange={(audio) => onChangeAudio(note.id, audio)}
        compact
      />

      <div className="canvas-note-actions">
        <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => onAddReply(note.id)}>
          Reply
        </button>
        <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => onDelete(note.id)}>
          Delete
        </button>
      </div>
    </div>
  )
}

export default function CanvasNoteNode({ node }) {
  const notesApi = useCanvasNotes()
  const docPath = useMemo(() => filePathToDocPath(node.file), [node.file])
  const noteId = node.inkblotNoteId

  // Notes for a document that is open come from app state and update live. For a
  // closed one we read the file once and then hold our own copy, updated on write.
  const liveNotes = notesApi?.getLiveNotes(docPath) ?? null
  const [diskNotes, setDiskNotes] = useState(null)
  const notes = useMemo(() => liveNotes ?? diskNotes ?? [], [diskNotes, liveNotes])

  useEffect(() => {
    if (liveNotes || !notesApi) return
    let cancelled = false
    notesApi.readNotes(docPath).then((loaded) => {
      if (!cancelled) setDiskNotes(loaded || [])
    })
    return () => {
      cancelled = true
    }
  }, [docPath, liveNotes, notesApi])

  const thread = useMemo(() => buildThread(notes, noteId), [notes, noteId])

  /** Every write goes through here, so the disk copy and the live copy never diverge. */
  const apply = useCallback(
    async (updater) => {
      const next = await notesApi?.updateNotes(docPath, updater)
      // Only the closed-document case needs this; when the doc is open, app state is
      // the source and re-renders us on its own.
      if (next && !liveNotes) setDiskNotes(next)
    },
    [docPath, liveNotes, notesApi]
  )

  const changeNote = useCallback(
    (id, content) =>
      apply((current) => current.map((note) => (note.id === id ? touchNote(note, { content }) : note))),
    [apply]
  )

  const changeAudio = useCallback(
    (id, audio) =>
      apply((current) => current.map((note) => (note.id === id ? touchNote(note, { audio }) : note))),
    [apply]
  )

  const changeImages = useCallback(
    (id, images) =>
      apply((current) => current.map((note) => (note.id === id ? touchNote(note, { images }) : note))),
    [apply]
  )

  const addReply = useCallback(
    (parentId) =>
      apply((current) => {
        const parent = current.find((note) => note.id === parentId)
        const reply = createFreeNote(parent?.color)
        return [...current, { ...reply, parentNoteId: parentId }]
      }),
    [apply]
  )

  const deleteNote = useCallback(
    (id) =>
      apply((current) => {
        // Deleting a note takes its replies with it — an orphaned reply would hang off
        // a parent that no longer exists and never render again.
        const doomed = new Set(collectNoteBranchIds(current, id))
        return current.filter((note) => !doomed.has(note.id))
      }),
    [apply]
  )

  if (!thread.length) {
    return (
      <div className="canvas-note">
        <div className="canvas-note-header">
          <span className="canvas-note-source">{getDocDisplayName(docPath)}</span>
        </div>
        <div className="canvas-doc-body canvas-doc-empty">
          {notesApi ? 'Note not found' : 'Notes unavailable'}
        </div>
      </div>
    )
  }

  const root = thread[0].note

  return (
    <div className="canvas-note" style={{ '--note-color': root.color }}>
      <div className="canvas-note-header">
        <span className="canvas-note-source">{getDocDisplayName(docPath)}</span>
        <span className="canvas-note-kind">{root.type === 'quote' ? 'note' : 'free note'}</span>
      </div>

      <div className="canvas-note-thread" data-canvas-scroll>
        {thread.map(({ note, depth }) => (
          <NoteBody
            key={note.id}
            note={note}
            depth={depth}
            projectName={notesApi?.projectName}
            onChange={changeNote}
            onChangeAudio={changeAudio}
            onChangeImages={changeImages}
            onAddReply={addReply}
            onDelete={deleteNote}
          />
        ))}
      </div>
    </div>
  )
}
