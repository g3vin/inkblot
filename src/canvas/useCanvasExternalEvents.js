/**
 * useCanvasExternalEvents — everything the canvas is told to do from outside it.
 *
 * Links and Pinterest boards, documents dragged from the file tree, notes dragged
 * from the notes panel, commands from the native context menu, version restores
 * from the history panel, and reveal-a-node from search. All of it arrives as DOM
 * events on the surface or on the window, which is how the canvas stays decoupled
 * from the panels that drive it.
 */
import { useCallback, useEffect } from 'react'
import {
  normalizeCanvas,
  makeFileNode,
  makeLinkNode,
  makeNoteNode,
  makeTimelineEventNode,
  DEFAULT_FILE_NODE_SIZE,
  DEFAULT_TIMELINE_EVENT_NODE_SIZE,
  DEFAULT_LINK_NODE_SIZE,
  DEFAULT_NOTE_NODE_SIZE,
} from '../lib/canvasModel'
import { normalizePinterestBoardUrl } from '../lib/pinterestBoard'
import { docPathToFilePath } from './useDocPreview'
import { commitTimelineEdit } from '../lib/timeline/timelineEdits'
import { addLink } from '../lib/timeline/timelineModel'
import {
  CANVAS_COMMAND_EVENT,
  CANVAS_DROP_DOC_EVENT,
  CANVAS_DROP_NOTE_EVENT,
  CANVAS_DROP_TIMELINE_EVENT,
  CANVAS_RESTORE_EVENT,
  CANVAS_REVEAL_EVENT,
  dispatchCanvasDropNote,
  noteDragURL,
  takePendingCanvasReveal,
} from './canvasEvents'

export function useCanvasExternalEvents({
  addTextNodeAt,
  applyColor,
  centerOn,
  clear,
  deleteSelection,
  dispatch,
  docPath,
  projectName,
  groupSelection,
  handleToggleRecording,
  handleZoomToFit,
  importImageAt,
  onActivate,
  redo,
  resetZoom,
  reorderSelection,
  screenToWorldAt,
  selectNode,
  stateRef,
  surfaceRef,
  toggleLocked,
  toggleSnapPref,
  undo,
  ungroupSelection,
  viewCenter,
  zoomIn,
  zoomOut,
}) {
  /* ---------------- links and Pinterest boards ---------------- */

  const addLinkNodeAt = useCallback(
    (url, worldPoint) => {
      const node = makeLinkNode({
        url,
        x: worldPoint.x - DEFAULT_LINK_NODE_SIZE.width / 2,
        y: worldPoint.y - DEFAULT_LINK_NODE_SIZE.height / 2,
      })
      dispatch({ type: 'nodes/add', nodes: [node] })
      selectNode(node.id)
      return node
    },
    [dispatch, selectNode]
  )

  /**
   * Pasting a URL drops a link card — and a Pinterest board url becomes the board.
   * This mirrors what EditorCanvas's paste handler already does inside a document, so
   * the same copied link behaves the same way wherever you put it.
   *
   * Image pastes are handled in useCanvasImageImport and consume the event first;
   * this listener only ever sees a paste that carried no image.
   */
  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return

    const onPaste = (event) => {
      if (event.defaultPrevented) return

      const target = event.target
      if (target instanceof HTMLElement && target.closest('[contenteditable="true"], input, textarea')) {
        return
      }

      const text = event.clipboardData?.getData('text/plain')?.trim()
      if (!text || !/^https?:\/\//i.test(text)) return

      event.preventDefault()
      onActivate?.()
      addLinkNodeAt(normalizePinterestBoardUrl(text) || text, viewCenter())
    }

    surface.addEventListener('paste', onPaste)
    return () => surface.removeEventListener('paste', onPaste)
  }, [addLinkNodeAt, onActivate, surfaceRef, viewCenter])

  /* ---------------- documents dropped from the file tree ---------------- */

  const addDocNodeAt = useCallback(
    (docTreePath, worldPoint) => {
      const node = makeFileNode({
        // The node stores the REAL file path, per the spec — the tree path plus
        // `.json`. filePathToDocPath goes back the other way when opening it.
        file: docPathToFilePath(docTreePath),
        x: worldPoint.x - DEFAULT_FILE_NODE_SIZE.width / 2,
        y: worldPoint.y - DEFAULT_FILE_NODE_SIZE.height / 2,
      })
      dispatch({ type: 'nodes/add', nodes: [node] })
      selectNode(node.id)
      return node
    },
    [dispatch, selectNode]
  )

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return

    const onDropDoc = (event) => {
      const { path, clientX, clientY } = event.detail || {}
      if (!path) return
      // A canvas can reference another canvas, but not itself — that card would
      // preview the very document it lives in, and its minimap could never settle.
      if (path === docPath) return
      onActivate?.()
      addDocNodeAt(path, screenToWorldAt(clientX, clientY))
    }

    surface.addEventListener(CANVAS_DROP_DOC_EVENT, onDropDoc)
    return () => surface.removeEventListener(CANVAS_DROP_DOC_EVENT, onDropDoc)
  }, [addDocNodeAt, docPath, onActivate, screenToWorldAt, surfaceRef])

  /* ---------------- notes dropped from the notes panel ---------------- */

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return

    const onDropNote = (event) => {
      const { docPath: sourceDoc, noteId, clientX, clientY } = event.detail || {}
      if (!sourceDoc || !noteId) return

      onActivate?.()
      const point = screenToWorldAt(clientX, clientY)
      const node = makeNoteNode({
        // The note stays in its document; the card only points at it.
        file: docPathToFilePath(sourceDoc),
        noteId,
        x: point.x - DEFAULT_NOTE_NODE_SIZE.width / 2,
        y: point.y - DEFAULT_NOTE_NODE_SIZE.height / 2,
      })
      dispatch({ type: 'nodes/add', nodes: [node] })
      selectNode(node.id)
    }

    // The same note, dragged natively from the Swift shell's Notes panel: an HTML5
    // drop carrying its URL, turned into the event above at the drop point.
    const carriesURL = (event) => [...(event.dataTransfer?.types || [])].includes('text/uri-list')
    const onDragOver = (event) => {
      if (!carriesURL(event)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (event) => {
      if (!carriesURL(event)) return
      const note = noteDragURL(event.dataTransfer.getData('text/uri-list'))
      if (!note) return
      event.preventDefault()
      dispatchCanvasDropNote(surface, { ...note, clientX: event.clientX, clientY: event.clientY })
    }

    surface.addEventListener(CANVAS_DROP_NOTE_EVENT, onDropNote)
    surface.addEventListener('dragover', onDragOver)
    surface.addEventListener('drop', onDrop)
    return () => {
      surface.removeEventListener(CANVAS_DROP_NOTE_EVENT, onDropNote)
      surface.removeEventListener('dragover', onDragOver)
      surface.removeEventListener('drop', onDrop)
    }
  }, [dispatch, onActivate, screenToWorldAt, selectNode, surfaceRef])

  /* ---------------- timeline events dropped from a timeline view ---------------- */

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return undefined

    const onDropEvent = (event) => {
      const { eventId, clientX, clientY } = event.detail || {}
      if (!eventId) return
      onActivate?.()
      const point = screenToWorldAt(clientX, clientY)
      const node = makeTimelineEventNode({
        eventId,
        x: point.x - DEFAULT_TIMELINE_EVENT_NODE_SIZE.width / 2,
        y: point.y - DEFAULT_TIMELINE_EVENT_NODE_SIZE.height / 2,
      })
      dispatch({ type: 'nodes/add', nodes: [node] })
      selectNode(node.id)
      // The event lists the card among what it is linked to.
      if (projectName) void commitTimelineEdit(projectName, 'Put event on canvas', (tl) => addLink(tl, eventId, { kind: 'canvas', path: docPath, node: node.id }))
    }

    surface.addEventListener(CANVAS_DROP_TIMELINE_EVENT, onDropEvent)
    return () => surface.removeEventListener(CANVAS_DROP_TIMELINE_EVENT, onDropEvent)
  }, [dispatch, docPath, onActivate, projectName, screenToWorldAt, selectNode, surfaceRef])

  /* ---------------- commands from the native context menu ---------------- */

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return

    const onCommand = (event) => {
      const { command, clientX, clientY, color } = event.detail || {}
      const at = () =>
        Number.isFinite(clientX) ? screenToWorldAt(clientX, clientY) : viewCenter()

      switch (command) {
        case 'add-card':
          addTextNodeAt(at(), { edit: true })
          break
        case 'add-image':
          void importImageAt(at())
          break
        case 'record-memo':
          void handleToggleRecording()
          break
        case 'toggle-lock':
          toggleLocked()
          break
        case 'group':
          groupSelection()
          break
        case 'ungroup':
          ungroupSelection()
          break
        case 'delete':
          deleteSelection()
          break
        case 'bring-to-front':
          reorderSelection('front')
          break
        case 'send-to-back':
          reorderSelection('back')
          break
        case 'zoom-to-fit':
          handleZoomToFit()
          break
        // The rest are the canvas toolbar's, for a shell that draws it natively.
        case 'undo':
          undo()
          break
        case 'redo':
          redo()
          break
        case 'zoom-in':
          zoomIn()
          break
        case 'zoom-out':
          zoomOut()
          break
        case 'reset-zoom':
          resetZoom()
          break
        case 'toggle-guides':
          toggleSnapPref('guides')
          break
        case 'toggle-grid':
          toggleSnapPref('grid')
          break
        // `color` is a preset id ('1'–'6'), or absent for the default.
        case 'apply-color':
          applyColor(color || null)
          break
        default:
          break
      }
    }

    surface.addEventListener(CANVAS_COMMAND_EVENT, onCommand)
    return () => surface.removeEventListener(CANVAS_COMMAND_EVENT, onCommand)
  }, [
    addTextNodeAt,
    applyColor,
    deleteSelection,
    groupSelection,
    handleToggleRecording,
    handleZoomToFit,
    importImageAt,
    redo,
    resetZoom,
    reorderSelection,
    screenToWorldAt,
    surfaceRef,
    toggleLocked,
    toggleSnapPref,
    undo,
    ungroupSelection,
    viewCenter,
    zoomIn,
    zoomOut,
  ])

  /* ---------------- restore a version (from the history panel) ---------------- */

  useEffect(() => {
    // Restoring goes through the reducer as one doc/replace, so it is a single
    // undo step — stepping back from a restore is ⌘Z, same as any other edit.
    const onRestore = (event) => {
      const { docPath: target, canvas } = event.detail || {}
      if (target !== docPath || !canvas) return
      dispatch({ type: 'doc/replace', doc: normalizeCanvas(canvas) })
      clear()
    }

    window.addEventListener(CANVAS_RESTORE_EVENT, onRestore)
    return () => window.removeEventListener(CANVAS_RESTORE_EVENT, onRestore)
  }, [clear, dispatch, docPath])

  /* ---------------- reveal a node (from search) ---------------- */

  const revealNode = useCallback(
    (nodeId) => {
      const node = stateRef.current.nodes[nodeId]
      if (!node) return
      selectNode(nodeId)
      centerOn(node)
    },
    [centerOn, selectNode, stateRef]
  )

  useEffect(() => {
    // A search hit in a canvas that was not open asks for the reveal before this
    // surface exists; the request waits in canvasEvents and is claimed on mount.
    const pending = takePendingCanvasReveal(docPath)
    if (pending) revealNode(pending)

    // And a hit in the canvas already on screen arrives as an event, because
    // nothing remounts.
    const onReveal = (event) => {
      const { docPath: target, nodeId } = event.detail || {}
      if (target !== docPath) return
      takePendingCanvasReveal(docPath)
      revealNode(nodeId)
    }

    window.addEventListener(CANVAS_REVEAL_EVENT, onReveal)
    return () => window.removeEventListener(CANVAS_REVEAL_EVENT, onReveal)
  }, [docPath, revealNode])
}
