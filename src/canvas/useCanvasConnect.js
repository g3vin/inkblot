/**
 * useCanvasConnect.js — dragging an arrow out of a node's port.
 *
 * Like the drag hook, this dispatches nothing until release: the in-flight curve
 * is written straight onto a dedicated <path> element, so React never re-renders
 * while the pointer moves.
 *
 * The drop target is resolved with elementFromPoint rather than by hit-testing
 * node rects ourselves — the DOM already knows what is under the cursor, and it
 * gets z-order right for free.
 */
import { useCallback, useRef } from 'react'
import { bezierPath, inferSide, offsetAnchor, sideAnchor } from '../lib/canvasGeometry'
import { makeEdge } from '../lib/canvasModel'

export function useCanvasConnect({ dispatch, screenToWorldAt, pendingEdgeRef }) {
  const frameRef = useRef(0)
  const connectingRef = useRef(false)

  const clearPending = useCallback(() => {
    cancelAnimationFrame(frameRef.current)
    frameRef.current = 0
    connectingRef.current = false
    if (pendingEdgeRef.current) pendingEdgeRef.current.setAttribute('d', '')
  }, [pendingEdgeRef])

  const startConnect = useCallback(
    (event, { node, side, state }) => {
      event.preventDefault()
      event.stopPropagation()

      connectingRef.current = true
      // Same gap a committed edge uses, so the line doesn't jump when it lands.
      const from = offsetAnchor(sideAnchor(node, side), side)

      const draw = (clientX, clientY) => {
        if (frameRef.current) return
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = 0
          const to = screenToWorldAt(clientX, clientY)
          // Aim the loose end back at the node it came from, so the curve reads
          // as reaching toward the cursor rather than doubling back.
          const toSide = inferSide({ ...node, x: to.x - 1, y: to.y - 1, width: 2, height: 2 }, from)
          const { d } = bezierPath(from, side, to, toSide)
          pendingEdgeRef.current?.setAttribute('d', d)
        })
      }

      const onMove = (moveEvent) => draw(moveEvent.clientX, moveEvent.clientY)

      const onUp = (upEvent) => {
        window.removeEventListener('pointermove', onMove, true)
        window.removeEventListener('pointerup', onUp, true)
        window.removeEventListener('pointercancel', onUp, true)
        clearPending()

        const element = document.elementFromPoint(upEvent.clientX, upEvent.clientY)
        const targetEl = element?.closest('[data-node-id]')
        const targetId = targetEl?.getAttribute('data-node-id')

        // Dropped on nothing, or back on the node it came from.
        if (!targetId || targetId === node.id) return

        const targetNode = state.nodes[targetId]
        if (!targetNode) return

        // A port under the cursor names its own side; otherwise pick the side of
        // the target that faces where the arrow came from.
        const portSide = element?.closest('[data-port-side]')?.getAttribute('data-port-side')
        const toSide = portSide || inferSide(targetNode, from)

        dispatch({
          type: 'edges/add',
          edges: [makeEdge({ fromNode: node.id, fromSide: side, toNode: targetId, toSide })],
        })
      }

      window.addEventListener('pointermove', onMove, true)
      window.addEventListener('pointerup', onUp, true)
      window.addEventListener('pointercancel', onUp, true)
    },
    [clearPending, dispatch, pendingEdgeRef, screenToWorldAt]
  )

  return { startConnect, connectingRef }
}
