/**
 * CanvasSurface.jsx — the canvas itself: viewport, world layer, and contents.
 *
 * Mounted by CanvasPane only once the document has loaded, and keyed by doc path,
 * so it takes the loaded state and viewport as initial values rather than
 * juggling a "not ready yet" state internally.
 *
 * Structure:
 *   .canvas-surface   fixed to the pane; owns wheel/pointer input and the dot grid
 *     .canvas-world   one transformed layer; everything inside is world coords
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { debounce } from 'lodash'
import { CanvasToolbarSlotContext } from './canvasToolbarSlot'
import { saveCanvasDocument } from '../lib/canvasFileSystem'
import {
  expandGroupSelection,
  groupsToRefit,
  makeFileNode,
  makeTextNode,
  DEFAULT_TEXT_NODE_SIZE,
  DEFAULT_AUDIO_NODE_SIZE,
} from '../lib/canvasModel'
import { useAudioRecorder } from '../hooks/useAudioRecorder'
import { useCanvasViewport } from './useCanvasViewport'
import { useCanvasDocument } from './useCanvasDocument'
import { useCanvasSelection } from './useCanvasSelection'
import { loadSnapPrefs, saveSnapPrefs, useCanvasDrag } from './useCanvasDrag'
import { useCanvasConnect } from './useCanvasConnect'
import { useCanvasImageImport } from './useCanvasImageImport'
import { useCanvasKeyboard } from './useCanvasKeyboard'
import { useCanvasExternalEvents } from './useCanvasExternalEvents'
import { registerCanvasSurface } from './canvasEvents'
import { filePathToDocPath } from './useDocPreview'
import CanvasNode from './CanvasNode'
import CanvasEdges from './CanvasEdges'
import CanvasEdgeLabels from './CanvasEdgeLabels'
import CanvasToolbar from './CanvasToolbar'

const VIEWPORT_SAVE_DEBOUNCE_MS = 1200

export default function CanvasSurface({
  projectName,
  docPath,
  initialState,
  initialViewport,
  onActivate,
  onOpenDoc,
  setActiveEditor,
  isActive = true,
}) {
  const toolbarSlot = useContext(CanvasToolbarSlotContext)
  const stateRef = useRef(initialState)

  // At most one card holds a live TipTap editor. Everything else is static HTML.
  const [editingNodeId, setEditingNodeId] = useState(null)
  const [editingEdgeId, setEditingEdgeId] = useState(null)

  /*
   * READ MODE. Locked, the canvas stops being editable and starts being readable: you
   * can pan, zoom, follow links, play a memo, and — the point of it — SCROLL a card's
   * contents, because the wheel is handed to whatever is under it instead of being
   * swallowed to pan. Nothing can be dragged, resized, selected, or created.
   *
   * The ref is what the (native, non-React) wheel listener reads; the state is what
   * the UI renders from.
   */
  const [locked, setLocked] = useState(false)
  const lockedRef = useRef(locked)
  useEffect(() => {
    lockedRef.current = locked
  }, [locked])

  const toggleLocked = useCallback(() => setLocked((current) => !current), [])

  // Panning is not an edit: it saves on its own slow debounce and never enters
  // the undo history. Edits save separately, in useCanvasDocument.
  const saveViewport = useMemo(
    () =>
      debounce((nextState, nextViewport) => {
        void saveCanvasDocument(projectName, docPath, nextState, nextViewport)
      }, VIEWPORT_SAVE_DEBOUNCE_MS),
    [docPath, projectName]
  )

  const handleViewportChange = useCallback(
    (nextViewport) => saveViewport(stateRef.current, nextViewport),
    [saveViewport]
  )

  useEffect(
    () => () => {
      saveViewport.flush()
      saveViewport.cancel()
    },
    [saveViewport]
  )

  const {
    surfaceRef,
    worldRef,
    viewport,
    viewportRef,
    screenToWorldAt,
    startPan,
    isPanning,
    spaceHeld,
    zoomIn,
    zoomOut,
    resetZoom,
    zoomToFit,
    centerOn,
  } = useCanvasViewport({ initialViewport, onViewportChange: handleViewportChange, lockedRef })

  const { state, dispatch, undo, redo, canUndo, canRedo } = useCanvasDocument({
    projectName,
    docPath,
    initialState,
    viewportRef,
  })

  const { selection, selectionRef, marquee, clear, selectNode, selectEdge, selectAll, startMarquee } =
    useCanvasSelection()

  useEffect(() => {
    stateRef.current = state
  }, [state])

  // id → the edge's <path>, so a drag can rewrite `d` without a React render.
  const edgeElsRef = useRef(new Map())
  const pendingEdgeRef = useRef(null)
  // The two <line>s of the alignment-guide layer, painted directly during a drag.
  const guidesRef = useRef(null)

  /*
   * How a drag settles. Both default on and persist across sessions — this is a
   * preference about how the tool behaves, not about the document, so it does not
   * belong in the canvas file.
   *
   * The ref shadows the state because the drag's pointer handlers are bound once
   * per gesture and must read the live value.
   */
  const [snapPrefs, setSnapPrefs] = useState(loadSnapPrefs)
  const snapPrefsRef = useRef(snapPrefs)

  useEffect(() => {
    snapPrefsRef.current = snapPrefs
    saveSnapPrefs(snapPrefs)
  }, [snapPrefs])

  const toggleSnapPref = useCallback((key) => {
    setSnapPrefs((current) => ({ ...current, [key]: !current[key] }))
  }, [])

  const registerEdgeEl = useCallback((id, el) => {
    if (el) edgeElsRef.current.set(id, el)
    else edgeElsRef.current.delete(id)
  }, [])

  const { registerNodeEl, startMove, startResize } = useCanvasDrag({
    viewportRef,
    dispatch,
    stateRef,
    edgeElsRef,
    guidesRef,
    snapPrefsRef,
  })

  const { startConnect } = useCanvasConnect({
    dispatch,
    screenToWorldAt,
    pendingEdgeRef,
  })

  const { importImageAt } = useCanvasImageImport({
    projectName,
    surfaceRef,
    screenToWorldAt,
    dispatch,
    selectNode,
    onActivate,
  })

  /* ---------------- creating and editing nodes ---------------- */

  const addTextNodeAt = useCallback(
    (worldPoint, { edit = false } = {}) => {
      const node = makeTextNode({
        // Drop the card centered on the point the user aimed at.
        x: worldPoint.x - DEFAULT_TEXT_NODE_SIZE.width / 2,
        y: worldPoint.y - DEFAULT_TEXT_NODE_SIZE.height / 2,
      })
      dispatch({ type: 'nodes/add', nodes: [node] })
      selectNode(node.id)
      // A brand-new card is empty, so drop straight into it rather than making
      // the user double-click the thing they just created.
      if (edit) setEditingNodeId(node.id)
      return node
    },
    [dispatch, selectNode]
  )

  const commitCardText = useCallback(
    (id, patch) => {
      // The whole editing session lands as one patch, so it is one undo step —
      // and it never fights the debounced save with per-keystroke writes.
      dispatch({ type: 'nodes/patch', id, patch })
    },
    [dispatch]
  )

  const commitGroupLabel = useCallback(
    (id, label) => dispatch({ type: 'nodes/patch', id, patch: { label } }),
    [dispatch]
  )

  const stopEditing = useCallback(() => setEditingNodeId(null), [])

  const openDoc = useCallback(
    (node) => onOpenDoc?.(filePathToDocPath(node.file)),
    [onOpenDoc]
  )

  /* ---------------- groups ---------------- */

  const groupSelection = useCallback(() => {
    const nodeIds = [...selectionRef.current.nodes].filter(
      (id) => stateRef.current.nodes[id]?.type !== 'group'
    )
    if (!nodeIds.length) return
    dispatch({ type: 'group/create', nodeIds })
  }, [dispatch, selectionRef])

  const ungroupSelection = useCallback(() => {
    const groupIds = [...selectionRef.current.nodes].filter(
      (id) => stateRef.current.nodes[id]?.type === 'group'
    )
    if (!groupIds.length) return
    dispatch({ type: 'group/ungroup', groupIds })
    clear()
  }, [clear, dispatch, selectionRef])

  /* ---------------- colors ---------------- */

  // One action for the whole selection, so recoloring six cards is one undo step.
  const applyColor = useCallback(
    (color) => {
      const current = selectionRef.current
      const patches = {}
      for (const id of current.nodes) {
        // An unset color means "use the theme accent" — that is what null encodes,
        // and the spec wants the key absent rather than holding an empty string.
        patches[id] = { color: color || undefined }
      }
      if (Object.keys(patches).length) dispatch({ type: 'nodes/patchMany', patches })

      for (const id of current.edges) {
        dispatch({ type: 'edges/patch', id, patch: { color: color || undefined } })
      }
    },
    [dispatch, selectionRef]
  )

  /* ---------------- surface input ---------------- */

  // Capture phase, because a press on a node or an edge stops propagation before
  // it reaches the bubble handler below — and focus has to happen either way, or
  // the surface's keyboard and paste listeners never fire (it is tabIndex=-1 for
  // exactly this reason).
  const handleSurfacePointerDownCapture = useCallback(
    (event) => {
      onActivate?.()

      // Never steal focus from a card being edited, or from the edge-label input.
      const target = event.target
      const inTextField =
        target instanceof HTMLElement &&
        target.closest('input, textarea, [contenteditable="true"]')

      if (!inTextField && surfaceRef.current !== document.activeElement) {
        surfaceRef.current?.focus({ preventScroll: true })
      }
    },
    [onActivate, surfaceRef]
  )

  const handleSurfacePointerDown = useCallback(
    (event) => {
      // Reaching the bubble phase at all means the press missed every node, edge,
      // and card editor — they all stop propagation.
      if (editingNodeId) stopEditing()

      if (startPan(event)) return
      if (event.button !== 0) return
      // Read mode: nothing is selectable, so there is no marquee to start.
      if (locked) return

      // Only a press on the background itself starts a marquee — a press that
      // landed on a node is that node's drag, and it stopped propagation.
      if (event.target !== surfaceRef.current && event.target !== worldRef.current) return

      startMarquee(event, {
        toWorld: screenToWorldAt,
        getState: () => stateRef.current,
        additive: event.shiftKey,
      })
    },
    [editingNodeId, locked, screenToWorldAt, startMarquee, startPan, stopEditing, surfaceRef, worldRef]
  )

  const handleSurfaceDoubleClick = useCallback(
    (event) => {
      if (locked) return
      if (event.target !== surfaceRef.current && event.target !== worldRef.current) return
      addTextNodeAt(screenToWorldAt(event.clientX, event.clientY), { edit: true })
    },
    [addTextNodeAt, locked, screenToWorldAt, surfaceRef, worldRef]
  )

  /* ---------------- node input ---------------- */

  const handleNodePointerDown = useCallback(
    (event, node) => {
      onActivate?.()
      if (event.button !== 0 || spaceHeld) return
      // Read mode: a press on a card is for reading it, not for moving it.
      if (locked) return

      const additive = event.shiftKey || event.metaKey
      const alreadySelected = selectionRef.current.nodes.has(node.id)

      // Dragging a node that is part of a multi-selection must move the whole
      // selection, so don't collapse the selection to this one node first.
      if (!alreadySelected || additive) {
        selectNode(node.id, { additive })
      }

      const ids =
        additive || !alreadySelected
          ? [node.id, ...(additive ? selectionRef.current.nodes : [])]
          : [...selectionRef.current.nodes]

      // Dragging a group carries whatever it currently encloses. Membership is
      // resolved HERE, at pointer-down, and never stored — see groupMemberIds.
      const moving = expandGroupSelection(stateRef.current, [...new Set(ids)])

      startMove(event, {
        ids: moving,
        state: stateRef.current,
        // Groups the drag reaches into must stretch (or close up) to keep holding
        // what they held when it started.
        fitGroups: groupsToRefit(stateRef.current, moving),
      })
    },
    [locked, onActivate, selectNode, selectionRef, spaceHeld, startMove]
  )

  const handleResizePointerDown = useCallback(
    (event, node, handle) => {
      if (locked) return
      startResize(event, {
        id: node.id,
        handle,
        state: stateRef.current,
        fitGroups: groupsToRefit(stateRef.current, [node.id]),
      })
    },
    [locked, startResize]
  )

  const handleConnectPointerDown = useCallback(
    (event, node, side) => {
      onActivate?.()
      if (event.button !== 0 || locked) return
      startConnect(event, { node, side, state: stateRef.current })
    },
    [locked, onActivate, startConnect]
  )

  const handleEdgePointerDown = useCallback(
    (event, edge) => {
      event.stopPropagation()
      if (event.button !== 0) return
      selectEdge(edge.id, { additive: event.shiftKey || event.metaKey })
    },
    [selectEdge]
  )

  const handleEdgeDoubleClick = useCallback((event, edge) => {
    event.stopPropagation()
    setEditingEdgeId(edge.id)
  }, [])

  const commitEdgeLabel = useCallback(
    (id, label) => dispatch({ type: 'edges/patch', id, patch: { label } }),
    [dispatch]
  )

  const stopEditingEdge = useCallback(() => setEditingEdgeId(null), [])

  const deleteSelection = useCallback(() => {
    const current = selectionRef.current
    if (!current.nodes.size && !current.edges.size) return
    dispatch({
      type: 'selection/delete',
      nodeIds: [...current.nodes],
      edgeIds: [...current.edges],
    })
    clear()
  }, [clear, dispatch, selectionRef])

  useCanvasKeyboard({
    clear,
    deleteSelection,
    groupSelection,
    locked,
    redo,
    selectAll,
    selectionRef,
    stateRef,
    surfaceRef,
    toggleLocked,
    undo,
    ungroupSelection,
  })

  /* ---------------- toolbar ---------------- */

  const handleZoomToFit = useCallback(() => {
    const current = stateRef.current
    zoomToFit(current.nodeOrder.map((id) => current.nodes[id]))
  }, [zoomToFit])

  /** The world point at the middle of the visible area — where a command with no
   *  pointer position of its own should drop what it creates. */
  const viewCenter = useCallback(() => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return screenToWorldAt(rect.left + rect.width / 2, rect.top + rect.height / 2)
  }, [screenToWorldAt, surfaceRef])

  const handleAddCard = useCallback(() => {
    addTextNodeAt(viewCenter(), { edit: true })
  }, [addTextNodeAt, viewCenter])

  const handleAddImage = useCallback(() => {
    void importImageAt(viewCenter())
  }, [importImageAt, viewCenter])

  /* ---------------- voice memos ---------------- */

  /**
   * Record straight onto the canvas: press to start, press again to stop, and the memo
   * lands as a card where you were looking.
   *
   * Until now the only way to get a memo onto a canvas was to attach it to a note in a
   * document and drag that note over — which is no use when the thought you want to
   * capture isn't attached to anything yet.
   */
  const recorder = useAudioRecorder(projectName)

  const handleToggleRecording = useCallback(async () => {
    if (!recorder.recording) {
      await recorder.start()
      return
    }

    const clip = await recorder.stop()
    if (!clip) return

    const point = viewCenter()
    const node = makeFileNode({
      file: clip.src,
      // Keep the captured length on the node: a MediaRecorder blob often reports an
      // Infinite duration until it has been fully seeked, so the player would have
      // nothing to show.
      inkblotDurationMs: clip.durationMs,
      x: point.x - DEFAULT_AUDIO_NODE_SIZE.width / 2,
      y: point.y - DEFAULT_AUDIO_NODE_SIZE.height / 2,
      ...DEFAULT_AUDIO_NODE_SIZE,
    })

    dispatch({ type: 'nodes/add', nodes: [node] })
    selectNode(node.id)
  }, [dispatch, recorder, selectNode, viewCenter])

  useCanvasExternalEvents({
    addTextNodeAt,
    centerOn,
    clear,
    deleteSelection,
    dispatch,
    docPath,
    groupSelection,
    handleToggleRecording,
    handleZoomToFit,
    importImageAt,
    onActivate,
    screenToWorldAt,
    selectNode,
    stateRef,
    surfaceRef,
    toggleLocked,
    ungroupSelection,
    viewCenter,
  })


  // Claim an id for this surface, so the bridge can address it without hit-testing
  // the DOM — which a native shell cannot do. See canvasEvents' surface-id section.
  useEffect(() => registerCanvasSurface(surfaceRef.current), [surfaceRef])

  const isEmpty = state.nodeOrder.length === 0
  const hasSelection = selection.nodes.size > 0 || selection.edges.size > 0
  const canGroup = [...selection.nodes].some((id) => state.nodes[id]?.type !== 'group')
  const canUngroup = [...selection.nodes].some((id) => state.nodes[id]?.type === 'group')

  return (
    <div
      ref={surfaceRef}
      className={`canvas-surface${isPanning ? ' is-panning' : ''}${spaceHeld ? ' is-pannable' : ''}${
        locked ? ' is-locked' : ''
      }`}
      tabIndex={-1}
      onPointerEnter={onActivate}
      onPointerDownCapture={handleSurfacePointerDownCapture}
      onPointerDown={handleSurfacePointerDown}
      onDoubleClick={handleSurfaceDoubleClick}
      // Middle-click otherwise pastes or starts autoscroll depending on platform.
      onAuxClick={(event) => event.preventDefault()}
    >
      <div ref={worldRef} className="canvas-world">
        {/* Behind the nodes, so an arrow tucks under the cards it joins. */}
        <CanvasEdges
          state={state}
          selection={selection}
          registerEdgeEl={registerEdgeEl}
          onEdgePointerDown={handleEdgePointerDown}
          onEdgeDoubleClick={handleEdgeDoubleClick}
          pendingEdgeRef={pendingEdgeRef}
        />

        {state.nodeOrder.map((id) => (
          <CanvasNode
            key={id}
            node={state.nodes[id]}
            projectName={projectName}
            selected={selection.nodes.has(id)}
            editing={editingNodeId === id}
            locked={locked}
            registerNodeEl={registerNodeEl}
            setActiveEditor={setActiveEditor}
            onPointerDown={handleNodePointerDown}
            onResizePointerDown={handleResizePointerDown}
            onConnectPointerDown={handleConnectPointerDown}
            onStartEditing={setEditingNodeId}
            onCommitText={commitCardText}
            onExitEditing={stopEditing}
            onOpenDoc={openDoc}
            onCommitGroupLabel={commitGroupLabel}
          />
        ))}

        <CanvasEdgeLabels
          state={state}
          editingEdgeId={editingEdgeId}
          onCommitLabel={commitEdgeLabel}
          onStopEditing={stopEditingEdge}
        />

        {/* Alignment guides. The two lines are rendered once and then shown, hidden,
            and repositioned straight from useCanvasDrag's rAF — a drag dispatches
            nothing until pointer-up, so these cannot be React state. */}
        <svg ref={guidesRef} className="canvas-guides" aria-hidden="true">
          <line data-axis="x" style={{ display: 'none' }} />
          <line data-axis="y" style={{ display: 'none' }} />
        </svg>

        {marquee ? (
          <div
            className="canvas-marquee"
            style={{
              transform: `translate3d(${marquee.x}px, ${marquee.y}px, 0)`,
              width: `${marquee.width}px`,
              height: `${marquee.height}px`,
            }}
          />
        ) : null}

        {/* Inside the world layer, at the origin: the hint belongs to the CANVAS, not
            to the window over it. Pinned to the viewport it would follow the user
            around as they panned, which reads as a stuck overlay rather than as the
            empty document itself. */}
        {isEmpty ? (
          <div className="canvas-placeholder">
            <p className="canvas-placeholder-title">Empty canvas</p>
            <p className="canvas-placeholder-hint">
              Double-click to add a card · scroll to pan · ⌘-scroll to zoom · hold space to drag
            </p>
            <p className="canvas-placeholder-hint">Double-click a card to edit it</p>
          </div>
        ) : null}
      </div>

      {/* The toolbar renders in the titlebar, not over the canvas. The slot is
          null unless this is the active pane's canvas and no card is being
          edited — when one is, the text Toolbar takes the titlebar instead. */}
      {isActive && toolbarSlot ? createPortal(
        <CanvasToolbar
          zoom={viewport.zoom}
          canUndo={canUndo}
          canRedo={canRedo}
          hasSelection={hasSelection}
          canGroup={canGroup}
          canUngroup={canUngroup}
          onAddCard={handleAddCard}
          onAddImage={handleAddImage}
          locked={locked}
          onToggleLocked={toggleLocked}
          alignmentGuides={snapPrefs.guides}
          snapToGrid={snapPrefs.grid}
          onToggleAlignmentGuides={() => toggleSnapPref('guides')}
          onToggleSnapToGrid={() => toggleSnapPref('grid')}
          canRecord={recorder.supported}
          isRecording={recorder.recording}
          recordElapsed={recorder.elapsed}
          onToggleRecording={handleToggleRecording}
          onGroup={groupSelection}
          onUngroup={ungroupSelection}
          onApplyColor={applyColor}
          onUndo={undo}
          onRedo={redo}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onResetZoom={resetZoom}
          onZoomToFit={handleZoomToFit}
        />,
        toolbarSlot,
      ) : null}
    </div>
  )
}
