/**
 * NoteHoverPreview.jsx — floating note cards over the editor.
 *
 * When the user hovers (or pins, via click) a note marker in the editor,
 * this layer shows the note and its child notes as draggable, resizable
 * cards connected by curved "strings" (SVG paths) back to the anchor.
 * Communication with the editor happens through the NOTE_PREVIEW_* window
 * events emitted by the NoteAnnotation extension. Card positions/sizes are
 * persisted onto each note (previewLayout/previewSize); dragging a card with
 * children pulls the descendants along on an elastic spring animation.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import SFIcon from './SFIcon'
import NoteImageGallery from './NoteImageGallery'
import AudioNotes from './AudioNotes'
import { readClipboardImages } from '../lib/noteImageUtils'
import { collectNoteBranchIds, createFreeNote, touchNote } from '../lib/noteUtils'
import { RESIZE_ICON_PATHS } from '../lib/resizeIcon'
import {
  clearEditorActiveNote,
  NOTE_PREVIEW_ENTER_EVENT,
  NOTE_PREVIEW_LEAVE_EVENT,
  NOTE_PREVIEW_PIN_EVENT,
  setEditorActiveNote,
  setEditorHoveredNote,
} from '../extensions/NoteAnnotation'

import {
  TILE_WIDTH,
  TILE_MIN_HEIGHT,
  TILE_MIN_RESIZE_WIDTH,
  TILE_MIN_RESIZE_HEIGHT,
  VIEWPORT_PADDING,
  HIDE_DELAY_MS,
  EDGE_GRAB_THRESHOLD,
  DRAG_MIN_DELTA,
  CHILD_OFFSET_X,
  CHILD_OFFSET_Y,
  clampPosition,
  getInitialTilePosition,
  getDotPoint,
  getCardCenter,
  getDefaultChildOffset,
  getCurvePath,
  isSamePreviewIdentity,
  isDragEdge,
  setPointerCaptureSafely,
  releasePointerCaptureSafely,
  addPointerDragListeners,
  hasStoredChildOffset,
  collectDescendantIds,
  areRectsEqual,
} from '../lib/notePreviewGeometry'

/** Find the live bounding rect of a note's marker element in the editor DOM. */
const queryAnchorRect = (noteId, editorView) => {
  if (!noteId || typeof document === 'undefined') return null
  const selector = `.note-marker[data-note-id="${CSS.escape(String(noteId))}"]`
  const marker = editorView?.dom?.querySelector?.(selector) || document.querySelector(selector)
  return marker?.getBoundingClientRect?.() || null
}


export default function NoteHoverPreview({
  notesByDoc = {},
  setNotesForDoc,
  projectName,
}) {
  const [preview, setPreview] = useState(null)
  const [dragLayouts, setDragLayouts] = useState({})
  const [cardSizes, setCardSizes] = useState({})
  const [focusNoteId, setFocusNoteId] = useState(null)
  const [elasticPositions, setElasticPositions] = useState({})
  const previewRef = useRef(null)
  const previousPreviewRef = useRef(null)
  const hideTimeoutRef = useRef(null)
  const textareaRefs = useRef(new Map())
  const dragStateRef = useRef(null)
  const dragLayoutsRef = useRef({})
  const cardSizesRef = useRef({})
  const elasticPositionsRef = useRef({})
  const elasticVelocityRef = useRef({})
  const elasticFrameRef = useRef(0)
  const layoutRef = useRef(null)

  const clearHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current) {
      window.clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
    }
  }, [])

  const scheduleHide = useCallback(() => {
    clearHideTimeout()
    hideTimeoutRef.current = window.setTimeout(() => {
      setPreview((current) => (current?.locked ? current : null))
    }, HIDE_DELAY_MS)
  }, [clearHideTimeout])

  const lockPreview = useCallback(() => {
    clearHideTimeout()
    setPreview((current) => {
      if (!current || current.locked) return current
      return { ...current, locked: true }
    })
  }, [clearHideTimeout])

  useEffect(() => clearHideTimeout, [clearHideTimeout])

  useEffect(() => {
    previewRef.current = preview
  }, [preview])

  useEffect(() => {
    dragLayoutsRef.current = dragLayouts
  }, [dragLayouts])

  useEffect(() => {
    cardSizesRef.current = cardSizes
  }, [cardSizes])

  useEffect(() => {
    elasticPositionsRef.current = elasticPositions
  }, [elasticPositions])

  const docNotes = useMemo(() => (
    preview?.docName ? notesByDoc?.[preview.docName] || [] : []
  ), [notesByDoc, preview])

  const noteById = useMemo(() => {
    const map = new Map()
    docNotes.forEach((note) => {
      map.set(note.id, note)
    })
    return map
  }, [docNotes])

  const childMap = useMemo(() => {
    const map = new Map()
    docNotes.forEach((note) => {
      if (!note.parentNoteId) return
      if (!map.has(note.parentNoteId)) {
        map.set(note.parentNoteId, [])
      }
      map.get(note.parentNoteId).push(note)
    })
    return map
  }, [docNotes])

  const rootNote = useMemo(() => {
    if (!preview?.note?.id) return null
    return noteById.get(preview.note.id) || preview.note
  }, [noteById, preview])

  // Mirror hover/pin state back into the editor so the anchored text highlights.
  useEffect(() => {
    const previous = previousPreviewRef.current

    if (previous && !isSamePreviewIdentity(previous, preview)) {
      if (previous.locked) {
        clearEditorActiveNote(previous.editorView)
      } else {
        setEditorHoveredNote(previous.editorView, null)
      }
    }

    if (preview && !isSamePreviewIdentity(previous, preview)) {
      if (preview.locked) {
        setEditorActiveNote(preview.editorView, preview.note.id)
      } else {
        setEditorHoveredNote(preview.editorView, preview.note.id)
      }
    }

    previousPreviewRef.current = preview
  }, [preview])

  useEffect(() => {
    textareaRefs.current.forEach((textarea) => {
      textarea.style.height = 'auto'
      textarea.style.height = `${textarea.scrollHeight}px`
    })
  }, [docNotes, dragLayouts, preview?.note?.id])

  useEffect(() => {
    if (!focusNoteId) return
    const textarea = textareaRefs.current.get(focusNoteId)
    if (!textarea) return

    textarea.focus()
    const end = textarea.value.length
    textarea.setSelectionRange(end, end)
    window.setTimeout(() => setFocusNoteId(null), 0)
  }, [docNotes, focusNoteId])

  // Open/close the preview in response to marker hover, pin, and leave events.
  useEffect(() => {
    const openPreview = (detail, locked) => {
      if (!detail?.note || !detail?.anchorRect) return

      clearHideTimeout()
      const currentPreview = previewRef.current
      if (currentPreview?.note?.id !== detail.note.id) {
        setDragLayouts({})
        setCardSizes({})
        setElasticPositions({})
        elasticPositionsRef.current = {}
        elasticVelocityRef.current = {}
        dragStateRef.current = null
        cancelAnimationFrame(elasticFrameRef.current)
        elasticFrameRef.current = 0
        setFocusNoteId(null)
      }

      setPreview((current) => {
        if (current?.locked && current.note.id !== detail.note.id) {
          return current
        }

        const nextLocked = locked || (current?.locked && current.note.id === detail.note.id)
        return {
          note: detail.note,
          docName: detail.note.docName || current?.docName || null,
          anchorRect: detail.anchorRect,
          editorView: detail.editorView || current?.editorView || null,
          locked: Boolean(nextLocked),
        }
      })
    }

    const handleEnter = (event) => openPreview(event.detail, false)
    const handlePin = (event) => openPreview(event.detail, true)
    const handleLeave = (event) => {
      const noteId = event?.detail?.note?.id
      const current = previewRef.current
      if (!current || current.locked || current.note.id !== noteId) return
      scheduleHide()
    }

    window.addEventListener(NOTE_PREVIEW_ENTER_EVENT, handleEnter)
    window.addEventListener(NOTE_PREVIEW_PIN_EVENT, handlePin)
    window.addEventListener(NOTE_PREVIEW_LEAVE_EVENT, handleLeave)

    return () => {
      window.removeEventListener(NOTE_PREVIEW_ENTER_EVENT, handleEnter)
      window.removeEventListener(NOTE_PREVIEW_PIN_EVENT, handlePin)
      window.removeEventListener(NOTE_PREVIEW_LEAVE_EVENT, handleLeave)
    }
  }, [clearHideTimeout, scheduleHide])

  // Keep the anchor rect current while the page scrolls/resizes so the strings follow.
  useEffect(() => {
    if (!preview?.note?.id) return undefined

    const syncAnchor = () => {
      const liveAnchorRect = queryAnchorRect(preview.note.id, preview.editorView)
      if (!liveAnchorRect) return

      const serialized = {
        left: liveAnchorRect.left,
        top: liveAnchorRect.top,
        right: liveAnchorRect.right,
        bottom: liveAnchorRect.bottom,
        width: liveAnchorRect.width,
        height: liveAnchorRect.height,
      }

      setPreview((current) => {
        if (!current || current.note.id !== preview.note.id) return current
        if (areRectsEqual(current.anchorRect, serialized)) return current
        return { ...current, anchorRect: serialized }
      })
    }

    syncAnchor()
    window.addEventListener('resize', syncAnchor)
    window.addEventListener('scroll', syncAnchor, true)

    return () => {
      window.removeEventListener('resize', syncAnchor)
      window.removeEventListener('scroll', syncAnchor, true)
    }
  }, [preview?.editorView, preview?.note?.id])

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!preview?.locked) return
      if (dragStateRef.current) return
      if (event.target instanceof HTMLElement && event.target.closest('.note-preview-card, .note-marker')) {
        return
      }
      setPreview(null)
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setPreview(null)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [preview])

  // Compute card positions/sizes and connecting edges for the whole visible
  // branch. Child positions are offsets from their parent (stored on the note
  // or overridden mid-drag), so moving a parent shifts its subtree.
  const layout = useMemo(() => {
    if (!preview?.anchorRect || !rootNote) return null

    const rootBase = getInitialTilePosition(preview.anchorRect)
    const getNoteSize = (note) => cardSizes[note.id] || note.previewSize || {
      width: TILE_WIDTH,
      height: TILE_MIN_HEIGHT,
    }

    const rootSize = getNoteSize(rootNote)
    const rootOffset = dragLayouts[rootNote.id] || rootNote.previewLayout || { offsetX: 0, offsetY: 0 }
    const rootPosition = clampPosition({
      x: rootBase.x + (rootOffset.offsetX || 0),
      y: rootBase.y + (rootOffset.offsetY || 0),
    }, rootSize)

    const positions = new Map()
    const sizes = new Map()
    const nodes = []
    const edges = [{
      id: `anchor:${rootNote.id}`,
      anchorPoint: getDotPoint(preview.anchorRect),
      toNoteId: rootNote.id,
      color: rootNote.color || '#007aff',
      depth: 0,
    }]

    const visit = (note, position, depth = 0) => {
      const size = getNoteSize(note)
      positions.set(note.id, position)
      sizes.set(note.id, size)
      const children = childMap.get(note.id) || []
      nodes.push({
        note,
        position,
        size,
        depth,
        childCount: children.length,
        revealDelay: depth * 0.05 + nodes.length * 0.018,
      })

      if (note.collapsedChildren) return

      children.forEach((child, index) => {
        const fallbackOffset = getDefaultChildOffset(index, children.length)
        const storedOffset = dragLayouts[child.id]
          || (hasStoredChildOffset(child) ? child.previewLayout : fallbackOffset)
        const childSize = getNoteSize(child)
        const childPosition = clampPosition({
          x: position.x + (storedOffset.offsetX || 0),
          y: position.y + (storedOffset.offsetY || 0),
        }, childSize)

        edges.push({
          id: `${note.id}:${child.id}`,
          fromNoteId: note.id,
          toNoteId: child.id,
          color: child.color || note.color || '#007aff',
          depth: depth + 1,
        })

        visit(child, childPosition, depth + 1)
      })
    }

    visit(rootNote, rootPosition, 0)
    return { nodes, edges, positions, sizes, rootBase, rootPosition }
  }, [cardSizes, childMap, dragLayouts, preview, rootNote])

  useEffect(() => {
    layoutRef.current = layout
  }, [layout])

  useEffect(() => () => cancelAnimationFrame(elasticFrameRef.current), [])

  // Spring-animate descendant cards toward their layout targets while a parent
  // is being dragged ('move') and until they settle afterwards ('settle').
  const startElasticLoop = useCallback(() => {
    if (elasticFrameRef.current) return

    const animate = () => {
      const dragState = dragStateRef.current
      const currentLayout = layoutRef.current
      const descendantIds = dragState?.descendantIds || null

      if (!currentLayout || !descendantIds || descendantIds.size === 0) {
        elasticFrameRef.current = 0
        return
      }

      let moving = false
      const nextPositions = { ...elasticPositionsRef.current }
      const nextVelocity = { ...elasticVelocityRef.current }

      descendantIds.forEach((noteId) => {
        const target = currentLayout.positions.get(noteId)
        if (!target) {
          delete nextPositions[noteId]
          delete nextVelocity[noteId]
          return
        }

        const current = nextPositions[noteId] || { ...target }
        const velocity = nextVelocity[noteId] || { x: 0, y: 0 }

        velocity.x = (velocity.x + (target.x - current.x) * 0.12) * 0.72
        velocity.y = (velocity.y + (target.y - current.y) * 0.12) * 0.72

        const next = {
          x: current.x + velocity.x,
          y: current.y + velocity.y,
        }

        if (
          Math.abs(target.x - next.x) > 0.35 ||
          Math.abs(target.y - next.y) > 0.35 ||
          Math.abs(velocity.x) > 0.12 ||
          Math.abs(velocity.y) > 0.12
        ) {
          moving = true
          nextPositions[noteId] = next
          nextVelocity[noteId] = velocity
        } else {
          nextPositions[noteId] = { ...target }
          nextVelocity[noteId] = { x: 0, y: 0 }
        }
      })

      elasticPositionsRef.current = nextPositions
      elasticVelocityRef.current = nextVelocity
      setElasticPositions(nextPositions)

      if (dragStateRef.current?.mode === 'move' || moving) {
        elasticFrameRef.current = requestAnimationFrame(animate)
        return
      }

      if (dragStateRef.current?.mode === 'settle') {
        dragStateRef.current = null
      }
      descendantIds.forEach((noteId) => {
        delete nextPositions[noteId]
        delete nextVelocity[noteId]
      })
      elasticPositionsRef.current = { ...nextPositions }
      elasticVelocityRef.current = { ...nextVelocity }
      setElasticPositions(elasticPositionsRef.current)
      elasticFrameRef.current = 0
    }

    elasticFrameRef.current = requestAnimationFrame(animate)
  }, [])

  const updateNote = useCallback((noteId, updater) => {
    if (!preview?.docName || !setNotesForDoc) return

    setNotesForDoc(preview.docName, (currentNotes) => currentNotes.map((note) => {
      if (note.id !== noteId) return note
      return typeof updater === 'function' ? updater(note) : { ...note, ...updater }
    }))
  }, [preview, setNotesForDoc])

  const handleNoteChange = useCallback((noteId, value) => {
    updateNote(noteId, (note) => touchNote(note, { content: value }))
  }, [updateNote])

  const handleAddImages = useCallback((noteId, images) => {
    if (!Array.isArray(images) || images.length === 0) return

    updateNote(noteId, (note) => touchNote(note, {
      images: [...(note.images || []), ...images],
    }))
  }, [updateNote])

  const handleRemoveImage = useCallback((noteId, imageId) => {
    updateNote(noteId, (note) => touchNote(note, {
      images: (note.images || []).filter((image) => image.id !== imageId),
    }))
  }, [updateNote])

  const handleChangeAudio = useCallback((noteId, audio) => {
    updateNote(noteId, (note) => touchNote(note, { audio }))
  }, [updateNote])

  const handleToggleCollapse = useCallback((noteId) => {
    lockPreview()
    updateNote(noteId, (note) => ({
      ...note,
      collapsedChildren: !note.collapsedChildren,
    }))
  }, [lockPreview, updateNote])

  const handleAddChild = useCallback((parentId) => {
    if (!preview?.docName || !setNotesForDoc) return

    const currentChildren = childMap.get(parentId) || []
    const nextTotal = currentChildren.length + 1
    const nextIndex = currentChildren.length
    const previewLayout = getDefaultChildOffset(nextIndex, nextTotal)
    const parentNote = noteById.get(parentId)
    const newNote = touchNote(createFreeNote(parentNote?.color), {
      parentNoteId: parentId,
      previewLayout,
      collapsedChildren: false,
    })

    lockPreview()
    setNotesForDoc(preview.docName, (currentNotes) => [...currentNotes, newNote])
    setFocusNoteId(newNote.id)
  }, [childMap, lockPreview, noteById, preview, setNotesForDoc])

  const commitLayout = useCallback((noteId, nextLayout) => {
    updateNote(noteId, (note) => ({
      ...note,
      previewLayout: {
        offsetX: nextLayout.offsetX,
        offsetY: nextLayout.offsetY,
      },
    }))
  }, [updateNote])

  const commitSize = useCallback((noteId, nextSize) => {
    updateNote(noteId, (note) => ({
      ...note,
      previewSize: {
        width: Math.max(TILE_MIN_RESIZE_WIDTH, nextSize.width),
        height: Math.max(TILE_MIN_RESIZE_HEIGHT, nextSize.height),
      },
    }))
  }, [updateNote])

  // A drag starts from the drag handle or by grabbing near a card edge —
  // never from the close button or interactive controls.
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
  }, [childMap, commitLayout, layout, lockPreview, noteById, preview, shouldStartDrag, startElasticLoop])

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
  }, [commitSize, layout, lockPreview, noteById])

  const handleDeleteNote = useCallback(async (noteId) => {
    if (!preview?.docName || !setNotesForDoc) return

    const ok = await confirm('Delete note branch?')
    if (!ok) return

    const branchIds = new Set(collectNoteBranchIds(docNotes, noteId))
    setNotesForDoc(preview.docName, (currentNotes) => currentNotes.filter((note) => !branchIds.has(note.id)))

    if (noteId === rootNote?.id) {
      setPreview(null)
      return
    }

    setDragLayouts((current) => {
      const next = { ...current }
      branchIds.forEach((id) => {
        delete next[id]
      })
      return next
    })
    setCardSizes((current) => {
      const next = { ...current }
      branchIds.forEach((id) => {
        delete next[id]
      })
      return next
    })
  }, [docNotes, preview, rootNote, setNotesForDoc])

  const handlePasteImages = useCallback(async (noteId, event) => {
    const images = await readClipboardImages(event.clipboardData)
    if (images.length === 0) return

    event.preventDefault()
    event.stopPropagation()
    lockPreview()
    handleAddImages(noteId, images)
  }, [handleAddImages, lockPreview])

  if (!preview || !layout || !rootNote) return null

  return (
    <div className="note-preview-layer" style={{ '--note-color': rootNote.color || '#007aff' }}>
      <svg
        className="note-preview-string"
        viewBox={`0 0 ${window.innerWidth} ${window.innerHeight}`}
        preserveAspectRatio="none"
        style={{ pointerEvents: 'none' }}
      >
        {layout.edges.map((edge) => {
          const toPosition = elasticPositions[edge.toNoteId] || layout.positions.get(edge.toNoteId)
          const toSize = layout.sizes.get(edge.toNoteId)
          if (!toPosition || !toSize) return null

          const fromPosition = edge.fromNoteId
            ? elasticPositions[edge.fromNoteId] || layout.positions.get(edge.fromNoteId)
            : null
          const fromSize = edge.fromNoteId ? layout.sizes.get(edge.fromNoteId) : null
          if (edge.fromNoteId && (!fromPosition || !fromSize)) return null

          const fromPoint = edge.fromNoteId
            ? getCardCenter(fromPosition, fromSize)
            : edge.anchorPoint
          const toPoint = getCardCenter(toPosition, toSize)
          const path = getCurvePath(fromPoint, toPoint)
          return (
            <g key={edge.id} style={{ '--note-color': edge.color }}>
              <path
                className="note-preview-string-shadow"
                d={path}
              />
              <path
                className="note-preview-string-path"
                d={path}
                style={{
                  animationDelay: `${(edge.depth ?? 0) * 50 + 40}ms`,
                }}
              />
            </g>
          )
        })}
      </svg>

      {layout.nodes.map(({ note, position, size, childCount, revealDelay }) => {
        const renderPosition = elasticPositions[note.id] || position
        const addIconName = childCount > 0 ? 'git.pullrequest' : 'arrow.down.to.dot'
        return (
          <article
            key={note.id}
            className={`note-preview-card${preview.locked ? ' locked' : ''}`}
            style={{
              left: `${renderPosition.x}px`,
              top: `${renderPosition.y}px`,
              width: `${size.width}px`,
              minHeight: `${size.height}px`,
              '--note-color': note.color || '#007aff',
              '--note-reveal-delay': `${revealDelay}s`,
            }}
            onPointerDown={(event) => handleDragStart(note.id, event)}
            onMouseEnter={clearHideTimeout}
            onMouseLeave={() => {
              if (dragStateRef.current) return
              if (!preview.locked) scheduleHide()
            }}
          >
            <div className="note-preview-header">
              <button
                type="button"
                className="note-preview-drag"
                onPointerDown={(event) => handleDragStart(note.id, event)}
                onClick={(event) => event.preventDefault()}
                aria-label="Move note"
                title="Move note"
              >
                <SFIcon name="ellipsis" size={14} />
              </button>

              {note.id === rootNote.id ? (
                <button
                  type="button"
                  className="note-preview-close"
                  onClick={() => setPreview(null)}
                  aria-label="Close note preview"
                  title="Close note preview"
                >
                  <SFIcon name="xmark" size={12} />
                </button>
              ) : <span className="note-preview-spacer" />}
            </div>

            <textarea
              ref={(node) => {
                if (!node) {
                  textareaRefs.current.delete(note.id)
                  return
                }
                textareaRefs.current.set(note.id, node)
              }}
              className="note-textarea note-preview-textarea"
              value={note.content || ''}
              placeholder="Type your note here..."
              rows={1}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => {
                event.stopPropagation()
                lockPreview()
              }}
              onFocus={lockPreview}
              onPaste={(event) => {
                void handlePasteImages(note.id, event)
              }}
              onChange={(event) => handleNoteChange(note.id, event.target.value)}
            />

            <NoteImageGallery
              images={note.images}
              onRemoveImage={(imageId) => handleRemoveImage(note.id, imageId)}
            />

            {/* Voice memos are stored on the note, so one recorded here is the same
                memo the notes panel and any canvas card show. */}
            <AudioNotes
              audio={note.audio}
              projectName={projectName}
              onChange={(audio) => handleChangeAudio(note.id, audio)}
              compact
            />

            <div className="note-footer note-preview-footer">
              <div className="note-preview-branch-actions">
                <button
                  type="button"
                  className="note-tool-btn note-preview-branch-btn"
                  onClick={(event) => {
                    event.stopPropagation()
                    void handleDeleteNote(note.id)
                  }}
                  aria-label="Delete note branch"
                  title="Delete note branch"
                >
                  <SFIcon name="trash" size={14} />
                </button>

                {childCount > 0 ? (
                  <button
                    type="button"
                    className={`note-tool-btn note-preview-branch-btn${note.collapsedChildren ? ' active' : ''}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      handleToggleCollapse(note.id)
                    }}
                    aria-label={note.collapsedChildren ? 'Expand branch' : 'Collapse branch'}
                    title={note.collapsedChildren ? 'Expand branch' : 'Collapse branch'}
                  >
                    <SFIcon name="arrow.up.from.dot" size={14} />
                  </button>
                ) : null}

                <button
                  type="button"
                  className="note-tool-btn note-preview-branch-btn"
                  onClick={(event) => {
                    event.stopPropagation()
                    handleAddChild(note.id)
                  }}
                  aria-label="Add connected note"
                  title="Add connected note"
                >
                  <SFIcon name={addIconName} size={14} />
                </button>
              </div>
            </div>

            <button
              type="button"
              className="note-preview-resize"
              onPointerDown={(event) => handleResizeStart(note.id, event)}
              onClick={(event) => event.preventDefault()}
              aria-label="Resize note"
              title="Resize note"
            >
              <svg
                className="resize-corner-icon"
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {RESIZE_ICON_PATHS.map(path => <path key={path} d={path} />)}
              </svg>
            </button>
          </article>
        )
      })}
    </div>
  )
}
