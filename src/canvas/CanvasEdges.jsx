/**
 * CanvasEdges.jsx — the SVG layer holding every edge.
 *
 * The <svg> sits INSIDE the transformed world layer, so its coordinate system is
 * world space and the viewport transform scales it for free. Strokes carry
 * vector-effect="non-scaling-stroke" so a line stays 2px on screen at any zoom
 * instead of turning into a hairline (zoomed out) or a slab (zoomed in).
 *
 * Hit-testing needs no math: each edge also renders a fat transparent path
 * underneath, giving a constant ~14px grab zone. Analytic point-to-bezier
 * distance would be a lot of code for the same result.
 *
 * Paths register their DOM node so useCanvasDrag can rewrite `d` imperatively
 * while a connected card is being dragged, without re-rendering React.
 */
import { memo, useCallback } from 'react'
import { edgeGeometry } from '../lib/canvasGeometry'
import { resolveCanvasColor } from '../lib/canvasModel'

/**
 * One marker per distinct colour — `currentColor` inside a marker is unreliable.
 *
 * refX is the marker's own x that lands ON the path's endpoint. It must be the TIP
 * (x = 9), not 8: at refX=8 the head overshoots the endpoint by one unit — and a
 * marker unit is a stroke-width, so the tip poked ~2px past the anchor and under the
 * card, which paints above the edge layer. That is the clipped-tip bug.
 */
function ArrowMarkers({ colors }) {
  return (
    <defs>
      {colors.map(({ key, value }) => (
        <marker
          key={key}
          id={`canvas-arrow-${key}`}
          markerWidth="9"
          markerHeight="9"
          refX="9"
          refY="4.5"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L9,4.5 L0,9 Z" fill={value} />
        </marker>
      ))}
    </defs>
  )
}

function CanvasEdgesInner({
  state,
  selection,
  registerEdgeEl,
  onEdgePointerDown,
  onEdgeDoubleClick,
  pendingEdgeRef,
}) {
  const colorKey = (color) => (color ? String(color).replace(/[^a-zA-Z0-9]/g, '') : 'default')

  const colors = [
    ...new Map(
      state.edgeOrder.map((id) => {
        const color = state.edges[id]?.color
        return [colorKey(color), { key: colorKey(color), value: resolveCanvasColor(color) }]
      })
    ).values(),
    { key: 'pending', value: 'var(--canvas-ink)' },
  ]

  const setPendingEl = useCallback(
    (el) => {
      if (pendingEdgeRef) pendingEdgeRef.current = el
    },
    [pendingEdgeRef]
  )

  return (
    <svg
      className="canvas-edges"
      // Zero-sized with overflow visible: the SVG is a coordinate space, not a box.
      width="1"
      height="1"
      overflow="visible"
    >
      <ArrowMarkers colors={colors} />

      {state.edgeOrder.map((id) => {
        const edge = state.edges[id]
        const geometry = edgeGeometry(edge, state.nodes[edge.fromNode], state.nodes[edge.toNode])
        if (!geometry) return null

        const key = colorKey(edge.color)
        const selected = selection.edges.has(id)

        return (
          <g key={id} className={`canvas-edge${selected ? ' is-selected' : ''}`} data-edge-id={id}>
            <path
              className="canvas-edge-hit"
              d={geometry.d}
              onPointerDown={(event) => onEdgePointerDown(event, edge)}
              onDoubleClick={(event) => onEdgeDoubleClick(event, edge)}
            />
            <path
              ref={(el) => registerEdgeEl(id, el)}
              className="canvas-edge-line"
              d={geometry.d}
              stroke={resolveCanvasColor(edge.color)}
              markerStart={edge.fromEnd === 'arrow' ? `url(#canvas-arrow-${key})` : undefined}
              // The spec's default for toEnd is 'arrow'; only 'none' turns it off.
              markerEnd={edge.toEnd === 'none' ? undefined : `url(#canvas-arrow-${key})`}
            />
          </g>
        )
      })}

      {/* The edge being dragged out of a port. Its `d` is written directly during
          the drag, so this element never re-renders while the pointer moves. */}
      <path ref={setPendingEl} className="canvas-edge-pending" d="" markerEnd="url(#canvas-arrow-pending)" />
    </svg>
  )
}

export default memo(CanvasEdgesInner)
