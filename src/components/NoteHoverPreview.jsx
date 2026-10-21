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
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import Icon from '../ui/Icon.jsx'
import InkPicker from '../ui/InkPicker.jsx'
import { useNoteCardDrag } from '../hooks/useNoteCardDrag'
import NoteImageGallery from './NoteImageGallery'
import { AudioClipList, AudioRecordButton } from './AudioNotes'
import { pickNoteImages, readClipboardImages } from '../lib/noteImageUtils'
import { trafficLightsBox } from '../lib/trafficLights'
import { NOTE_CLOSE_MS, NOTE_POP_MS, STRING_CLOSE_MIN_MS, STRING_MIN_MS, closeSchedule, drawMs, lineStart, openTiming } from '../lib/noteReveal'
import { NOTE_COLOR_OPTIONS, collectNoteBranchIds, createFreeNote, noteColor, noteInk, touchNote } from '../lib/noteUtils'
import {
  NOTE_HIGHLIGHT_EVENT,
  NOTE_PREVIEW_ENTER_EVENT,
  NOTE_PREVIEW_LEAVE_EVENT,
  NOTE_PREVIEW_PIN_EVENT,
} from '../extensions/NoteAnnotation'

import {
  TILE_WIDTH,
  TILE_MIN_HEIGHT,
  TILE_MIN_RESIZE_WIDTH,
  TILE_MIN_RESIZE_HEIGHT,
  VIEWPORT_PADDING,
  HIDE_DELAY_MS,
  HOVER_INTENT_STALL_MS,
  hoverIntent,
  clampPosition,
  findOpenSpot,
  getInitialTilePosition,
  getDotPoint,
  getCardCenter,
  getDefaultChildOffset,
  getStringPath,
  isSamePreviewIdentity,
  hasStoredChildOffset,
  areRectsEqual,
} from '../lib/notePreviewGeometry'

/** Find the live bounding rect of a note's marker element in the editor DOM. */
const queryAnchorRect = (noteId, editorView) => {
  if (!noteId || typeof document === 'undefined') return null
  const selector = `.note-marker[data-note-id="${CSS.escape(String(noteId))}"]`
  const marker = editorView?.dom?.querySelector?.(selector) || document.querySelector(selector)
  return marker?.getBoundingClientRect?.() || null
}


// The reveal's timing and the closing's (drawMs, lineStart, openTiming, closeSchedule)
// are shared with the notes panel: lib/noteReveal.

export default function NoteHoverPreview({
  notesByDoc = {},
  setNotesForDoc,
  projectName,
}) {
  const [preview, setPreviewState] = useState(null)
  const previewRef = useRef(null)
  // When each note's string starts drawing, by id, for the card now open (see layout).
  const [reveal] = useState(() => ({ rootId: null, timings: new Map(), closeTotal: 0 }))

  // Closing plays the opening backwards, quicker: the furthest notes shrink back
  // into their strings first, the strings draw back to their parents, and so on up to
  // the dot. The cards stay up (and out of reach) until it has played.
  const [closing, setClosing] = useState(false)
  const closeTimerRef = useRef(0)
  const cancelClose = useCallback(() => {
    if (!closeTimerRef.current) return
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = 0
    setClosing(false)
  }, [])
  const beginClose = useCallback(() => {
    if (closeTimerRef.current) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const total = reduced ? 0 : reveal.closeTotal
    setClosing(true)
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = 0
      setClosing(false)
      setPreviewState(null)
    }, total)
  }, [reveal])
  useEffect(() => () => window.clearTimeout(closeTimerRef.current), [])

  /** As setState, but closing (to null) plays the closing first. Only opening a note
   *  (openPreview) calls a closing off; other updates, like the anchor following a
   *  scroll, leave it playing. */
  const setPreview = useCallback((update) => {
    const current = previewRef.current
    const next = typeof update === 'function' ? update(current) : update
    if (!next && current) {
      beginClose()
      return
    }
    previewRef.current = next
    setPreviewState(next)
  }, [beginClose])
  const [dragLayouts, setDragLayouts] = useState({})
  const [cardSizes, setCardSizes] = useState({})
  const [focusNoteId, setFocusNoteId] = useState(null)
  const [elasticPositions, setElasticPositions] = useState({})
  const hideTimeoutRef = useRef(null)
  const previousPreviewRef = useRef(null)
  const textareaRefs = useRef(new Map())
  const dragStateRef = useRef(null)
  const dragLayoutsRef = useRef({})
  const cardSizesRef = useRef({})
  const elasticPositionsRef = useRef({})
  const elasticVelocityRef = useRef({})
  const elasticFrameRef = useRef(0)
  const layoutRef = useRef(null)

  const hoverIntentRef = useRef(null)
  const maskId = `note-strings-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

  // Each card's drawn size: a note's text and images grow it past its stored size, and
  // the strings run between the centres of the cards as drawn, and stop at their edges.
  const [drawnSizes, setDrawnSizes] = useState({})
  const layerRef = useRef(null)
  const [colorNoteId, setColorNoteId] = useState(null)

  // The colour picker: its own colour focused as it opens, closed by a press outside it.
  useEffect(() => {
    if (!colorNoteId) return undefined
    document.querySelector('.note-preview-ink-pill [aria-checked="true"]')?.focus()
    const close = (event) => {
      if (event.target instanceof Element && event.target.closest('.note-preview-ink-pill')) return
      setColorNoteId(null)
    }
    window.addEventListener('pointerdown', close, true)
    return () => window.removeEventListener('pointerdown', close, true)
  }, [colorNoteId])


  const clearHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current) {
      window.clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
    }
    hoverIntentRef.current?.()
    hoverIntentRef.current = null
  }, [])

  // The pointer has left the dot or a card. While it is heading for a card (any of
  // them: one that has just appeared, or the next in a branch) they stay; once it
  // turns away from all of them, or stops short, they go. Reaching a card, or the
  // dot again, clears this.
  const scheduleHide = useCallback(() => {
    clearHideTimeout()
    const hide = () => {
      clearHideTimeout()
      setPreview((current) => (current?.locked ? current : null))
    }
    const targets = [...document.querySelectorAll('.note-preview-card')].map((card) => card.getBoundingClientRect())
    const anchor = previewRef.current?.anchorRect
    if (anchor) targets.push(anchor)
    if (targets.length === 0) {
      hideTimeoutRef.current = window.setTimeout(hide, HIDE_DELAY_MS)
      return
    }
    const nearest = []
    const stall = () => {
      window.clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = window.setTimeout(hide, HOVER_INTENT_STALL_MS)
    }
    const handleMove = (event) => {
      const intent = hoverIntent(event.clientX, event.clientY, targets, nearest)
      if (intent === 'away') hide()
      else if (intent === 'approaching') stall()
    }
    window.addEventListener('pointermove', handleMove)
    hoverIntentRef.current = () => window.removeEventListener('pointermove', handleMove)
    stall()
  }, [clearHideTimeout, setPreview])

  const lockPreview = useCallback(() => {
    clearHideTimeout()
    setPreview((current) => {
      if (!current || current.locked) return current
      return { ...current, locked: true }
    })
  }, [clearHideTimeout, setPreview])

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

  // Mirror the open card back into the editor so the text it is about highlights.
  useEffect(() => {
    const previous = previousPreviewRef.current
    if (!isSamePreviewIdentity(previous, preview)) {
      window.dispatchEvent(new CustomEvent(NOTE_HIGHLIGHT_EVENT, {
        detail: { noteId: preview?.note?.id ?? null },
      }))
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
      cancelClose()

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
  }, [cancelClose, clearHideTimeout, scheduleHide, setPreview])

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
  }, [preview?.editorView, preview?.note?.id, setPreview])

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!preview?.locked) return
      if (dragStateRef.current) return
      if (event.target instanceof Element && event.target.closest('.note-preview-card, .note-marker')) {
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
  }, [preview, setPreview])

  // Compute card positions/sizes and connecting edges for the whole visible
  // branch. Child positions are offsets from their parent (stored on the note
  // or overridden mid-drag), so moving a parent shifts its subtree.
  const layout = useMemo(() => {
    if (!preview?.anchorRect || !rootNote) {
      // Closed: the next opening reveals in order again.
      reveal.rootId = null
      return null
    }

    const rootBase = getInitialTilePosition(preview.anchorRect)
    const getNoteSize = (note) => cardSizes[note.id] || note.previewSize || {
      width: TILE_WIDTH,
      height: TILE_MIN_HEIGHT,
    }

    // Kept in the window by the size each card is drawn at (its text can grow it past
    // its stored size), and clear of the traffic lights.
    const boundsOf = (note) => drawnSizes[note.id] || getNoteSize(note)
    const lights = trafficLightsBox(VIEWPORT_PADDING)
    const keepOut = lights ? [lights] : []

    const rootOffset = dragLayouts[rootNote.id] || rootNote.previewLayout || { offsetX: 0, offsetY: 0 }
    const rootPosition = clampPosition({
      x: rootBase.x + (rootOffset.offsetX || 0),
      y: rootBase.y + (rootOffset.offsetY || 0),
    }, boundsOf(rootNote), keepOut)

    const positions = new Map()
    const sizes = new Map()
    const nodes = []
    const edges = [{
      id: `anchor:${rootNote.id}`,
      anchorPoint: getDotPoint(preview.anchorRect),
      toNoteId: rootNote.id,
      color: noteColor(rootNote.color),
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
      })

      if (note.collapsedChildren) return

      children.forEach((child, index) => {
        const fallbackOffset = getDefaultChildOffset(index, children.length)
        const storedOffset = dragLayouts[child.id]
          || (hasStoredChildOffset(child) ? child.previewLayout : fallbackOffset)
        const childPosition = clampPosition({
          x: position.x + (storedOffset.offsetX || 0),
          y: position.y + (storedOffset.offsetY || 0),
        }, boundsOf(child), keepOut)

        edges.push({
          id: `${note.id}:${child.id}`,
          fromNoteId: note.id,
          toNoteId: child.id,
          color: noteColor(child.color || note.color),
          fromColor: noteColor(note.color),
          depth: depth + 1,
        })

        visit(child, childPosition, depth + 1)
      })
    }

    visit(rootNote, rootPosition, 0)

    // The reveal, a generation at a time: the string to a note draws itself from its
    // parent (or the dot), taking longer the longer it is; the note pops in as it
    // arrives; then its children's strings start. Only the notes there as the card
    // opens are staggered; one added or expanded later draws and pops at once.
    const boxOf = (id) => {
      const at = positions.get(id)
      const size = drawnSizes[id] || sizes.get(id)
      return at && size ? { x: at.x, y: at.y, width: size.width, height: size.height } : null
    }
    const drawMsFor = (edge) => {
      const toBox = boxOf(edge.toNoteId)
      const fromBox = edge.fromNoteId ? boxOf(edge.fromNoteId) : null
      if (!toBox) return STRING_MIN_MS
      const fromPoint = fromBox ? getCardCenter(fromBox, fromBox) : edge.anchorPoint
      const { length } = getStringPath(fromPoint, getCardCenter(toBox, toBox), fromBox, toBox)
      return drawMs(length)
    }
    const fresh = reveal.rootId !== rootNote.id
    if (fresh) {
      reveal.rootId = rootNote.id
      reveal.timings.clear()
    }
    // Edges come parent first, so a parent's timing is known before its children's.
    edges.forEach((edge) => {
      if (!reveal.timings.has(edge.toNoteId)) {
        const draw = drawMsFor(edge)
        const parent = edge.fromNoteId ? reveal.timings.get(edge.fromNoteId) : null
        const line = fresh ? lineStart(parent) : 0
        reveal.timings.set(edge.toNoteId, openTiming(line, draw))
      }
      const timing = reveal.timings.get(edge.toNoteId)
      edge.delay = timing.line
      edge.duration = timing.draw
    })
    nodes.forEach((node) => {
      node.revealDelay = reveal.timings.get(node.note.id)?.pop ?? 0
    })
    const closing = closeSchedule(edges)
    reveal.closeTotal = closing.total
    edges.forEach((edge) => { edge.close = closing.schedule.get(edge.toNoteId)?.string })
    nodes.forEach((node) => { node.close = closing.schedule.get(node.note.id)?.card })
    return { nodes, edges, positions, sizes, rootBase, rootPosition }
  }, [cardSizes, childMap, dragLayouts, drawnSizes, preview, reveal, rootNote])

  // Watch the cards as drawn (see drawnSizes) whenever the set of them changes.
  const cardIds = layout?.nodes.map(({ note }) => note.id).join(' ')
  useEffect(() => {
    const layer = layerRef.current
    if (!layer || !cardIds) return undefined
    const observer = new ResizeObserver((entries) => {
      setDrawnSizes((current) => {
        let next = current
        entries.forEach(({ target }) => {
          const id = target.dataset.noteId
          const size = {
            width: target.offsetWidth,
            height: target.offsetHeight,
            radius: parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0,
          }
          const was = current[id]
          if (was && was.width === size.width && was.height === size.height && was.radius === size.radius) return
          if (next === current) next = { ...current }
          next[id] = size
        })
        return next
      })
    })
    layer.querySelectorAll('.note-preview-card').forEach((card) => observer.observe(card))
    return () => observer.disconnect()
  }, [cardIds])

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

      // Each note chases where its parent is now, not where it will end up: the lag
      // passes down the branch, so a child trails the card being dragged and its own
      // child trails it in turn. Parents come first in layout.nodes, so a parent has
      // moved this frame before its children follow it.
      currentLayout.nodes.forEach(({ note }) => {
        const noteId = note.id
        if (!descendantIds.has(noteId)) return
        const settled = currentLayout.positions.get(noteId)
        if (!settled) {
          delete nextPositions[noteId]
          delete nextVelocity[noteId]
          return
        }
        const parentId = note.parentNoteId
        const parentSettled = parentId ? currentLayout.positions.get(parentId) : null
        const parentNow = parentId ? nextPositions[parentId] || parentSettled : null
        const target = parentSettled && parentNow
          ? { x: parentNow.x + (settled.x - parentSettled.x), y: parentNow.y + (settled.y - parentSettled.y) }
          : settled

        const current = nextPositions[noteId] || { ...settled }
        const velocity = nextVelocity[noteId] || { x: 0, y: 0 }

        velocity.x = (velocity.x + (target.x - current.x) * 0.12) * 0.72
        velocity.y = (velocity.y + (target.y - current.y) * 0.12) * 0.72

        const next = {
          x: current.x + velocity.x,
          y: current.y + velocity.y,
        }

        if (
          Math.abs(settled.x - next.x) > 0.35 ||
          Math.abs(settled.y - next.y) > 0.35 ||
          Math.abs(velocity.x) > 0.12 ||
          Math.abs(velocity.y) > 0.12
        ) {
          moving = true
          nextPositions[noteId] = next
          nextVelocity[noteId] = velocity
        } else {
          nextPositions[noteId] = { ...settled }
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
    const parentNote = noteById.get(parentId)
    // It goes where there is room: beside its parent, clear of every note showing.
    const boxOf = (id) => {
      const at = layout?.positions.get(id)
      const size = drawnSizes[id] || layout?.sizes.get(id)
      return at && size ? { x: at.x, y: at.y, width: size.width, height: size.height } : null
    }
    const parentBox = boxOf(parentId)
    const lights = trafficLightsBox(VIEWPORT_PADDING)
    const previewLayout = parentBox
      ? (() => {
          const others = (layout?.nodes || []).map(({ note }) => boxOf(note.id)).filter(Boolean)
          const spot = findOpenSpot(parentBox, { width: TILE_WIDTH, height: TILE_MIN_HEIGHT }, others, lights ? [lights] : [])
          return { offsetX: spot.x - parentBox.x, offsetY: spot.y - parentBox.y }
        })()
      : getDefaultChildOffset(currentChildren.length, currentChildren.length + 1)
    const newNote = touchNote(createFreeNote(parentNote?.color), {
      parentNoteId: parentId,
      previewLayout,
      collapsedChildren: false,
    })

    lockPreview()
    setNotesForDoc(preview.docName, (currentNotes) => [...currentNotes, newNote])
    setFocusNoteId(newNote.id)
  }, [childMap, drawnSizes, layout, lockPreview, noteById, preview, setNotesForDoc])

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

  // A card moves by its top band and resizes by its edges and corners, as a window does.
  const { handleCardPointerDown, cursorAt } = useNoteCardDrag({
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
  })

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
  }, [docNotes, preview, rootNote, setNotesForDoc, setPreview])

  const handlePasteImages = useCallback(async (noteId, event) => {
    const images = await readClipboardImages(event.clipboardData)
    if (images.length === 0) return

    event.preventDefault()
    event.stopPropagation()
    lockPreview()
    handleAddImages(noteId, images)
  }, [handleAddImages, lockPreview])

  if (!preview || !layout || !rootNote) return null

  // Each string, from the edge of its parent (or the dot) to the edge of its note, and
  // where it reaches the note: the note grows out from that point.
  const boxOf = (id) => {
    const at = elasticPositions[id] || layout.positions.get(id)
    const size = drawnSizes[id] || layout.sizes.get(id)
    return at && size ? { x: at.x, y: at.y, width: size.width, height: size.height } : null
  }
  const growFrom = new Map()
  const strings = layout.edges.flatMap((edge) => {
    const toBox = boxOf(edge.toNoteId)
    const fromBox = edge.fromNoteId ? boxOf(edge.fromNoteId) : null
    if (!toBox || (edge.fromNoteId && !fromBox)) return []
    const fromPoint = fromBox ? getCardCenter(fromBox, fromBox) : edge.anchorPoint
    const { d, start, end } = getStringPath(fromPoint, getCardCenter(toBox, toBox), fromBox, toBox)
    growFrom.set(edge.toNoteId, `${end.x - toBox.x}px ${end.y - toBox.y}px`)
    return [{ edge, path: d, start, end }]
  })

  return (
    <div ref={layerRef} className={`note-preview-layer${closing ? ' is-closing' : ''}`} style={{ '--note-color': noteColor(rootNote.color) }}>
      <svg
        className="note-preview-string"
        viewBox={`0 0 ${window.innerWidth} ${window.innerHeight}`}
        preserveAspectRatio="none"
        style={{ pointerEvents: 'none' }}
      >
        {/* The cards are a little see-through, so the strings stop at their edges. */}
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={window.innerWidth} height={window.innerHeight}>
            <rect x="0" y="0" width={window.innerWidth} height={window.innerHeight} fill="white" />
            {layout.nodes.map(({ note, position, size }) => {
              const at = elasticPositions[note.id] || position
              const drawn = drawnSizes[note.id] || size
              return <rect key={note.id} x={at.x} y={at.y} width={drawn.width} height={drawn.height} rx={drawn.radius ?? 0} fill="black" />
            })}
          </mask>
        </defs>
        <g mask={`url(#${maskId})`}>
          {strings.map(({ edge, path, start, end }) => {
            // A note recoloured away from its parent: the string blends from one to the other.
            const gradientId = edge.fromColor && edge.fromColor !== edge.color ? `${maskId}-${edge.id.replace(/[^a-zA-Z0-9_-]/g, '')}` : null
            return (
              <g key={edge.id} style={{ '--note-color': gradientId ? `url(#${gradientId})` : edge.color }}>
                {gradientId ? (
                  <defs>
                    <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={start.x} y1={start.y} x2={end.x} y2={end.y}>
                      <stop offset="0" style={{ stopColor: edge.fromColor }} />
                      <stop offset="1" style={{ stopColor: edge.color }} />
                    </linearGradient>
                  </defs>
                ) : null}
                <path
                  className="note-preview-string-shadow"
                  d={path}
                />
                <path
                  className="note-preview-string-path"
                  d={path}
                  pathLength="1"
                  style={{
                    '--string-delay': `${edge.delay}ms`,
                    '--string-ms': `${edge.duration}ms`,
                    '--string-close-delay': `${edge.close?.delay ?? 0}ms`,
                    '--string-close-ms': `${edge.close?.ms ?? STRING_CLOSE_MIN_MS}ms`,
                  }}
                />
              </g>
            )
          })}
        </g>
      </svg>

      {layout.nodes.map(({ note, position, size, childCount, revealDelay, close }) => {
        const renderPosition = elasticPositions[note.id] || position
        return (
          <article
            key={note.id}
            data-note-id={note.id}
            className={`note-preview-card${preview.locked ? ' locked' : ''}`}
            style={{
              left: `${renderPosition.x}px`,
              top: `${renderPosition.y}px`,
              width: `${size.width}px`,
              minHeight: `${size.height}px`,
              '--note-color': noteColor(note.color),
              '--note-reveal-delay': `${revealDelay}ms`,
              '--note-pop-ms': `${NOTE_POP_MS}ms`,
              '--note-close-delay': `${close?.delay ?? 0}ms`,
              '--note-close-ms': `${close?.ms ?? NOTE_CLOSE_MS}ms`,
              '--note-grow-from': growFrom.get(note.id),
            }}
            onPointerDown={(event) => handleCardPointerDown(note.id, event)}
            onPointerMove={(event) => {
              if (!dragStateRef.current) event.currentTarget.style.cursor = cursorAt(event)
            }}
            onMouseEnter={clearHideTimeout}
            onMouseLeave={() => {
              if (dragStateRef.current) return
              if (!preview.locked) scheduleHide()
            }}
          >
            {/* The band across the top moves the card; a click outside closes it. */}
            <div className="note-preview-header">
              {colorNoteId === note.id ? (
                // The note's own colour stays where its dot was; the others run out
                // to its right in a pill. Picking one, or a press elsewhere, closes it.
                <div
                  className="note-preview-ink-pill"
                  onPointerDown={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') return
                    event.stopPropagation()
                    setColorNoteId(null)
                  }}
                >
                  <InkPicker
                    label="Note colour"
                    value={noteInk(note)}
                    inks={[noteInk(note), ...NOTE_COLOR_OPTIONS.filter((ink) => ink !== noteInk(note))]}
                    onChange={(ink) => {
                      updateNote(note.id, (current) => touchNote(current, { color: ink }))
                      setColorNoteId(null)
                    }}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  className="note-tool-btn note-preview-tool note-preview-color"
                  onClick={(event) => {
                    event.stopPropagation()
                    lockPreview()
                    setColorNoteId(note.id)
                  }}
                  aria-label="Note colour"
                  title="Note colour"
                  aria-expanded={false}
                >
                  <span className="note-preview-color-dot" aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                className="note-tool-btn note-preview-tool"
                onClick={(event) => {
                  event.stopPropagation()
                  void handleDeleteNote(note.id)
                }}
                aria-label="Delete note branch"
                title="Delete note branch"
              >
                <Icon name="delete" />
              </button>
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
            <AudioClipList audio={note.audio} projectName={projectName} onChange={(audio) => handleChangeAudio(note.id, audio)} />

            <div className="note-preview-footer">
              <div className="note-preview-footer-start">
                <AudioRecordButton
                  audio={note.audio}
                  projectName={projectName}
                  onChange={(audio) => handleChangeAudio(note.id, audio)}
                  iconOnly
                />
                <button
                  type="button"
                  className="note-tool-btn note-preview-tool"
                  onClick={async (event) => {
                    event.stopPropagation()
                    lockPreview()
                    const images = await pickNoteImages()
                    if (images.length) handleAddImages(note.id, images)
                  }}
                  aria-label="Add image"
                  title="Add image"
                >
                  <Icon name="image" />
                </button>
              </div>

              <button
                type="button"
                className="note-tool-btn note-preview-tool"
                onClick={(event) => {
                  event.stopPropagation()
                  handleAddChild(note.id)
                }}
                aria-label={childCount > 0 ? 'Add another connected note' : 'Add connected note'}
                title={childCount > 0 ? 'Add another connected note' : 'Add connected note'}
              >
                <Icon name={childCount > 0 ? 'branch' : 'add'} />
              </button>

              <div className="note-preview-footer-end">
                {childCount > 0 ? (
                  <button
                    type="button"
                    className={`note-tool-btn note-preview-tool${note.collapsedChildren ? ' active' : ''}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      handleToggleCollapse(note.id)
                    }}
                    aria-label={note.collapsedChildren ? 'Expand branch' : 'Collapse branch'}
                    title={note.collapsedChildren ? 'Expand branch' : 'Collapse branch'}
                  >
                    <Icon name={note.collapsedChildren ? 'chevron-right' : 'chevron-down'} />
                  </button>
                ) : null}
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}
