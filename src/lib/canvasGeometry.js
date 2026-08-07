/**
 * canvasGeometry.js — the canvas's coordinate math. Pure functions only.
 *
 * A viewport is { x, y, zoom } where (x, y) is the WORLD coordinate sitting at
 * the container's top-left corner. The world layer renders it as a single
 * transform (with transform-origin: 0 0):
 *
 *   translate(-x * zoom, -y * zoom) scale(zoom)
 *
 * Screen coordinates are always relative to the container's bounding rect, so
 * callers must subtract rect.left/rect.top before handing a pointer position in.
 */

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 4

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export const clampZoom = (zoom) => clamp(zoom, MIN_ZOOM, MAX_ZOOM)

export const worldToScreen = (wx, wy, v) => ({
  x: (wx - v.x) * v.zoom,
  y: (wy - v.y) * v.zoom,
})

export const screenToWorld = (sx, sy, v) => ({
  x: sx / v.zoom + v.x,
  y: sy / v.zoom + v.y,
})

/** The CSS transform for the world layer. */
export const worldTransform = (v) =>
  `translate(${-v.x * v.zoom}px, ${-v.y * v.zoom}px) scale(${v.zoom})`

/**
 * Scale by `factor` while pinning the world point currently under (sx, sy) —
 * i.e. zoom toward the cursor rather than the origin.
 */
export function zoomAt(v, factor, sx, sy) {
  const zoom = clampZoom(v.zoom * factor)
  if (zoom === v.zoom) return v
  const anchor = screenToWorld(sx, sy, v)
  return {
    zoom,
    x: anchor.x - sx / zoom,
    y: anchor.y - sy / zoom,
  }
}

/** Scale to an exact zoom level, pinning the center of the container. */
export function zoomTo(v, zoom, width, height) {
  return zoomAt(v, clampZoom(zoom) / v.zoom, width / 2, height / 2)
}

export const panBy = (v, dxScreen, dyScreen) => ({
  ...v,
  x: v.x + dxScreen / v.zoom,
  y: v.y + dyScreen / v.zoom,
})

/** Bounding box of a list of nodes in world space, or null if there are none. */
export function nodesBounds(nodes) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const node of nodes) {
    if (!node) continue
    minX = Math.min(minX, node.x)
    minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x + node.width)
    maxY = Math.max(maxY, node.y + node.height)
  }

  if (!Number.isFinite(minX)) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Viewport that centers `bounds` in a container of the given size with `padding`
 * screen pixels of breathing room. An empty canvas resets to the origin.
 */
export function fitViewport(bounds, width, height, { padding = 64, maxZoom = 1 } = {}) {
  if (!bounds || !width || !height) return { x: 0, y: 0, zoom: 1 }

  const usableWidth = Math.max(1, width - padding * 2)
  const usableHeight = Math.max(1, height - padding * 2)
  const zoom = clamp(
    Math.min(usableWidth / Math.max(1, bounds.width), usableHeight / Math.max(1, bounds.height)),
    MIN_ZOOM,
    maxZoom
  )

  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2

  return {
    zoom,
    x: centerX - width / (2 * zoom),
    y: centerY - height / (2 * zoom),
  }
}

export const rectsIntersect = (a, b) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y

/** True when `inner` sits entirely within `outer` — how a group claims its members. */
export const rectContains = (outer, inner) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height

/** Grow a rect by `padding` on every side. */
export const padRect = (rect, padding) => ({
  x: rect.x - padding,
  y: rect.y - padding,
  width: rect.width + padding * 2,
  height: rect.height + padding * 2,
})

/** Normalize a drag between two points into a positive-extent rect (for marquees). */
export const rectFromPoints = (a, b) => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
})

/* ---------------- edges ---------------- */

export const EDGE_SIDES = ['top', 'right', 'bottom', 'left']

/** Where an edge attaches on a node's side (world coords). */
export function sideAnchor(node, side) {
  switch (side) {
    case 'top':
      return { x: node.x + node.width / 2, y: node.y }
    case 'bottom':
      return { x: node.x + node.width / 2, y: node.y + node.height }
    case 'left':
      return { x: node.x, y: node.y + node.height / 2 }
    case 'right':
    default:
      return { x: node.x + node.width, y: node.y + node.height / 2 }
  }
}

/** Outward direction of a side — the curve leaves and enters along these. */
export function sideNormal(side) {
  switch (side) {
    case 'top':
      return { x: 0, y: -1 }
    case 'bottom':
      return { x: 0, y: 1 }
    case 'left':
      return { x: -1, y: 0 }
    case 'right':
    default:
      return { x: 1, y: 0 }
  }
}

const CONTROL_MIN = 40
const CONTROL_MAX = 160

/**
 * How far an edge stops short of the card it touches.
 *
 * Nodes paint on top of the edge layer, so an arrowhead that ends exactly on the
 * border is half-buried under the card — its tip is the part that disappears. The
 * gap lands the head just outside the card, where it can be seen whole.
 */
export const EDGE_ENDPOINT_GAP = 6

/**
 * Control-point reach for one end of a curve.
 *
 * `away` is how far the other endpoint lies along this side's outward normal. When
 * it is positive the target is out in front of the port and a modest reach is all a
 * graceful curve needs. When it is NEGATIVE the target is *behind* the card the
 * arrow is leaving: a short control point makes the curve turn immediately and cut
 * straight back across the card it just left. Reaching further out first is what
 * makes the line swing clear of the card instead of disappearing behind it.
 */
function controlReach(distance, away) {
  const base = clamp(distance * 0.4, CONTROL_MIN, CONTROL_MAX)
  if (away >= 0) return base
  // Push out by (roughly) as far as the target sits behind us, so the curve clears
  // the card's edge before it doubles back.
  return clamp(base + Math.abs(away) * 0.8, CONTROL_MIN, CONTROL_MAX * 2.5)
}

/**
 * Cubic bezier between two anchors, with control points pushed along each side's
 * outward normal so the curve leaves the card perpendicular to the edge it
 * touches. (NoteHoverPreview's getCurvePath is a quadratic with an upward sway —
 * right for a note dangling on a string, wrong for a side-anchored graph edge.)
 */
export function bezierPath(from, fromSide, to, toSide) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y)

  const n0 = sideNormal(fromSide)
  const n1 = sideNormal(toSide)

  // Signed distance of each endpoint along the OTHER end's outward normal.
  const awayFrom = (to.x - from.x) * n0.x + (to.y - from.y) * n0.y
  const awayTo = (from.x - to.x) * n1.x + (from.y - to.y) * n1.y

  const reach0 = controlReach(distance, awayFrom)
  const reach1 = controlReach(distance, awayTo)

  const c0 = { x: from.x + n0.x * reach0, y: from.y + n0.y * reach0 }
  const c1 = { x: to.x + n1.x * reach1, y: to.y + n1.y * reach1 }

  return {
    d: `M ${from.x} ${from.y} C ${c0.x} ${c0.y} ${c1.x} ${c1.y} ${to.x} ${to.y}`,
    // t = 0.5 on a cubic, where an edge label sits.
    mid: {
      x: (from.x + 3 * c0.x + 3 * c1.x + to.x) / 8,
      y: (from.y + 3 * c0.y + 3 * c1.y + to.y) / 8,
    },
  }
}

/** An anchor pushed `gap` out along its side's normal, clear of the card. */
export const offsetAnchor = (anchor, side, gap = EDGE_ENDPOINT_GAP) => {
  const n = sideNormal(side)
  return { x: anchor.x + n.x * gap, y: anchor.y + n.y * gap }
}

/** The path (and label point) for an edge between two nodes. */
export function edgeGeometry(edge, fromNode, toNode) {
  if (!fromNode || !toNode) return null
  const fromSide = edge.fromSide || 'right'
  const toSide = edge.toSide || 'left'
  return bezierPath(
    offsetAnchor(sideAnchor(fromNode, fromSide), fromSide),
    fromSide,
    offsetAnchor(sideAnchor(toNode, toSide), toSide),
    toSide
  )
}

/**
 * Best side of `node` to attach to when connecting from `point` — used when the
 * user drops on a card's body rather than a specific port. Stored sides are
 * sticky afterwards, which is what Obsidian does and what users expect.
 */
export function inferSide(node, point) {
  const dx = point.x - (node.x + node.width / 2)
  const dy = point.y - (node.y + node.height / 2)
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'bottom' : 'top'
}
