/**
 * useCanvasPreview.js — a miniature of another canvas, for a card that references it.
 *
 * Deliberately a MINIMAP, not a live canvas: the referenced canvas is drawn as the
 * shapes it contains (a rect per node, a line per edge), scaled to fit the card. A
 * real nested canvas would mean a second viewport, a second reducer and a second set
 * of pointer handlers inside a node that is itself being dragged — for a thumbnail
 * you glance at and then double-click to open.
 *
 * The shapes alone are enough to recognise a canvas you have seen before, which is
 * the whole job of the preview.
 */
import { useEffect, useState } from 'react'
import { loadCanvasDocument } from '../lib/canvasFileSystem'
import { nodesBounds } from '../lib/canvasGeometry'
import { resolveCanvasColor } from '../lib/canvasModel'

export function useCanvasPreview(projectName, docPath) {
  const [preview, setPreview] = useState({ status: 'loading', shapes: null })

  useEffect(() => {
    if (!projectName || !docPath) {
      setPreview({ status: 'missing', shapes: null })
      return
    }

    let cancelled = false

    loadCanvasDocument(projectName, docPath)
      .then(({ state }) => {
        if (cancelled) return

        const nodes = state.nodeOrder.map((id) => state.nodes[id]).filter(Boolean)
        if (!nodes.length) {
          setPreview({ status: 'empty', shapes: null })
          return
        }

        const bounds = nodesBounds(nodes)
        if (!bounds) {
          setPreview({ status: 'empty', shapes: null })
          return
        }

        setPreview({
          status: 'ready',
          shapes: {
            // The SVG viewBox does the scaling, so the minimap needs no arithmetic
            // of its own and stays correct at any card size.
            bounds,
            nodes: nodes.map((node) => ({
              id: node.id,
              x: node.x,
              y: node.y,
              width: node.width,
              height: node.height,
              isGroup: node.type === 'group',
              color: resolveCanvasColor(node.color),
            })),
            edges: state.edgeOrder
              .map((id) => state.edges[id])
              .filter(Boolean)
              .map((edge) => {
                const from = state.nodes[edge.fromNode]
                const to = state.nodes[edge.toNode]
                if (!from || !to) return null
                // Centre-to-centre is plenty at thumbnail scale; the real bezier
                // would be invisible detail.
                return {
                  id: edge.id,
                  x1: from.x + from.width / 2,
                  y1: from.y + from.height / 2,
                  x2: to.x + to.width / 2,
                  y2: to.y + to.height / 2,
                }
              })
              .filter(Boolean),
          },
        })
      })
      .catch(() => {
        if (!cancelled) setPreview({ status: 'missing', shapes: null })
      })

    return () => {
      cancelled = true
    }
  }, [docPath, projectName])

  return preview
}
