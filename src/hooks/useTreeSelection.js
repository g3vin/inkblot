/**
 * useTreeSelection — rows of the file tree chosen together (⌘-click, ⇧-click;
 * treeSelection.js) and what can be done to them at once: delete, move into a folder,
 * or put in a new folder named in place.
 *
 * A single row is only the last one clicked: the tree marks a selection once it holds
 * more than one (`multi`). The selection empties when the project changes, loses
 * whatever was deleted or moved away, and follows a document opened some other way.
 * The context menu asks for an action with `filetree:selection`.
 *
 * `rename` holds FileTree's rename setters, for the new folder a grouping names.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFolder } from '../lib/FileSystem'
import { deleteEntries, moveEntries, topmostEntries } from '../lib/entryOperations'
import { isEntryEmpty } from '../lib/emptiness'
import { getParentPath, moveInOrder, remapOrderForFolder } from '../lib/fileTreeOrder'
import { allEntryIds, clickRow, entryId, entryOf, pruneSelection } from '../lib/treeSelection'
import { FILETREE_SELECTION } from '../lib/appEvents'

const NO_SELECTION = { selection: new Set(), anchor: null }

/** The folder at `path` in a tree, or null. */
const folderAt = (node, path) => {
  if (node.type === 'folder' && node.path === path) return node
  for (const child of node.children || []) {
    const found = child.type === 'folder' && (path === child.path || path.startsWith(`${child.path}/`)) ? folderAt(child, path) : null
    if (found) return found
  }
  return null
}

export function useTreeSelection({ projectName, activeDoc, orderedRoot, visibleIds, updateOrder, expandPath, refreshTree, rename }) {
  const { setRenamingEntry, setRenameValue } = rename
  // The rows chosen together, by entry id, and the anchor a ⇧-click runs from. A
  // single row is only the last one clicked: the tree marks a selection once it
  // holds more than one.
  const [picked, setPicked] = useState(() => (activeDoc ? { selection: new Set([`file:${activeDoc}`]), anchor: `file:${activeDoc}` } : NO_SELECTION))
  const { selection } = picked
  const multi = selection.size > 1

  // A project switched to starts with nothing chosen.
  const [pickedFor, setPickedFor] = useState(projectName)
  if (pickedFor !== projectName) {
    setPickedFor(projectName)
    setPicked(NO_SELECTION)
  }

  // Every entry in the tree's order.
  const orderedIds = useMemo(() => allEntryIds(orderedRoot), [orderedRoot])

  // What was deleted or moved away leaves the selection.
  const presentIds = useMemo(() => new Set(orderedIds), [orderedIds])
  const kept = pruneSelection(selection, presentIds)
  if (kept !== selection) setPicked({ selection: kept, anchor: kept.has(picked.anchor) ? picked.anchor : null })

  // A document opened some other way (the search, a link) becomes the row a ⌘- or
  // ⇧-click starts from, unless several rows are chosen.
  const [followedDoc, setFollowedDoc] = useState(activeDoc)
  if (followedDoc !== activeDoc) {
    setFollowedDoc(activeDoc)
    if (!multi) setPicked(activeDoc ? { selection: new Set([`file:${activeDoc}`]), anchor: `file:${activeDoc}` } : NO_SELECTION)
  }

  const chooseRow = (id, keys) => setPicked((current) => clickRow(current, id, visibleIds, keys))

  /** The chosen entries in the tree's order, without any a chosen folder already holds. */
  const selectedEntries = useCallback(
    () => topmostEntries(orderedIds.filter((id) => selection.has(id)).map(entryOf)),
    [orderedIds, selection],
  )

  // Entries moved into `target` go to the end of its order, in the order they came.
  const orderMovedInto = useCallback((moved, target) => {
    updateOrder((orderState) => {
      let next = orderState
      for (const entry of moved) {
        if (entry.type === 'folder') next = remapOrderForFolder(next, entry.path, entry.nextPath)
        moveInOrder(next, `${entry.type}:${entry.nextPath}`, getParentPath(entry.path), target)
      }
      return next
    })
  }, [updateOrder])

  const deleteSelection = useCallback(async () => {
    const entries = selectedEntries()
    if (!entries.length || !projectName) return
    const blank = (await Promise.all(entries.map((entry) => isEntryEmpty(projectName, entry.path, entry.type)))).every(Boolean)
    if (!blank) {
      const what = entries.length === 1 ? `"${entries[0].path.split('/').pop()}"` : `${entries.length} items`
      const { confirm } = await import('@tauri-apps/plugin-dialog')
      const confirmed = await confirm(`Delete ${what}?`).catch(() => false)
      if (!confirmed) return
    }
    await deleteEntries(projectName, entries)
    setPicked(NO_SELECTION)
    await refreshTree()
  }, [projectName, refreshTree, selectedEntries])

  const moveSelection = useCallback(async (target) => {
    const entries = selectedEntries()
    if (!entries.length || !projectName) return
    orderMovedInto(await moveEntries(projectName, entries, target), target)
    await refreshTree()
    expandPath(target)
  }, [expandPath, orderMovedInto, projectName, refreshTree, selectedEntries])

  // A new folder where the first chosen entry was, holding them all, named in place.
  const groupSelection = useCallback(async () => {
    const entries = selectedEntries()
    if (!entries.length || !projectName) return
    const parent = getParentPath(entries[0].path)
    const taken = new Set((folderAt(orderedRoot, parent)?.children || []).map((child) => child.name))
    let name = 'New folder'
    for (let n = 2; taken.has(name); n += 1) name = `New folder ${n}`
    const path = parent ? `${parent}/${name}` : name

    await createFolder(projectName, path)
    updateOrder((orderState) => {
      const list = (orderState[parent] || []).filter((id) => id !== `folder:${path}`)
      const at = list.indexOf(entryId(entries[0]))
      list.splice(at < 0 ? list.length : at, 0, `folder:${path}`)
      orderState[parent] = list
      return orderState
    })
    orderMovedInto(await moveEntries(projectName, entries, path), path)
    setPicked({ selection: new Set([`folder:${path}`]), anchor: `folder:${path}` })
    await refreshTree()
    expandPath(path)
    setRenamingEntry({ path, type: 'folder', oldName: name, parent })
    setRenameValue(name)
  }, [expandPath, orderMovedInto, orderedRoot, projectName, refreshTree, selectedEntries, setRenameValue, setRenamingEntry, updateOrder])

  // The context menu's actions on the selection.
  useEffect(() => {
    const handler = (event) => {
      const { action, target } = event?.detail || {}
      if (action === 'delete') void deleteSelection()
      else if (action === 'group') void groupSelection()
      else if (action === 'move' && typeof target === 'string') void moveSelection(target)
    }
    window.addEventListener(FILETREE_SELECTION, handler)
    return () => window.removeEventListener(FILETREE_SELECTION, handler)
  }, [deleteSelection, groupSelection, moveSelection])

  const selectAll = useCallback(() => {
    setPicked({ selection: new Set(visibleIds), anchor: visibleIds[0] ?? null })
  }, [visibleIds])
  const clearSelection = useCallback(() => {
    setPicked(activeDoc ? { selection: new Set([`file:${activeDoc}`]), anchor: `file:${activeDoc}` } : NO_SELECTION)
  }, [activeDoc])

  // On the list: ⌘A chooses every row showing, Escape lets the selection go, ⌘⌫
  // deletes what is chosen. Only the list's own keys: a rename box keeps its own.
  const onListKeyDown = (event) => {
    if (event.target !== event.currentTarget) return
    const mod = event.metaKey || event.ctrlKey
    if (mod && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      selectAll()
    } else if (event.key === 'Escape' && multi) {
      event.preventDefault()
      clearSelection()
    } else if (mod && (event.key === 'Backspace' || event.key === 'Delete') && selection.size) {
      event.preventDefault()
      void deleteSelection()
    }
  }

  return { selection, multi, setPicked, chooseRow, selectedEntries, deleteSelection, groupSelection, selectAll, clearSelection, onListKeyDown }
}
