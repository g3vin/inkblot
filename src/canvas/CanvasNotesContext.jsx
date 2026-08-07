/**
 * CanvasNotesContext.jsx — how a note card on the canvas reaches the app's notes.
 *
 * A note lives in the document that owns it (`notesByDoc[docPath]`), and a canvas
 * card is a VIEW onto it — never a copy. That single decision is what makes editing
 * from either side stay in sync: there is only one note, and both the document's
 * sidebar and the canvas card are looking at it.
 *
 * Delivered by context rather than as props because CanvasNode is memoized on its
 * node object: threading `notesByDoc` through it would change identity on every note
 * keystroke and re-render every card on the canvas.
 *
 * Persistence has two cases, and they are not the same:
 *
 *   - the owning document is OPEN in a pane. Its own autosave writes { content, notes }
 *     whenever notesByDoc changes, so updating that state is all we have to do.
 *   - the owning document is CLOSED. Nothing is watching it, and saveDocument() needs
 *     content it cannot get without an editor. So the write goes through
 *     saveDocumentNotes(), which reads the file and replaces only the notes.
 */
import { useCallback, useMemo } from 'react'
import { loadDocument, saveDocumentNotes } from '../lib/FileSystem'
import { normalizeNotes } from '../lib/noteUtils'
import { CanvasNotesContext } from './notesContext'

export function CanvasNotesProvider({
  children,
  projectName,
  notesByDoc,
  setNotesForDoc,
  openDocs,
}) {
  /** Notes for a document the app already has in memory, or null if it doesn't. */
  const getLiveNotes = useCallback(
    (docPath) => (notesByDoc && Object.prototype.hasOwnProperty.call(notesByDoc, docPath)
      ? notesByDoc[docPath]
      : null),
    [notesByDoc]
  )

  /** Notes for a document that isn't loaded — read straight off disk. */
  const readNotes = useCallback(
    async (docPath) => {
      const doc = await loadDocument(projectName, docPath)
      return doc ? normalizeNotes(doc.notes || []) : null
    },
    [projectName]
  )

  /**
   * Apply `updater` to a document's notes, from the canvas side.
   *
   * Always updates the in-memory list, so an open document's sidebar and hover
   * previews move the instant the card does. Writes to disk only when the document
   * is closed — when it is open, its own autosave owns the file, and a second writer
   * would race it.
   */
  const updateNotes = useCallback(
    async (docPath, updater) => {
      const live = getLiveNotes(docPath)
      const base = live ?? (await readNotes(docPath))
      if (!base) return null

      const next = normalizeNotes(typeof updater === 'function' ? updater(base) : updater)

      setNotesForDoc?.(docPath, next)

      const isOpen = openDocs?.includes(docPath)
      if (!isOpen) await saveDocumentNotes(projectName, docPath, next)

      return next
    },
    [getLiveNotes, openDocs, projectName, readNotes, setNotesForDoc]
  )

  const value = useMemo(
    () => ({ projectName, notesByDoc, getLiveNotes, readNotes, updateNotes }),
    [getLiveNotes, notesByDoc, projectName, readNotes, updateNotes]
  )

  return <CanvasNotesContext.Provider value={value}>{children}</CanvasNotesContext.Provider>
}
