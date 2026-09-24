/**
 * useEditorNotes — keeping notes and the document pointing at each other.
 *
 * Outward: a note's anchor is a pair of ProseMirror positions, and every edit
 * invalidates them. Each transaction maps them forward and re-reads the text they
 * now cover, so a note made on "she hesitated" still points at those words after a
 * paragraph is inserted above. A note whose range collapses to nothing has lost what
 * it was about and is dropped rather than left aimed at whatever moved in.
 *
 * Nothing here reports an error. If the remap stops, notes quietly drift onto the
 * wrong words, and nobody finds out until they open one.
 *
 * Inward: syncEditorNotes publishes the notes into editor storage, which is what the
 * NoteAnnotation decorations render from.
 *
 * Outward again: the shell holds these positions too, so every remap is also
 * published on the bridge. The
 * event fires on every transaction, which is every keystroke in a document with quote
 * notes, so the surface coalesces it to one per frame — safely, because the event
 * carries the whole remapped set rather than a delta, and the last one is always
 * complete. See bridge/coalesce.ts.
 */
import { useEffect } from 'react'

import { documentSurface } from '../bridge'
import { syncEditorNotes } from '../extensions/NoteAnnotation'
import { isEditorReady } from '../lib/editorUtils'

/** Shallow-compare two note arrays (per-note key/value equality) to avoid redundant state updates. */
const areNoteArraysEqual = (left = [], right = []) => {
  if (left === right) return true
  if (!Array.isArray(left) || !Array.isArray(right)) return false
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    const leftNote = left[index]
    const rightNote = right[index]

    if (leftNote === rightNote) continue
    if (!leftNote || !rightNote) return false

    const leftKeys = Object.keys(leftNote)
    const rightKeys = Object.keys(rightNote)
    if (leftKeys.length !== rightKeys.length) return false

    for (const key of leftKeys) {
      if (leftNote[key] !== rightNote[key]) {
        return false
      }
    }
  }

  return true
}

export function useEditorNotes({
  currentDoc,
  currentDocNotes,
  docCache,
  editor,
  getNotesForDoc,
  secondaryDoc,
  secondaryDocNotes,
  secondaryEditor,
  setNotesForDoc,
  splitView,
}) {
  const { isPaneLoading } = docCache

  /* ---------------- Notes → editor storage ---------------- */

  useEffect(() => {
    if (!isEditorReady(editor)) return
    syncEditorNotes(editor, currentDocNotes, currentDoc)
  }, [currentDoc, currentDocNotes, editor])

  useEffect(() => {
    if (!isEditorReady(secondaryEditor) || splitView !== 'editor') return
    syncEditorNotes(secondaryEditor, secondaryDocNotes, secondaryDoc)
  }, [secondaryDoc, secondaryDocNotes, secondaryEditor, splitView])

  /* ---------------- Anchor remapping ---------------- */

  useEffect(() => {
    if (!isEditorReady(editor)) return

    const handler = ({ transaction }) => {
      if (!isEditorReady(editor)) return
      if (!transaction.docChanged) return
      // Loading a document replaces the whole doc in one transaction. Mapping
      // through that would land every note at position 0.
      if (isPaneLoading('primary')) return

      const existingNotes = getNotesForDoc(currentDoc)
      const hasQuoteNotes = existingNotes.some(note => note.type === 'quote')
      if (!hasQuoteNotes) return

      const mapping = transaction.mapping

      const updated = existingNotes
        .map(note => {
          if (note.type !== 'quote') return note

          const newFrom = mapping.map(note.from)
          const newTo = mapping.map(note.to)

          if (newFrom >= newTo) return null

          return {
            ...note,
            from: newFrom,
            to: newTo,
            anchor: editor.state.doc.textBetween(newFrom, newTo),
          }
        })
        .filter(Boolean)

      if (areNoteArraysEqual(existingNotes, updated)) {
        return
      }

      setNotesForDoc(currentDoc, updated)

      // A note whose range collapsed has lost what it was about and is gone from
      // `updated`. Naming it separately is what lets the shell tell "deleted" apart
      // from "never sent" without diffing two sets it may only have half of.
      const survivingIds = new Set(updated.map(note => note.id))
      documentSurface.publishNotesRemapped({
        docPath: currentDoc,
        notes: updated,
        droppedNoteIds: existingNotes
          .filter(note => note.type === 'quote' && !survivingIds.has(note.id))
          .map(note => note.id),
      })
    }

    editor.on('transaction', handler)
    return () => {
      if (!editor.isDestroyed) editor.off('transaction', handler)
    }

  }, [currentDoc, editor, getNotesForDoc, isPaneLoading, setNotesForDoc])
}
