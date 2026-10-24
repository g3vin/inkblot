/**
 * useNoteCardDrag — dragging and resizing note preview cards.
 *
 * Dragging a parent card springs its descendants toward their new targets, so the
 * elastic loop's refs are threaded in rather than owned here: the spring exists
 * because of the drag, and the two share the same position and velocity state.
 *
 * There are no handles. As with a window, the band across a card's top moves it and
 * its edges and corners resize it (getCardGrip); everything else is the note's own.
 *
 * Pointer events, not HTML5 drag: a card can be dragged out onto the canvas, and
 * the drag must survive leaving the card's own DOM.
 */
import { useCallback } from 'react'
import {
  DRAG_MIN_DELTA,
  TILE_MIN_HEIGHT,
  TILE_WIDTH,
  addPointerDragListeners,
  clampPosition,
  collectDescendantIds,
  getCardGrip,
  releasePointerCaptureSafely,
  resizeCardBox,
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
  setHeldNoteId,
  startElasticLoop,
}) {

  // What a press does: an edge or corner resizes, the top band moves, and a control
  // or the note's text is left alone (a press on an edge wins over what is under it).
  const gripAt = useCallback((event) => {
    if (!(event.target instanceof Element)) return null
    const card = event.currentTarget
    if (!(card instanceof HTMLElement)) return null
    const grip = getCardGrip(event.clientX, event.clientY, card.getBoundingClientRect())
    if (grip === 'move' && event.target.closest('textarea, input, button, a, label, audio')) return null
    return grip
  }, [])

  const handleMoveStart = useCallback((noteId, event) => {
    if (!preview || !layout) return

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

    setHeldNoteId(noteId)
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
      setHeldNoteId(null)

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
  }, [childMap, commitLayout, layout, lockPreview, noteById, preview, startElasticLoop, elasticPositionsRef, elasticVelocityRef, setElasticPositions, setHeldNoteId, dragStateRef, cardSizesRef, dragLayoutsRef, setDragLayouts])

  // Resizing from a left or top edge moves the card too, so its far edges stay put.
  const handleResizeStart = useCallback((noteId, edges, event) => {
    const note = noteById.get(noteId)
    const position = layout?.positions.get(noteId)
    const currentSize = layout?.sizes.get(noteId)
    if (!note || !position || !currentSize) return

    event.preventDefault()
    event.stopPropagation()
    const dragTarget = event.currentTarget
    setPointerCaptureSafely(dragTarget, event.pointerId)
    lockPreview()

    const parentPosition = note.parentNoteId ? layout.positions.get(note.parentNoteId) || null : null
    const base = parentPosition || layout.rootBase
    const box = { ...position, width: currentSize.width, height: currentSize.height }
    const movesOrigin = edges.includes('n') || edges.includes('w')

    setHeldNoteId(noteId)
    dragStateRef.current = { mode: 'resize', noteId }

    const handlePointerMove = (moveEvent) => {
      if (dragStateRef.current?.mode !== 'resize') return
      moveEvent.preventDefault()

      const next = resizeCardBox(box, edges, moveEvent.clientX - event.clientX, moveEvent.clientY - event.clientY, {
        width: window.innerWidth,
        height: window.innerHeight,
      })
      const size = { width: next.width, height: next.height }
      cardSizesRef.current = { ...cardSizesRef.current, [noteId]: size }
      setCardSizes((current) => ({ ...current, [noteId]: size }))

      if (movesOrigin) {
        const offset = { offsetX: next.x - base.x, offsetY: next.y - base.y }
        dragLayoutsRef.current = { ...dragLayoutsRef.current, [noteId]: offset }
        setDragLayouts((current) => ({ ...current, [noteId]: offset }))
      }
    }

    const handlePointerUp = (upEvent) => {
      const dragState = dragStateRef.current
      dragStateRef.current = null
      removePointerListeners()
      releasePointerCaptureSafely(dragTarget, event.pointerId)
      upEvent?.preventDefault?.()
      setHeldNoteId(null)

      if (dragState?.mode !== 'resize') return
      commitSize(noteId, cardSizesRef.current[noteId] || currentSize)
      const finalLayout = dragLayoutsRef.current[noteId]
      if (movesOrigin && finalLayout) commitLayout(noteId, finalLayout)
    }

    const removePointerListeners = addPointerDragListeners(dragTarget, handlePointerMove, handlePointerUp)
  }, [commitLayout, commitSize, layout, lockPreview, noteById, dragStateRef, cardSizesRef, setCardSizes, setHeldNoteId, dragLayoutsRef, setDragLayouts])

  /** A press on a card: move it from the top band, resize it from an edge or corner. */
  const handleCardPointerDown = useCallback((noteId, event) => {
    if (event.button !== undefined && event.button !== 0) return
    const grip = gripAt(event)
    if (!grip) return
    if (grip === 'move') handleMoveStart(noteId, event)
    else handleResizeStart(noteId, grip, event)
  }, [gripAt, handleMoveStart, handleResizeStart])

  /** The cursor a press here would get: shown as the pointer moves over the card. */
  const cursorAt = useCallback((event) => {
    const grip = gripAt(event)
    if (!grip) return ''
    if (grip === 'move') return 'grab'
    return { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' }[grip]
  }, [gripAt])

  return { handleCardPointerDown, cursorAt }
}
