/**
 * useCanvasSelection.js — which nodes and edges are selected, and the marquee.
 *
 * The marquee rect is tracked in world coordinates so it stays anchored to the
 * content if the user pans or zooms mid-drag. Hit-testing runs once on pointerup,
 * not per frame — a flat AABB pass over a few hundred nodes is free, and doing it
 * live would just burn renders.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { rectFromPoints, rectsIntersect } from '../lib/canvasGeometry'

const EMPTY = Object.freeze({ nodes: new Set(), edges: new Set() })

export function useCanvasSelection() {
  const [selection, setSelection] = useState(EMPTY)
  const [marquee, setMarquee] = useState(null)
  const selectionRef = useRef(selection)

  const commit = useCallback((next) => {
    selectionRef.current = next
    setSelection(next)
  }, [])

  const clear = useCallback(() => {
    if (!selectionRef.current.nodes.size && !selectionRef.current.edges.size) return
    commit(EMPTY)
  }, [commit])

  const selectNode = useCallback((id, { additive = false } = {}) => {
    const current = selectionRef.current
    if (!additive) {
      if (current.nodes.size === 1 && current.nodes.has(id) && !current.edges.size) return
      commit({ nodes: new Set([id]), edges: new Set() })
      return
    }
    const nodes = new Set(current.nodes)
    if (nodes.has(id)) nodes.delete(id)
    else nodes.add(id)
    commit({ nodes, edges: new Set(current.edges) })
  }, [commit])

  const selectEdge = useCallback((id, { additive = false } = {}) => {
    const current = selectionRef.current
    if (!additive) {
      commit({ nodes: new Set(), edges: new Set([id]) })
      return
    }
    const edges = new Set(current.edges)
    if (edges.has(id)) edges.delete(id)
    else edges.add(id)
    commit({ nodes: new Set(current.nodes), edges })
  }, [commit])

  const selectAll = useCallback((state) => {
    commit({ nodes: new Set(state.nodeOrder), edges: new Set(state.edgeOrder) })
  }, [commit])

  /**
   * Begin a marquee. `toWorld(clientX, clientY)` converts a pointer position to
   * world space; `getState()` supplies the nodes to hit-test on release.
   */
  const startMarquee = useCallback((event, { toWorld, getState, additive = false }) => {
    const origin = toWorld(event.clientX, event.clientY)
    const base = additive ? selectionRef.current : EMPTY
    setMarquee({ ...origin, width: 0, height: 0 })

    // One update a frame: a pointer reports faster than the display, and each update
    // re-renders the surface.
    let frame = 0
    let last = null
    const onMove = (moveEvent) => {
      last = moveEvent
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const point = toWorld(last.clientX, last.clientY)
        setMarquee(rectFromPoints(origin, point))
      })
    }

    const onUp = (upEvent) => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      setMarquee(null)

      const point = toWorld(upEvent.clientX, upEvent.clientY)
      const rect = rectFromPoints(origin, point)
      // A click, not a drag: treat it as clearing the selection.
      if (rect.width < 3 && rect.height < 3) {
        if (!additive) clear()
        return
      }

      const state = getState()
      const nodes = new Set(base.nodes)
      for (const id of state.nodeOrder) {
        const node = state.nodes[id]
        // Groups are containers — a marquee across them would drag the whole
        // group along with the cards it covers.
        if (!node || node.type === 'group') continue
        if (rectsIntersect(rect, node)) nodes.add(id)
      }

      // An edge counts as caught only if both of its endpoints are.
      const edges = new Set(base.edges)
      for (const id of state.edgeOrder) {
        const edge = state.edges[id]
        if (edge && nodes.has(edge.fromNode) && nodes.has(edge.toNode)) edges.add(id)
      }

      commit({ nodes, edges })
    }

    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
  }, [clear, commit])

  return useMemo(
    () => ({
      selection,
      selectionRef,
      marquee,
      clear,
      selectNode,
      selectEdge,
      selectAll,
      setSelection: commit,
      startMarquee,
    }),
    [clear, commit, marquee, selectAll, selectEdge, selectNode, selection, startMarquee]
  )
}
