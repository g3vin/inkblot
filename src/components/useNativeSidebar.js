/**
 * useNativeSidebar — the page's side of a right sidebar the shell draws.
 *
 * The sidebar's state stays here: notes, the clipboard history and workbench tiles are
 * React state, and versions live in the document file this page's autosave rewrites
 * under its own lock. So this does two things, and only while the shell owns the
 * sidebar (`nativeOwns('rightSidebar')`):
 *
 *  - **publishes** that state whenever it changes — whole lists, coalesced per frame
 *  - **applies** the shell's edits with the helpers the React panels use, so a note
 *    edited natively gets the same `touchNote` timestamps, a restore takes the same
 *    safety checkpoint, and a tile finds its word the same way
 *
 * Every handler reads through `latest`, because commands arrive whenever they arrive
 * and must act on the state as it is then, not as it was when the effect ran.
 */
import { useEffect, useRef } from 'react'
import { documentSurface, editorRegistry } from '../bridge'
import { claimEndedSelectionDrag } from '../bridge/recentSelectionDrag'
import { collectNoteBranchIds, touchNote } from '../lib/noteUtils'
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

/** The page's tile, as the protocol describes one. */
const toWireTile = (tile) => ({
  id: String(tile.id),
  type: ['synonym', 'definition', 'rhyme'].includes(tile.type) ? tile.type : 'pos',
  text: String(tile.text || ''),
  ...(tile.doc ? { doc: tile.doc } : {}),
})

const toWireClipboardEntry = (entry) => ({
  id: String(entry.id),
  text: String(entry.text || ''),
  docName: String(entry.docName || ''),
  timestamp: String(entry.timestamp || ''),
})

export function useNativeSidebar({
  enabled,
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

  /* ---------------- publishing ---------------- */

  const activeNotes = notesByDoc?.[activeDoc]
  useEffect(() => {
    if (!enabled || !activeDoc) return
    documentSurface.publishNotesChanged({ docPath: activeDoc, notes: activeNotes || [] })
  }, [enabled, activeDoc, activeNotes])

  useEffect(() => {
    if (!enabled) return
    documentSurface.publishClipboardChanged({ entries: (clipboardHistory || []).map(toWireClipboardEntry) })
  }, [enabled, clipboardHistory])

  useEffect(() => {
    if (!enabled) return
    documentSurface.publishTilesChanged({ tiles: (tiles || []).map(toWireTile) })
  }, [enabled, tiles])

  // FileSystem.js announces every history write on window; the shell re-reads the
  // history from disk through the core, so all it needs is which document.
  useEffect(() => {
    if (!enabled) return undefined
    const onVersionsChanged = (event) => {
      const detail = event?.detail || {}
      if (detail.projectName && detail.projectName !== latest.current.projectName) return
      if (detail.docName) documentSurface.publishVersionsChanged({ docPath: detail.docName })
    }
    window.addEventListener('versions:changed', onVersionsChanged)
    return () => window.removeEventListener('versions:changed', onVersionsChanged)
  }, [enabled])

  /* ---------------- applying the shell's edits ---------------- */

  useEffect(() => {
    if (!enabled) return undefined
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
        const { collapsedChildren, ...changes } = patch || {}
        state().setNotesForDoc?.(docPath, (notes) => notes.map((note) => {
          if (note.id !== noteId) return note
          // Folding a branch is a view change, not an edit: it does not touch the note's
          // timestamp, exactly as in NotesPanel.
          const folded = collapsedChildren === undefined ? note : { ...note, collapsedChildren }
          return Object.keys(changes).length ? touchNote(folded, changes) : folded
        }))
      }),

      documentSurface.onCommand('removeNote', ({ docPath, noteId }) => {
        state().setNotesForDoc?.(docPath, (notes) => {
          const doomed = new Set(collectNoteBranchIds(notes, noteId))
          return notes.filter((note) => !doomed.has(note.id))
        })
      }),

      documentSurface.onCommand('jumpToNote', ({ docPath, noteId }) => {
        const note = (state().notesByDoc?.[docPath] || []).find((entry) => entry.id === noteId)
        if (note) state().openSearchTarget?.({ docName: docPath, note })
      }),

      /* clipboard */
      documentSurface.onCommand('clipboardDrop', ({ text }) => {
        const selection = claimEndedSelectionDrag(text)
        state().onDropToClipboard?.({ text, selection, fromEditorSelection: Boolean(selection) })
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
  }, [enabled])
}
