/**
 * useEntryOperations — rename, move, delete and duplicate, without losing the last save.
 *
 * The order is the whole point (see lib/entryOperations.ts for why it matters):
 *
 *   1. let go of every open document the entry touches — synchronously, so the panes'
 *      teardown flushes run now and queue their final writes at the paths they had
 *   2. wait for those writes, by queueing behind them on each document's lock
 *   3. do the disk operation
 *   4. put everything back at the new paths: panes, tabs, notes, versions
 *
 * Step 1 closing the pane and step 4 reopening it means the editor reloads the
 * document from disk under its new name. That is a real reload, and it is correct:
 * the text on disk is the text the flush just wrote.
 *
 * Also handles `createEntry` and the entry commands, because they need
 * the same state and the same refresh.
 */
import { useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'

import { documentSurface } from '../bridge'
import { withDocLock } from '../lib/docLock'
import { createFolder } from '../lib/FileSystem'
import { createDocumentOfKind, nameForKind } from '../lib/createDocument'
import { getDocKind, stripDocSuffix } from '../lib/docKind'
import { followMovedDoc } from '../lib/map/mapLinks'
import {
  deleteEntry,
  duplicateEntry,
  entryOperationsOnDisk as disk,
  moveEntry,
  remapKeys,
  remapPath,
  renameEntry,
  setEntryOperations,
  touches,
} from '../lib/entryOperations'

const joinTreePath = (folder, name) => (folder ? `${folder}/${name}` : name)

export function useEntryOperations({
  projectName,
  currentDoc,
  secondaryDoc,
  setActiveDoc,
  setCurrentDoc,
  setNotesByDoc,
  setSecondaryDoc,
  setSplitView,
  setTabs,
  setVersionsState,
  refreshFilesRef,
  openDocInTab,
}) {
  // The operations are registered once and read the latest state through here. A ref
  // written in an effect, not during render — the React Compiler rejects the latter.
  const stateRef = useRef({ projectName, currentDoc, secondaryDoc, openDocInTab })
  useEffect(() => {
    stateRef.current = { projectName, currentDoc, secondaryDoc, openDocInTab }
  }, [projectName, currentDoc, secondaryDoc, openDocInTab])

  useEffect(() => {
    /** Steps 1–4 around one disk operation that resolves to the entry's next path. */
    const relocate = async (projectNameArg, entryPath, type, operation) => {
      const { currentDoc: primary, secondaryDoc: secondary } = stateRef.current
      const closePrimary = touches(primary, entryPath, type)
      const closeSecondary = touches(secondary, entryPath, type)

      // 1. Let go, now. flushSync commits synchronously and runs the panes' effect
      //    cleanups before returning, which is where their autosaves flush.
      if (closePrimary || closeSecondary) {
        flushSync(() => {
          if (closePrimary) setCurrentDoc('')
          if (closeSecondary) setSecondaryDoc(null)
        })
      }

      // 2. A flush may still be between its debounce and its write call; one task
      //    lets it get into the lock queue, and queueing behind it waits it out.
      await new Promise((resolve) => setTimeout(resolve, 0))
      await Promise.all(
        [closePrimary && primary, closeSecondary && secondary]
          .filter(Boolean)
          .map((docPath) => withDocLock(projectNameArg, docPath, () => {}))
      )

      // 3.
      let nextPath = null
      let failed = false
      try {
        nextPath = await operation()
      } catch (error) {
        console.error('[entryOperations] failed:', error)
        failed = true
      }

      // 4. A failed operation left the entry where it was, so it reopens where it was.
      const target = failed || nextPath === undefined ? entryPath : nextPath
      const map = (docPath) => {
        const mapped = remapPath(docPath, entryPath, target, type)
        return mapped === undefined ? docPath : mapped
      }

      if (closePrimary) {
        const reopened = map(primary)
        setCurrentDoc(reopened || '')
        setActiveDoc(reopened || '')
      }
      if (closeSecondary) {
        const reopened = map(secondary)
        setSecondaryDoc(reopened || null)
        if (!reopened) setSplitView(null)
      }
      setTabs((prev) => prev.flatMap((tab) => {
        const mapped = remapPath(tab.docPath, entryPath, target, type)
        if (mapped === undefined) return [tab]
        return mapped ? [{ ...tab, docPath: mapped }] : []
      }))
      setNotesByDoc((prev) => remapKeys(prev, entryPath, target, type))
      setVersionsState((prev) => remapKeys(prev, entryPath, target, type))

      await refreshFilesRef.current?.()
      return failed ? null : nextPath
    }

    // Maps link to documents by path; a rename or move takes the links with it.
    const followed = async (projectNameArg, entryPath, type, nextPath) => {
      if (nextPath) await followMovedDoc(projectNameArg, entryPath, nextPath, type)
      return nextPath
    }

    const operations = {
      renameEntry: async (projectNameArg, entryPath, newName, type = 'file') =>
        followed(projectNameArg, entryPath, type, await relocate(projectNameArg, entryPath, type,
          () => disk.renameEntry(projectNameArg, entryPath, newName, type))),

      moveEntry: async (projectNameArg, entryPath, targetFolder, type = 'file') =>
        followed(projectNameArg, entryPath, type, await relocate(projectNameArg, entryPath, type,
          () => disk.moveEntry(projectNameArg, entryPath, targetFolder, type))),

      deleteEntry: async (projectNameArg, entryPath, type = 'file') => {
        await relocate(projectNameArg, entryPath, type, async () => {
          await disk.deleteEntry(projectNameArg, entryPath, type)
          return null
        })
      },

      // Nothing open is touched by a copy, so this is only the disk and a refresh.
      duplicateEntry: async (projectNameArg, entryPath) => {
        const copy = await disk.duplicateEntry(projectNameArg, entryPath)
        await refreshFilesRef.current?.()
        return copy
      },
    }

    return setEntryOperations(operations)
  }, [refreshFilesRef, setActiveDoc, setCurrentDoc, setNotesByDoc, setSecondaryDoc, setSplitView, setTabs, setVersionsState])

  /* ---------------- the entry commands ---------------- */

  useEffect(() => {
    const project = () => stateRef.current.projectName
    const open = (docPath) => stateRef.current.openDocInTab?.(docPath)

    const offs = [
      documentSurface.onCommand('createEntry', async ({ parentFolder, name, kind }) => {
        const projectNameArg = project()
        if (!projectNameArg || !String(name || '').trim()) return
        if (kind === 'folder') {
          await createFolder(projectNameArg, joinTreePath(parentFolder, String(name).trim()))
          await refreshFilesRef.current?.()
          return
        }
        // The suffix follows the kind, never the typed name — the same rule the page's
        // own tree applies, so "plan.canvas" as a document does not become a canvas.
        const tree = nameForKind(name, kind)
        if (!stripDocSuffix(tree)) return
        const path = joinTreePath(parentFolder, tree)
        await createDocumentOfKind(projectNameArg, path, kind)
        await refreshFilesRef.current?.()
        open(path)
      }),

      documentSurface.onCommand('renameEntry', ({ path, isFolder, newName }) => {
        const projectNameArg = project()
        const typed = String(newName || '').trim()
        // A file keeps its kind through a rename; a folder takes the name as typed.
        const name = isFolder ? typed : nameForKind(typed, getDocKind(path))
        if (!projectNameArg || !stripDocSuffix(name)) return
        void renameEntry(projectNameArg, path, name, isFolder ? 'folder' : 'file')
      }),

      documentSurface.onCommand('moveEntry', ({ path, isFolder, targetFolder }) => {
        const projectNameArg = project()
        if (!projectNameArg) return
        void moveEntry(projectNameArg, path, targetFolder, isFolder ? 'folder' : 'file')
      }),

      documentSurface.onCommand('deleteEntry', ({ path, isFolder }) => {
        const projectNameArg = project()
        if (!projectNameArg) return
        void deleteEntry(projectNameArg, path, isFolder ? 'folder' : 'file')
      }),

      documentSurface.onCommand('duplicateEntry', async ({ path }) => {
        const projectNameArg = project()
        if (!projectNameArg) return
        const copy = await duplicateEntry(projectNameArg, path)
        if (copy) open(copy)
      }),
    ]
    return () => { for (const off of offs) off() }
  }, [refreshFilesRef])
}
