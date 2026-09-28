/**
 * useSidebarCommands — the inspector's edits, as commands.
 *
 * The sidebar's state stays here: notes, the clipboard history and workbench tiles are
 * React state, and versions live in the document file this page's autosave rewrites
 * under its own lock. The panels and the toolbar edit them by command, and this
 * applies each with the helpers the React panels use, so a note edited from anywhere
 * gets the same `touchNote` timestamps, a restore takes the same safety checkpoint,
 * and a tile finds its word the same way.
 *
 * Every handler reads through `latest`, because commands arrive whenever they arrive
 * and must act on the state as it is then, not as it was when the effect ran.
 */
import { useEffect, useRef } from 'react'
import { documentSurface, editorRegistry } from '../bridge'
import { collectNoteBranchIds, createFreeNote, touchNote } from '../lib/noteUtils'
import {
  copyVersionAsDocument,
  deleteVersion,
  findVersion,
  renameVersion,
  restoreVersion,
  snapshotVersion,
} from '../lib/versionActions'
import { editorForTile, replaceTileWord, selectTileWord } from '../lib/workbenchActions'
import { isEditorReady } from '../lib/editorUtils'

export function useSidebarCommands({
  projectName,
  activeDoc,
  currentDoc,
  secondaryDoc,
  editor,
  secondaryEditor,
  notesByDoc,
  setNotesForDoc,
  clipboardHistory,
  clearClipboardHistory,
  onDropToClipboard,
  onMoveClipboardEntryToEditor,
  tiles,
  setTiles,
  openCompare,
  refreshFiles,
  onOpenDocInTab,
  openSearchTarget,
}) {
  const latest = useRef({})
  useEffect(() => {
    latest.current = {
      projectName, activeDoc, currentDoc, secondaryDoc, editor, secondaryEditor, notesByDoc,
      setNotesForDoc, clipboardHistory, clearClipboardHistory, onDropToClipboard,
      onMoveClipboardEntryToEditor, tiles, setTiles, openCompare, refreshFiles, onOpenDocInTab,
      openSearchTarget,
    }
  })

  /* ---------------- applying edits ---------------- */

  useEffect(() => {
    const state = () => latest.current

    /** The live editor holding `docPath`, for the actions that need the current text. */
    const editorFor = (docPath) => {
      const { currentDoc: primary, secondaryDoc: secondary, editor: e, secondaryEditor: s } = state()
      if (docPath && docPath === secondary && isEditorReady(s)) return s
      if (docPath && docPath === primary && isEditorReady(e)) return e
      return null
    }

    const offs = [
      /* notes */
      documentSurface.onCommand('updateNote', ({ docPath, noteId, patch }) => {
        const { collapsedChildren, previewLayout, previewSize, ...changes } = patch || {}
        state().setNotesForDoc?.(docPath, (notes) => notes.map((note) => {
          if (note.id !== noteId) return note
          // Folding a branch or moving a hover card is a view change, not an edit: it
          // does not touch the note's timestamp, exactly as NotesPanel and
          // NoteHoverPreview did.
          const viewed = {
            ...note,
            ...(collapsedChildren === undefined ? {} : { collapsedChildren }),
            ...(previewLayout ? { previewLayout } : {}),
            ...(previewSize ? { previewSize } : {}),
          }
          return Object.keys(changes).length ? touchNote(viewed, changes) : viewed
        }))
      }),

      documentSurface.onCommand('removeNote', ({ docPath, noteId }) => {
        state().setNotesForDoc?.(docPath, (notes) => {
          const doomed = new Set(collectNoteBranchIds(notes, noteId))
          return notes.filter((note) => !doomed.has(note.id))
        })
      }),

      // NoteHoverPreview's "add reply": an empty free note under the parent, placed
      // where the next reply goes by default.
      documentSurface.onCommand('addReply', ({ docPath, parentNoteId }) => {
        state().setNotesForDoc?.(docPath, (notes) => {
          const parent = notes.find((note) => note.id === parentNoteId)
          if (!parent) return notes
          // A zero layout means "not placed yet": the shell hangs the reply below its
          // parent, clear of the card as drawn — which only the shell knows the size of.
          const reply = touchNote(createFreeNote(parent.color), {
            parentNoteId,
            previewLayout: { offsetX: 0, offsetY: 0 },
            collapsedChildren: false,
          })
          return [...notes, reply]
        })
      }),

      documentSurface.onCommand('jumpToNote', ({ docPath, noteId }) => {
        const note = (state().notesByDoc?.[docPath] || []).find((entry) => entry.id === noteId)
        if (note) state().openSearchTarget?.({ docName: docPath, note })
      }),

      /* clipboard */
      documentSurface.onCommand('clipboardDrop', ({ text }) => {
        state().onDropToClipboard?.({ text })
      }),

      documentSurface.onCommand('removeClipboardEntries', ({ ids }) => {
        if (!ids) {
          state().clearClipboardHistory?.()
          return
        }
        for (const id of ids) state().onMoveClipboardEntryToEditor?.(id)
      }),

      documentSurface.onCommand('insertClipboardEntry', ({ id, target }) => {
        const entry = (state().clipboardHistory || []).find((item) => String(item.id) === id)
        const resolved = editorRegistry.resolve(target) || editorRegistry.active()
        const view = resolved?.editor?.view
        if (!entry?.text || !view) return
        view.focus()
        // Through the editor's plain-text paste, as a drop of plain text would be.
        if (typeof view.pasteText === 'function') view.pasteText(entry.text)
        else view.dispatch(view.state.tr.insertText(entry.text))
        state().onMoveClipboardEntryToEditor?.(entry.id)
      }),

      /* workbench */
      documentSurface.onCommand('removeTiles', ({ ids }) => {
        if (!ids) {
          state().setTiles?.([])
          return
        }
        const doomed = new Set(ids)
        state().setTiles?.((prev) => prev.filter((tile) => !doomed.has(String(tile.id))))
      }),

      documentSurface.onCommand('replaceTileWord', ({ id, word }) => {
        const { tiles: current, editor: e, secondaryEditor: s, secondaryDoc: sd, setTiles: set } = state()
        const tile = (current || []).find((item) => String(item.id) === id)
        if (!tile) return
        const updated = replaceTileWord(editorForTile(tile, { editor: e, secondaryEditor: s, secondaryDoc: sd }), tile, word)
        if (updated) set?.((prev) => prev.map((item) => (item.id === tile.id ? updated : item)))
      }),

      documentSurface.onCommand('selectTileWord', ({ id }) => {
        const { tiles: current, editor: e, secondaryEditor: s, secondaryDoc: sd } = state()
        const tile = (current || []).find((item) => String(item.id) === id)
        if (tile) selectTileWord(editorForTile(tile, { editor: e, secondaryEditor: s, secondaryDoc: sd }), tile)
      }),

      /* version history */
      documentSurface.onCommand('versionAction', async ({ docPath, action, versionId }) => {
        const { projectName: project } = state()
        if (!project || !docPath) return
        const editorForDoc = editorFor(docPath)

        if (action === 'snapshot') {
          await snapshotVersion({ projectName: project, docName: docPath, editor: editorForDoc })
          return
        }
        if (!versionId) return
        if (action === 'compare') {
          state().openCompare?.(docPath, versionId, 'current')
          return
        }
        if (action === 'delete') {
          await deleteVersion({ projectName: project, docName: docPath, versionId })
          return
        }

        const version = await findVersion({ projectName: project, docName: docPath, versionId })
        if (!version) return
        if (action === 'restore') {
          await restoreVersion({ projectName: project, docName: docPath, editor: editorForDoc, version })
        } else if (action === 'makeCopy') {
          const copy = await copyVersionAsDocument({ projectName: project, docName: docPath, version })
          if (copy) {
            await state().refreshFiles?.()
            state().onOpenDocInTab?.(copy)
          }
        }
      }),

      documentSurface.onCommand('renameVersion', async ({ docPath, versionId, name }) => {
        const { projectName: project } = state()
        if (!project) return
        await renameVersion({ projectName: project, docName: docPath, versionId, name })
      }),

      /* search */
      documentSurface.onCommand('revealSearchResult', ({ docPath, anchor, nodeId, noteId }) => {
        const note = noteId
          ? (state().notesByDoc?.[docPath] || []).find((entry) => entry.id === noteId)
          : null
        state().openSearchTarget?.({
          docName: docPath,
          ...(anchor ? { anchor: anchor.text, from: anchor.from, to: anchor.to } : {}),
          ...(nodeId ? { nodeId } : {}),
          ...(note ? { note } : {}),
          ...(!anchor && !nodeId && !note ? { skipJump: true } : {}),
        })
      }),
    ]
    return () => { for (const off of offs) off() }
  }, [])
}
