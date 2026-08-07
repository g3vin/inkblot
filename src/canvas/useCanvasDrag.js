/**
 * useCanvasDrag.js — moving and resizing nodes.
 *
 * A drag dispatches NOTHING until the pointer comes up. In between it writes
 * transforms straight to the DOM inside a rAF, so dragging fifty selected cards
 * costs zero React renders instead of fifty per frame. On release, one action
 * lands — which is also what makes the whole gesture a single undo step.
 *
 * Pointer plumbing follows NoteHoverPreview.jsx: capture-phase window listeners
 * and a small movement threshold, so a sloppy click still reads as a click.
 */
import { useCallback, useRef } from 'react'
import { edgeGeometry, nodesBounds } from '../lib/canvasGeometry'
import { groupFitRect, MIN_NODE_SIZE } from '../lib/canvasModel'
import { computeSnap, paintGuides, snapCandidates, SNAP_THRESHOLD_PX } from './useCanvasSnapping'
import { GRID_SIZE } from './useCanvasViewport'

const DRAG_MIN_DELTA = 3

/** Which edges of the node a handle moves. 'move' is the body. */
const HANDLES = {
  nw: { x: 1, y: 1, w: -1, h: -1 },
  n: { x: 0, y: 1, w: 0, h: -1 },
  ne: { x: 0, y: 1, w: 1, h: -1 },
  e: { x: 0, y: 0, w: 1, h: 0 },
  se: { x: 0, y: 0, w: 1, h: 1 },
  s: { x: 0, y: 0, w: 0, h: 1 },
  sw: { x: 1, y: 0, w: -1, h: 1 },
  w: { x: 1, y: 0, w: -1, h: 0 },
}

export const RESIZE_HANDLES = Object.keys(HANDLES)

export const nodeTransform = (node) => `translate3d(${node.x}px, ${node.y}px, 0)`

export const DEFAULT_SNAP_PREFS = { guides: true, grid: true }
const EMPTY_SNAP = { dx: 0, dy: 0, guides: [] }

const SNAP_PREFS_STORAGE_KEY = 'inkblot.canvas.snap'

/** Both snapping behaviours are on for a new user; each is remembered once changed. */
export const loadSnapPrefs = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(SNAP_PREFS_STORAGE_KEY) || '{}')
    return {
      guides: parsed.guides !== false,
      grid: parsed.grid !== false,
    }
  } catch {
    return { ...DEFAULT_SNAP_PREFS }
  }
}

export const saveSnapPrefs = (prefs) => {
  try {
    localStorage.setItem(SNAP_PREFS_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // A preference that fails to persist is not worth breaking a drag over.
  }
}

export function useCanvasDrag({ viewportRef, dispatch, stateRef, edgeElsRef, guidesRef, snapPrefsRef }) {
  // id → the node's DOM element, registered by CanvasNode on mount.
  const nodeElsRef = useRef(new Map())
  const frameRef = useRef(0)
  const draggingRef = useRef(false)

  const registerNodeEl = useCallback((id, el) => {
    if (el) nodeElsRef.current.set(id, el)
    else nodeElsRef.current.delete(id)
  }, [])

  /**
   * Redraw every edge touching a node that just moved. Runs in the same frame as
   * the node transforms, so an edge never lags a card by a frame.
   */
  const repaintEdges = useCallback((moved) => {
    if (!edgeElsRef?.current?.size) return
    const state = stateRef.current

    for (const id of state.edgeOrder) {
      const edge = state.edges[id]
      const el = edgeElsRef.current.get(id)
      if (!edge || !el) continue
      if (!moved[edge.fromNode] && !moved[edge.toNode]) continue

      // Take the live geometry for the nodes being dragged, stored geometry for
      // the ones standing still.
      const fromNode = { ...state.nodes[edge.fromNode], ...moved[edge.fromNode] }
      const toNode = { ...state.nodes[edge.toNode], ...moved[edge.toNode] }
      const geometry = edgeGeometry(edge, fromNode, toNode)
      if (geometry) el.setAttribute('d', geometry.d)
    }
  }, [edgeElsRef, stateRef])

  /** Paint a set of node geometries (and any alignment guides) without going
   *  through React. Everything lands in one frame, so an edge or a guide never
   *  trails the card it belongs to. */
  const paint = useCallback((geometry, guides = []) => {
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      for (const [id, rect] of Object.entries(geometry)) {
        const el = nodeElsRef.current.get(id)
        if (!el) continue
        el.style.transform = nodeTransform(rect)
        if (rect.width != null) {
          el.style.width = `${rect.width}px`
          el.style.height = `${rect.height}px`
        }
      }
      repaintEdges(geometry)
      paintGuides(guidesRef?.current, guides)
    })
  }, [guidesRef, repaintEdges])

  const endGesture = useCallback(() => {
    cancelAnimationFrame(frameRef.current)
    frameRef.current = 0
    draggingRef.current = false
    paintGuides(guidesRef?.current, [])
  }, [guidesRef])

  /**
   * Move every node in `ids`. Returns immediately; the caller should already have
   * updated the selection so the dragged node is part of it, and should already
   * have expanded any groups in it to their members (expandGroupSelection).
   */
  const startMove = useCallback((event, { ids, state, fitGroups }) => {
    if (!ids.length) return
    event.preventDefault()
    event.stopPropagation()

    const startX = event.clientX
    const startY = event.clientY
    const origins = {}
    const movingNodes = []
    for (const id of ids) {
      const node = state.nodes[id]
      if (!node) continue
      origins[id] = { x: node.x, y: node.y }
      movingNodes.push(node)
    }

    // Built once, not per frame: the only nodes that could move during this gesture
    // are the ones being dragged, so the things to snap against cannot change.
    const candidates = snapCandidates(state, ids)
    const startBounds = nodesBounds(movingNodes)

    /**
     * The rects the touched groups must take to keep holding their members. Computed
     * from the SAME positions that get painted, so the frame the user sees and the
     * state that commits can never disagree.
     */
    const groupRects = (positions) => {
      const rects = {}
      for (const [groupId, memberIds] of Object.entries(fitGroups || {})) {
        const members = memberIds
          .map((id) => {
            const node = state.nodes[id]
            if (!node) return null
            const moved = positions[id]
            return moved ? { ...node, x: moved.x, y: moved.y } : node
          })
          .filter(Boolean)

        const rect = groupFitRect(
          Object.fromEntries(members.map((node) => [node.id, node])),
          members.map((node) => node.id)
        )
        if (rect) rects[groupId] = rect
      }
      return rects
    }

    let moved = false

    /**
     * The drag delta after snapping. Both the live paint and the commit call this,
     * so the position that lands is exactly the one the user was shown.
     */
    const resolve = (clientX, clientY, disableSnap) => {
      const { zoom } = viewportRef.current
      const dx = (clientX - startX) / zoom
      const dy = (clientY - startY) / zoom

      if (disableSnap || !startBounds) return { dx, dy, guides: [] }

      // Read live: the toggles can be flipped mid-drag, and the pointer handlers
      // are bound once.
      const { guides: useGuides, grid: useGrid } = snapPrefsRef?.current || DEFAULT_SNAP_PREFS
      const bounds = { ...startBounds, x: startBounds.x + dx, y: startBounds.y + dy }

      // The threshold is a screen distance, so it must shrink in world units as the
      // user zooms in — otherwise snapping gets stickier the closer you look.
      const snap = useGuides
        ? computeSnap(bounds, candidates, SNAP_THRESHOLD_PX / zoom)
        : EMPTY_SNAP

      let outDx = dx + snap.dx
      let outDy = dy + snap.dy

      /*
       * The two kinds of snap resolve PER AXIS, and alignment wins the axes it
       * claims. Lining up with a neighbour is a deliberate aim; the grid is a
       * background convenience, and letting it pull a card back off an edge it had
       * just snapped to would make the guides a lie. An axis alignment did not
       * claim is still free, so the grid takes that one.
       */
      if (useGrid) {
        const snappedX = snap.guides.some((guide) => guide.axis === 'x')
        const snappedY = snap.guides.some((guide) => guide.axis === 'y')

        if (!snappedX) outDx = dx + (Math.round(bounds.x / GRID_SIZE) * GRID_SIZE - bounds.x)
        if (!snappedY) outDy = dy + (Math.round(bounds.y / GRID_SIZE) * GRID_SIZE - bounds.y)
      }

      return { dx: outDx, dy: outDy, guides: snap.guides }
    }

    const onMove = (moveEvent) => {
      const dxScreen = moveEvent.clientX - startX
      const dyScreen = moveEvent.clientY - startY

      if (!moved) {
        if (Math.abs(dxScreen) < DRAG_MIN_DELTA && Math.abs(dyScreen) < DRAG_MIN_DELTA) return
        moved = true
        draggingRef.current = true
      }

      // Alt suspends snapping, the way it does in every other canvas tool — it is
      // the escape hatch when a card needs to sit just off a neighbour's edge.
      const { dx, dy, guides } = resolve(moveEvent.clientX, moveEvent.clientY, moveEvent.altKey)

      const positions = {}
      for (const [id, origin] of Object.entries(origins)) {
        positions[id] = { x: origin.x + dx, y: origin.y + dy }
      }
      // Groups grow and shrink under the cursor, in the same frame as the cards.
      paint({ ...positions, ...groupRects(positions) }, guides)
    }

    const onUp = (upEvent) => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)

      if (moved) {
        const { dx, dy } = resolve(upEvent.clientX, upEvent.clientY, upEvent.altKey)

        const positions = {}
        for (const [id, origin] of Object.entries(origins)) {
          positions[id] = { x: origin.x + dx, y: origin.y + dy }
        }
        // One action for the whole gesture — one undo step, groups included.
        dispatch({ type: 'nodes/setPositions', positions, fitGroups })
      }

      endGesture()
    }

    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
  }, [dispatch, endGesture, paint, snapPrefsRef, viewportRef])

  /** Resize one node from one of its eight handles. */
  const startResize = useCallback((event, { id, handle, state, fitGroups }) => {
    const node = state.nodes[id]
    const spec = HANDLES[handle]
    if (!node || !spec) return

    event.preventDefault()
    event.stopPropagation()

    const startX = event.clientX
    const startY = event.clientY
    const origin = { x: node.x, y: node.y, width: node.width, height: node.height }

    const compute = (clientX, clientY) => {
      const { zoom } = viewportRef.current
      const dx = (clientX - startX) / zoom
      const dy = (clientY - startY) / zoom

      // Clamp the delta so a west/north handle can't push past the minimum size
      // and start dragging the opposite edge backwards.
      const maxDx = spec.w < 0 ? origin.width - MIN_NODE_SIZE.width : Infinity
      const minDx = spec.w > 0 ? MIN_NODE_SIZE.width - origin.width : -Infinity
      const maxDy = spec.h < 0 ? origin.height - MIN_NODE_SIZE.height : Infinity
      const minDy = spec.h > 0 ? MIN_NODE_SIZE.height - origin.height : -Infinity

      const cdx = Math.min(maxDx, Math.max(minDx, dx))
      const cdy = Math.min(maxDy, Math.max(minDy, dy))

      return {
        x: origin.x + spec.x * cdx,
        y: origin.y + spec.y * cdy,
        width: origin.width + spec.w * cdx,
        height: origin.height + spec.h * cdy,
      }
    }

    draggingRef.current = true

    /** Groups holding the node being resized must grow or shrink with it. */
    const groupRects = (rect) => {
      const rects = {}
      for (const [groupId, memberIds] of Object.entries(fitGroups || {})) {
        const members = memberIds
          .map((memberId) => {
            const member = state.nodes[memberId]
            if (!member) return null
            return memberId === id ? { ...member, ...rect } : member
          })
          .filter(Boolean)

        const fitted = groupFitRect(
          Object.fromEntries(members.map((member) => [member.id, member])),
          members.map((member) => member.id)
        )
        if (fitted) rects[groupId] = fitted
      }
      return rects
    }

    const onMove = (moveEvent) => {
      const rect = compute(moveEvent.clientX, moveEvent.clientY)
      paint({ [id]: rect, ...groupRects(rect) })
    }

    const onUp = (upEvent) => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)

      dispatch({
        type: 'nodes/setRects',
        rects: { [id]: compute(upEvent.clientX, upEvent.clientY) },
        fitGroups,
      })
      endGesture()
    }

    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
  }, [dispatch, endGesture, paint, viewportRef])

  return { registerNodeEl, nodeElsRef, startMove, startResize, draggingRef }
}
