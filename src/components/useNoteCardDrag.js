/**
 * useNoteCardDrag — dragging and resizing note preview cards.
 *
 * Dragging a parent card springs its descendants toward their new targets, so the
 * elastic loop's refs are threaded in rather than owned here: the spring exists
 * because of the drag, and the two share the same position and velocity state.
 *
 * Pointer events, not HTML5 drag: a card can be dragged out onto the canvas, and
 * the drag must survive leaving the card's own DOM.
 */
import { useCallback } from 'react'
import {
  DRAG_MIN_DELTA,
  TILE_MIN_HEIGHT,
  TILE_MIN_RESIZE_HEIGHT,
  TILE_MIN_RESIZE_WIDTH,
  TILE_WIDTH,
  VIEWPORT_PADDING,
  addPointerDragListeners,
  clampPosition,
  collectDescendantIds,
  isDragEdge,
  releasePointerCaptureSafely,
  setPointerCaptureSafely,
} from '../lib/notePreviewGeometry'

export function useNoteCardDrag({
  cardSizesRef,
  childMap,
  commitLayout,
  commitSize,
  dragLayoutsRef,
  dragStateRef,
  elasticPositionsRef,
  elasticVelocityRef,
  layout,
  lockPreview,
  noteById,
  preview,
  setCardSizes,
  setDragLayouts,
  setElasticPositions,
  startElasticLoop,
}) {

  const shouldStartDrag = useCallback((event) => {
    if (!(event.target instanceof HTMLElement)) return false
    if (event.target.closest('.note-preview-close')) return false
    if (event.target.closest('.note-preview-drag')) return true
    if (event.target.closest('textarea, input, button, a, label')) return false

    const card = event.currentTarget
    if (!(card instanceof HTMLElement)) return false
    const rect = card.getBoundingClientRect()
    return isDragEdge(event.clientX, event.clientY, rect)
  }, [])

  const handleDragStart = useCallback((noteId, event) => {
    if (!preview || !layout || !shouldStartDrag(event)) return

    const position = layout.positions.get(noteId)
    const note = noteById.get(noteId)
    if (!position || !note) return

    event.preventDefault()
    event.stopPropagation()
    const dragTarget = event.currentTarget
    setPointerCaptureSafely(dragTarget, event.pointerId)
    lockPreview()

    const parentPosition = note.parentNoteId ? layout.positions.get(note.parentNoteId) || null : null
    const rootBase = layout.rootBase
    const descendantIds = collectDescendantIds(childMap, noteId)

    if (descendantIds.size > 0) {
      const nextElasticPositions = { ...elasticPositionsRef.current }
      const nextElasticVelocity = { ...elasticVelocityRef.current }

      descendantIds.forEach((id) => {
        const currentPosition = layout.positions.get(id)
        if (!currentPosition) return
        nextElasticPositions[id] = elasticPositionsRef.current[id] || { ...currentPosition }
        nextElasticVelocity[id] = elasticVelocityRef.current[id] || { x: 0, y: 0 }
      })

      elasticPositionsRef.current = nextElasticPositions
      elasticVelocityRef.current = nextElasticVelocity
      setElasticPositions(nextElasticPositions)
    }

    dragStateRef.current = {
      mode: 'move',
      noteId,
      descendantIds,
      parentPosition,
      rootBase,
      pointerOffsetX: event.clientX - position.x,
      pointerOffsetY: event.clientY - position.y,
      originX: event.clientX,
      originY: event.clientY,
      hasMoved: false,
    }

    const handlePointerMove = (moveEvent) => {
      const dragState = dragStateRef.current
      if (!dragState) return
      moveEvent.preventDefault()

      const size = cardSizesRef.current[dragState.noteId]
        || noteById.get(dragState.noteId)?.previewSize
        || { width: TILE_WIDTH, height: TILE_MIN_HEIGHT }
      const hasMoved = dragState.hasMoved ||
        Math.abs(moveEvent.clientX - dragState.originX) + Math.abs(moveEvent.clientY - dragState.originY) >= DRAG_MIN_DELTA
      dragState.hasMoved = hasMoved
      const nextPosition = clampPosition({
        x: moveEvent.clientX - dragState.pointerOffsetX,
        y: moveEvent.clientY - dragState.pointerOffsetY,
      }, size)

      const nextLayout = dragState.parentPosition
        ? {
            offsetX: nextPosition.x - dragState.parentPosition.x,
            offsetY: nextPosition.y - dragState.parentPosition.y,
          }
        : {
            offsetX: nextPosition.x - dragState.rootBase.x,
            offsetY: nextPosition.y - dragState.rootBase.y,
          }

      if (hasMoved) {
        dragLayoutsRef.current = {
          ...dragLayoutsRef.current,
          [dragState.noteId]: nextLayout,
        }
        setDragLayouts((current) => ({
          ...current,
          [dragState.noteId]: nextLayout,
        }))
      }

      if (dragState.descendantIds?.size > 0) {
        startElasticLoop()
      }
    }

    const handlePointerUp = (upEvent) => {
      const dragState = dragStateRef.current
      removePointerListeners()
      releasePointerCaptureSafely(dragTarget, event.pointerId)
      upEvent?.preventDefault?.()

      if (!dragState) return
      const finalLayout = dragLayoutsRef.current[dragState.noteId]
      if (finalLayout) {
        commitLayout(dragState.noteId, finalLayout)
      }

      if (dragState.descendantIds?.size > 0) {
        dragStateRef.current = {
          mode: 'settle',
          descendantIds: dragState.descendantIds,
        }
        startElasticLoop()
        return
      }

      dragStateRef.current = null
    }

    const removePointerListeners = addPointerDragListeners(dragTarget, handlePointerMove, handlePointerUp)
  }, [childMap, commitLayout, layout, lockPreview, noteById, preview, shouldStartDrag, startElasticLoop, elasticPositionsRef, elasticVelocityRef, setElasticPositions, dragStateRef, cardSizesRef, dragLayoutsRef, setDragLayouts])

  const handleResizeStart = useCallback((noteId, event) => {
    const note = noteById.get(noteId)
    const position = layout?.positions.get(noteId)
    const currentSize = layout?.sizes.get(noteId)
    if (!note || !position || !currentSize) return

    event.preventDefault()
    event.stopPropagation()
    const dragTarget = event.currentTarget
    setPointerCaptureSafely(dragTarget, event.pointerId)
    lockPreview()

    dragStateRef.current = {
      mode: 'resize',
      noteId,
      originX: event.clientX,
      originY: event.clientY,
      initialWidth: currentSize.width,
      initialHeight: currentSize.height,
      position,
    }

    const handlePointerMove = (moveEvent) => {
      const dragState = dragStateRef.current
      if (!dragState || dragState.mode !== 'resize') return
      moveEvent.preventDefault()

      const nextWidth = Math.max(
        TILE_MIN_RESIZE_WIDTH,
  TILE_WIDTH,
  VIEWPORT_PADDING,
        dragState.initialWidth + (moveEvent.clientX - dragState.originX)
      )
      const nextHeight = Math.max(
        TILE_MIN_RESIZE_HEIGHT,
        dragState.initialHeight + (moveEvent.clientY - dragState.originY)
      )
      const clampedSize = {
        width: Math.min(nextWidth, window.innerWidth - dragState.position.x - VIEWPORT_PADDING),
        height: Math.min(nextHeight, window.innerHeight - dragState.position.y - VIEWPORT_PADDING),
      }

      cardSizesRef.current = {
        ...cardSizesRef.current,
        [noteId]: clampedSize,
      }
      setCardSizes((current) => ({
        ...current,
        [noteId]: clampedSize,
      }))
    }

    const handlePointerUp = (upEvent) => {
      const dragState = dragStateRef.current
      dragStateRef.current = null
      removePointerListeners()
      releasePointerCaptureSafely(dragTarget, event.pointerId)
      upEvent?.preventDefault?.()

      if (!dragState || dragState.mode !== 'resize') return
      const finalSize = cardSizesRef.current[noteId] || currentSize
      commitSize(noteId, finalSize)
    }

    const removePointerListeners = addPointerDragListeners(dragTarget, handlePointerMove, handlePointerUp)
  }, [commitSize, layout, lockPreview, noteById, dragStateRef, cardSizesRef, setCardSizes])


  return { handleDragStart, handleResizeStart }
}
