/**
 * useFileTreeDrag — reordering and reparenting entries by dragging.
 *
 * Hand-rolled rather than HTML5 drag-and-drop: the tree drops onto targets that
 * are not its own DOM (the canvas surface), and Tauri swallows the
 * native drop event, so the drag is tracked with pointer events and hit-tested
 * with document.elementFromPoint.
 *
 * A row grabbed out of a multi-selection carries the whole selection
 * (`manualDragRef.current.entries`): it goes into the tree together, keeping its order,
 * and never onto the page, whose drops take one document.
 *
 * Dropped in the tree, the ghost isn't simply taken away: it springs from under the
 * hand onto the row's new place, at the speed it was let go, and the row comes back
 * as it lands.
 */
import { useCallback, useEffect, useRef } from 'react'
import { prefersReducedMotion, releaseSpring, trackSample, velocityFrom } from '../ui/physics.js'
import { SpringValue } from '../ui/useSpring.js'
import { moveEntry } from '../lib/entryOperations'
import { canvasSurfaceAt, dispatchCanvasDropDoc } from '../canvas/canvasEvents'
import { dispatchMapDropDoc, mapSurfaceAt } from '../map/mapEvents'
import { getParentPath, moveInOrder, remapOrderForFolder } from '../lib/fileTreeOrder'
import { SPLIT_DWELL_MS, SPLIT_DWELL_TOLERANCE, splitDropTarget } from '../lib/splitDropTarget'

// What makes things in the page open on hover (a note's card, a link's preview).
const HOVER_EVENTS = ['mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'pointermove']

/**
 * While a document is carried out of the tree, the page under it is only somewhere to
 * put it: nothing there opens on hover. Stopped at the window before anything else
 * sees them. The drag itself follows `mousemove`, which is left alone.
 */
function muteHovers() {
  const stop = (event) => {
    if (event.target instanceof Element && event.target.closest('.left-sidebar')) return
    event.stopPropagation()
  }
  for (const type of HOVER_EVENTS) window.addEventListener(type, stop, true)
  return () => { for (const type of HOVER_EVENTS) window.removeEventListener(type, stop, true) }
}

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

  // Move entries to a target folder/index, one after another so each lands after the
  // last: same-folder moves only touch the stored order; cross-folder moves also move
  // the entry on disk.
  // Returns where each entry is now.
  const performMoves = useCallback(async (entries, targetFolder, targetIndex) => {
    let index = targetIndex
    let touchedDisk = false
    const placed = []
    for (const { path, type } of entries) {
      if (type === 'folder' && (targetFolder === path || targetFolder.startsWith(`${path}/`))) continue
      const fromParent = getParentPath(path)
      let nextPath = path

      if (fromParent !== targetFolder) {
        touchedDisk = true
        const moved = await moveEntry(projectName, path, targetFolder, type)
        if (!moved) continue
        nextPath = moved
        if (type === 'folder') {
          updateOrder(orderState => remapOrderForFolder(orderState, path, nextPath))
        }
      }

      let placedAt = null
      updateOrder(orderState => {
        placedAt = moveInOrder(orderState, `${type}:${nextPath}`, fromParent, targetFolder, index)
        return orderState
      })
      if (typeof index === 'number') index = placedAt + 1
      placed.push(nextPath)
    }
    if (touchedDisk) await refreshTree()
    return placed
  }, [projectName, refreshTree, updateOrder])

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

    await performMoves([data], targetFolder, targetIndex)
  }

  // Hit-test the pointer during a manual drag: hovering a folder's middle
  // third targets "drop into folder", the outer thirds target an insert slot
  // before/after the hovered item.
  const updateManualDrag = useCallback((clientX, clientY) => {
    const el = document.elementFromPoint(clientX, clientY)
    if (!el) return

    // The kept splits sit above the files, and nothing goes in among them.
    const item = el.closest('.file-item:not(.split-entry)')
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

  // A document held over the page: its side is outlined, and resting there opens the
  // split for real while the drag goes on. Moving on puts the panes back and the
  // document back under the pointer, so a wrong file costs nothing.
  const updateSplitDrag = useCallback((drag, x, y) => {
    const target = splitDropTarget()
    if (drag.type !== 'file' || !target) return
    if (drag.sprungAt) {
      if (Math.hypot(x - drag.sprungAt.x, y - drag.sprungAt.y) <= SPLIT_DWELL_TOLERANCE) return
      drag.sprungAt = null
      target.unspring()
      setDragPreview((current) => current ? { ...current, settled: false } : current)
    }
    clearTimeout(drag.dwell)
    if (!target.hover(x, y, drag.path)) return
    // Over the page the document is going there, not to a place in the tree.
    dragInsertRef.current = null
    dragOverFolderRef.current = null
    setDragInsert(null)
    setDragOverFolder(null)
    setDragOverPath(null)
    drag.dwell = setTimeout(() => {
      if (manualDragRef.current !== drag) return
      const point = dragPointRef.current
      if (!point || !splitDropTarget()?.spring(point.x, point.y, drag.path)) return
      drag.sprungAt = { ...point }
      setDragPreview((current) => current ? { ...current, settled: true } : current)
    }, SPLIT_DWELL_MS)
  }, [dragInsertRef, dragOverFolderRef, dragPointRef, manualDragRef, setDragInsert, setDragOverFolder, setDragOverPath, setDragPreview])

  /**
   * Spring the ghost from under the hand onto the row at `path` (or, if it isn't
   * showing, the folder it went into), then take it away. Its left and top are
   * written straight to it: framer owns its transform, and React needn't know.
   */
  // The ghost's landing under way: a new drag takes the ghost back from it.
  const landingRef = useRef(null)
  const landGhost = (path, folder, velocity, done) => {
    const ghost = document.querySelector('.file-tree-drag-ghost')
    const springs = []
    let frame = 0
    landingRef.current = () => {
      cancelAnimationFrame(frame)
      springs.forEach((spring) => spring.stop())
      if (ghost) ghost.style.left = ghost.style.top = ''
      landingRef.current = null
    }
    // After the move has been drawn, so the row is in its new place.
    frame = requestAnimationFrame(() => {
      const row = document.querySelector(`[data-entry-path="${CSS.escape(path)}"]`)
        ?? (folder ? document.querySelector(`[data-entry-path="${CSS.escape(folder)}"]`) : null)
      if (!ghost || !row || prefersReducedMotion()) {
        done()
        return
      }
      const from = ghost.getBoundingClientRect()
      let arrived = 0
      const land = () => {
        arrived += 1
        if (arrived < 2) return
        landingRef.current = null
        done()
      }
      const axis = (side, speed) => {
        const value = new SpringValue(from[side], {
          spring: releaseSpring(Math.hypot(velocity.x, velocity.y)),
          precision: 0.5,
          onChange: (current) => {
            ghost.style[side] = `${current}px`
            // The row is still moving into place as the drop slot closes: follow it.
            const target = row.getBoundingClientRect()[side]
            if (Math.abs(target - value.target) > 0.5) value.set(target)
          },
          onRest: land,
        })
        springs.push(value)
        value.set(row.getBoundingClientRect()[side], { velocity: speed })
        // Already there, it never sets off, so it never comes to rest either.
        if (!value.moving) land()
      }
      axis('left', velocity.x)
      axis('top', velocity.y)
    })
  }

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
      drag.samples = trackSample(drag.samples ?? [], { t: event.timeStamp, x: event.clientX, y: event.clientY })
      if (!manualDragActiveRef.current) {
        if (dx + dy < 4) return
        manualDragActiveRef.current = true
        // The last drop's ghost may still be landing: this drag has it now.
        landingRef.current?.()
        drag.unmuteHovers = muteHovers()
        setIsDragging(true)
        setDragSourceId(`${drag.type}:${drag.path}`)
        setDragPreview({
          x: event.clientX,
          y: event.clientY,
          name: drag.name,
          iconName: drag.iconName,
          iconFilled: drag.iconFilled,
          box: drag.box,
          ids: drag.entries?.map((entry) => `${entry.type}:${entry.path}`) ?? null,
        })
      }
      setDragPreview((current) => current ? {
        ...current,
        x: event.clientX,
        y: event.clientY,
      } : current)
      updateManualDrag(event.clientX, event.clientY)
      if (!drag.entries) updateSplitDrag(drag, event.clientX, event.clientY)
    }

    const onUp = async (event) => {
      const drag = manualDragRef.current
      if (!drag) return
      // Measured now, at the release, not after the move has been made.
      const velocity = velocityFrom(drag.samples, undefined, event.timeStamp)
      const didDrag = manualDragActiveRef.current
      const insert = dragInsertRef.current
      const folder = dragOverFolderRef.current
      const point = dragPointRef.current
      clearTimeout(drag.dwell)
      drag.unmuteHovers?.()

      manualDragRef.current = null
      manualDragActiveRef.current = false
      dragPointRef.current = null
      setIsDragging(false)
      setDragOverPath(null)
      setDragInsert(null)
      setDragOverFolder(null)
      // Put the ghost away, unless another drag has picked it up since.
      const putDown = () => {
        if (manualDragActiveRef.current) return
        setDragPreview(null)
        setDragSourceId(null)
      }

      if (!didDrag) {
        putDown()
        return
      }
      splitDropTarget()?.clear()

      // A drop onto an open canvas adds a card there, and MUST NOT fall through to
      // performMoves — the pointer never left the tree's own drag state, so the tree
      // still believes it is reordering, and would silently move the document.
      //
      // Canvases are droppable too (they render as a minimap and open on
      // double-click); the surface itself refuses a canvas dropped onto ITSELF.
      if (point && drag.type === 'file' && !drag.entries) {
        // Onto a side of the page: the document in a split there (or the split it
        // opened while held stays).
        if (splitDropTarget()?.drop(point.x, point.y, drag.path)) {
          putDown()
          return
        }
        const surface = canvasSurfaceAt(point.x, point.y)
        if (surface) {
          putDown()
          dispatchCanvasDropDoc(surface, {
            path: drag.path,
            clientX: point.x,
            clientY: point.y,
          })
          return
        }
        // Onto an open map: a pin for a place, a traveler for a character. Same rule —
        // it must not fall through to performMoves.
        const mapSurface = mapSurfaceAt(point.x, point.y)
        if (mapSurface) {
          putDown()
          dispatchMapDropDoc(mapSurface, { path: drag.path, clientX: point.x, clientY: point.y })
          return
        }
      }

      const targetFolder = folder || (insert ? insert.parentPath : getParentPath(drag.path))
      const targetIndex = insert ? insert.index : undefined
      const placed = await performMoves(drag.entries ?? [{ path: drag.path, type: drag.type }], targetFolder, targetIndex)
      // Landed in a folder that is closed, the ghost goes into the folder's row.
      landGhost(placed[0] ?? drag.path, targetFolder, velocity, putDown)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragInsert, dragOverFolder, performMoves, updateManualDrag, updateSplitDrag, dragInsertRef, dragOverFolderRef, dragPointRef, manualDragActiveRef, manualDragRef, setDragInsert, setDragOverFolder, setDragOverPath, setDragPreview, setDragSourceId, setIsDragging])

  return { handleDrop, updateManualDrag }
}
