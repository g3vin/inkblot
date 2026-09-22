/**
 * useFileTreeDrag — reordering and reparenting entries by dragging.
 *
 * Hand-rolled rather than HTML5 drag-and-drop: the tree drops onto targets that
 * are not its own DOM (the canvas surface, the tab dock), and Tauri swallows the
 * native drop event, so the drag is tracked with pointer events and hit-tested
 * with document.elementFromPoint.
 */
import { useCallback, useEffect } from 'react'
import { moveEntry } from '../lib/FileSystem'
import { canvasSurfaceAt, dispatchCanvasDropDoc } from '../canvas/canvasEvents'
import {
  announceTreeDragEnd,
  announceTreeDragStart,
  dispatchTabDockDropDoc,
  tabDockAt,
} from '../lib/tabDockEvents'
import { getParentPath, remapOrderForFolder } from '../lib/fileTreeOrder'

export function useFileTreeDrag({
  dragInsert,
  dragInsertRef,
  dragOverFolder,
  dragOverFolderRef,
  dragPointRef,
  manualDragActiveRef,
  manualDragRef,
  order,
  projectName,
  refreshTree,
  setDragInsert,
  setDragOverFolder,
  setDragOverPath,
  setDragPreview,
  setDragSourceId,
  setIsDragging,
  updateOrder,
}) {

  const moveOrderItem = useCallback((itemId, fromFolder, toFolder, targetIndex) => {
    updateOrder(orderState => {
      const fromKey = fromFolder || ''
      const toKey = toFolder || ''

      const fromList = [...(orderState[fromKey] || [])]
      const fromIndex = fromList.indexOf(itemId)
      const filtered = fromList.filter(id => id !== itemId)
      orderState[fromKey] = filtered

      const toList = [...(orderState[toKey] || [])].filter(id => id !== itemId)
      let requestedIndex = typeof targetIndex === 'number'
        ? targetIndex
        : toList.length

      if (fromKey === toKey && typeof targetIndex === 'number' && fromIndex !== -1 && fromIndex < targetIndex) {
        requestedIndex -= 1
      }

      const insertIndex = Math.max(0, Math.min(requestedIndex, toList.length))

      toList.splice(insertIndex, 0, itemId)
      orderState[toKey] = toList

      return orderState
    })
  }, [updateOrder])

  // Move an entry to a target folder/index: same-folder moves only touch the
  // stored order; cross-folder moves also move the entry on disk.
  const performMove = useCallback(async ({ path, type }, targetFolder, targetIndex) => {
    const fromParent = getParentPath(path)

    if (type === 'folder' && targetFolder.startsWith(`${path}/`)) return

    let nextPath = path

    // Moving to a different folder - need filesystem operation
    if (fromParent !== targetFolder) {
      const moved = await moveEntry(projectName, path, targetFolder, type)
      if (!moved) {
        await refreshTree()
        return
      }
      nextPath = moved
      if (type === 'folder') {
        updateOrder(orderState => remapOrderForFolder(orderState, path, nextPath))
      }
      moveOrderItem(`${type}:${nextPath}`, fromParent, targetFolder, targetIndex)
      await refreshTree()
    } else {
      // Same folder reorder - just update the order, no filesystem operation needed
      moveOrderItem(`${type}:${nextPath}`, fromParent, targetFolder, targetIndex)
    }
  }, [projectName, refreshTree, moveOrderItem, updateOrder])

  const handleDrop = async (event, targetNode, targetParent) => {
    event.preventDefault()
    setDragOverPath(null)
    setDragInsert(null)
    setDragOverFolder(null)

    let data
    try {
      const raw = event.dataTransfer.getData('application/json') || event.dataTransfer.getData('text/plain')
      data = JSON.parse(raw)
    } catch {
      return
    }

    if (!data?.path || !data?.type) return
    if (data.path === targetNode?.path) return

    const useInsert = dragInsert && dragInsert.parentPath === (targetParent || '')
    const targetFolder = useInsert
      ? dragInsert.parentPath
      : (dragOverFolder && targetNode?.type === 'folder')
        ? targetNode.path
        : (targetNode?.type === 'folder' ? targetNode.path : (targetParent || ''))

    const targetIndex = useInsert
      ? dragInsert.index
      : (targetNode && targetNode.type !== 'folder'
        ? (order[targetParent || ''] || []).indexOf(`${targetNode.type}:${targetNode.path}`)
        : undefined)

    await performMove(data, targetFolder, targetIndex)
  }

  // Hit-test the pointer during a manual drag: hovering a folder's middle
  // third targets "drop into folder", the outer thirds target an insert slot
  // before/after the hovered item.
  const updateManualDrag = useCallback((clientX, clientY) => {
    const el = document.elementFromPoint(clientX, clientY)
    if (!el) return

    const item = el.closest('.file-item')
    if (item) {
      const entryType = item.getAttribute('data-entry-type')
      const entryPath = item.getAttribute('data-entry-path')
      const parentPath = item.getAttribute('data-entry-parent') || ''
      const indexAttr = item.getAttribute('data-entry-index')
      const rect = item.getBoundingClientRect()
      const offsetY = clientY - rect.top
      const beforeZone = rect.height * 0.33
      const afterZone = rect.height * 0.66
      const index = Number.isNaN(Number(indexAttr))
        ? (order[parentPath] || []).indexOf(`${entryType}:${entryPath}`)
        : Number(indexAttr)

      if (entryType === 'folder' && offsetY > beforeZone && offsetY < afterZone) {
        setDragOverFolder(entryPath)
        dragOverFolderRef.current = entryPath
        setDragInsert(null)
        dragInsertRef.current = null
        setDragOverPath(entryPath)
        return
      }

      const insertIndex = offsetY >= afterZone
        ? index + 1
        : index

      setDragOverFolder(null)
      dragOverFolderRef.current = null
      setDragOverPath(null)
      setDragInsert({ parentPath, index: insertIndex })
      dragInsertRef.current = { parentPath, index: insertIndex }
      return
    }

    const childrenContainer = el.closest('.file-children')
    if (childrenContainer) {
      // Keep the current drag insert position rather than jumping to end
      return
    }

    const list = el.closest('.file-list')
    if (list) {
      // Keep the current drag insert position rather than jumping to end
      return
    }
  }, [order, dragInsertRef, dragOverFolderRef, setDragInsert, setDragOverFolder, setDragOverPath])

  // Mouse-driven drag & drop (not HTML5 DnD): a drag arms on item mousedown
  // and activates after ~4px of movement, showing a ghost preview; mouseup
  // commits the move.
  useEffect(() => {
    const onMove = (event) => {
      const drag = manualDragRef.current
      if (!drag) return
      dragPointRef.current = { x: event.clientX, y: event.clientY }
      const dx = Math.abs(event.clientX - drag.startX)
      const dy = Math.abs(event.clientY - drag.startY)
      if (!manualDragActiveRef.current) {
        if (dx + dy < 4) return
        manualDragActiveRef.current = true
        setIsDragging(true)
        setDragSourceId(`${drag.type}:${drag.path}`)
        setDragPreview({
          x: event.clientX,
          y: event.clientY,
          name: drag.name,
          iconName: drag.iconName,
          iconFilled: drag.iconFilled,
        })
        // The tab dock opens while a document is in flight, so there is something
        // to aim at before the pointer gets there.
        announceTreeDragStart({ path: drag.path, type: drag.type })
      }
      setDragPreview((current) => current ? {
        ...current,
        x: event.clientX,
        y: event.clientY,
      } : current)
      updateManualDrag(event.clientX, event.clientY)
    }

    const onUp = async () => {
      const drag = manualDragRef.current
      if (!drag) return
      const didDrag = manualDragActiveRef.current
      const insert = dragInsertRef.current
      const folder = dragOverFolderRef.current
      const point = dragPointRef.current

      manualDragRef.current = null
      manualDragActiveRef.current = false
      dragPointRef.current = null
      setIsDragging(false)
      setDragPreview(null)
      setDragSourceId(null)
      setDragOverPath(null)
      setDragInsert(null)
      setDragOverFolder(null)
      if (didDrag) announceTreeDragEnd()

      if (!didDrag) return

      // Like the canvas drop below, a drop onto the tab dock MUST NOT fall through
      // to performMove — the tree still believes it is reordering, and would
      // silently move the document into whatever folder it was dragged over.
      if (point && drag.type === 'file') {
        const dock = tabDockAt(point.x, point.y)
        if (dock) {
          dispatchTabDockDropDoc(dock, { path: drag.path })
          return
        }
      }

      // A drop onto an open canvas adds a card there, and MUST NOT fall through to
      // performMove — the pointer never left the tree's own drag state, so the tree
      // still believes it is reordering, and would silently move the document.
      //
      // Canvases are droppable too (they render as a minimap and open on
      // double-click); the surface itself refuses a canvas dropped onto ITSELF.
      if (point && drag.type === 'file') {
        const surface = canvasSurfaceAt(point.x, point.y)
        if (surface) {
          dispatchCanvasDropDoc(surface, {
            path: drag.path,
            clientX: point.x,
            clientY: point.y,
          })
          return
        }
      }

      const targetFolder = folder || (insert ? insert.parentPath : getParentPath(drag.path))
      const targetIndex = insert ? insert.index : undefined
      await performMove({ path: drag.path, type: drag.type }, targetFolder, targetIndex)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragInsert, dragOverFolder, performMove, updateManualDrag, dragInsertRef, dragOverFolderRef, dragPointRef, manualDragActiveRef, manualDragRef, setDragInsert, setDragOverFolder, setDragOverPath, setDragPreview, setDragSourceId, setIsDragging])

  return { handleDrop, updateManualDrag }
}
