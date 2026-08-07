/**
 * useCanvasSnapping.js — align a dragged node to the ones standing still.
 *
 * Six lines matter on any rect: its left / center / right, and its top / middle /
 * bottom. A drag snaps when one of the moving rect's six lines comes within the
 * threshold of the same kind of line on a static rect. Each axis resolves
 * independently, so a card can snap its left edge to one neighbour and its middle
 * to another — which is what makes a row of cards easy to line up.
 *
 * The candidate rects are built ONCE at pointer-down, not per frame: they cannot
 * change during the gesture (the nodes that could move are precisely the ones being
 * dragged), so rebuilding them every frame would be pure waste on a large canvas.
 *
 * Everything here is pure. The guides are painted straight to the DOM by
 * useCanvasDrag, because a drag dispatches nothing until pointer-up (invariant 1)
 * and rendering guides through React would break exactly that.
 */

/** Screen pixels. Converted to world units by dividing by zoom, so the pull feels
 *  the same at every zoom level. */
export const SNAP_THRESHOLD_PX = 6

/** The three alignment lines of a rect on each axis. */
const xLines = (rect) => [rect.x, rect.x + rect.width / 2, rect.x + rect.width]
const yLines = (rect) => [rect.y, rect.y + rect.height / 2, rect.y + rect.height]

/**
 * Collect the static rects a drag can snap against: every node that isn't moving.
 * Groups are excluded as snap targets — a group's frame is padding around the very
 * cards being dragged, so snapping to it would fight the user.
 */
export function snapCandidates(state, movingIds) {
  const moving = new Set(movingIds)
  const rects = []

  for (const id of state.nodeOrder) {
    if (moving.has(id)) continue
    const node = state.nodes[id]
    if (!node || node.type === 'group') continue
    rects.push({ x: node.x, y: node.y, width: node.width, height: node.height })
  }

  return rects
}

/** Best alignment on one axis: the smallest correction within `threshold`, or null. */
function bestAlignment(movingLines, candidates, linesOf, threshold) {
  let best = null

  for (const rect of candidates) {
    for (const movingLine of movingLines) {
      for (const candidateLine of linesOf(rect)) {
        const delta = candidateLine - movingLine
        if (Math.abs(delta) > threshold) continue
        if (!best || Math.abs(delta) < Math.abs(best.delta)) {
          best = { delta, position: candidateLine }
        }
      }
    }
  }

  if (!best) return null

  // Gather the winning line's rects in a second pass, not as the first accumulates:
  // a rect found early can be displaced by a closer one later, and every rect that
  // sits on the line the drag actually snapped to belongs to the guide it draws.
  return {
    ...best,
    rects: candidates.filter((rect) => linesOf(rect).some((line) => line === best.position)),
  }
}

/**
 * Snap `bounds` (the moving selection's box, already offset by the raw drag delta)
 * against `candidates`.
 *
 * Returns the correction to add to the drag delta, plus the guides to draw. A guide
 * spans from the topmost to the bottommost thing it touches — the moving box and
 * every static rect sitting on that same line — so it visibly connects them.
 */
export function computeSnap(bounds, candidates, threshold = SNAP_THRESHOLD_PX) {
  if (!bounds || !candidates.length) return { dx: 0, dy: 0, guides: [] }

  const x = bestAlignment(xLines(bounds), candidates, xLines, threshold)
  const y = bestAlignment(yLines(bounds), candidates, yLines, threshold)

  const guides = []

  if (x) {
    // The snapped box is where the guide must be measured against, not the raw one.
    const snapped = { ...bounds, x: bounds.x + x.delta }
    const tops = [snapped.y, ...x.rects.map((rect) => rect.y)]
    const bottoms = [snapped.y + snapped.height, ...x.rects.map((rect) => rect.y + rect.height)]
    guides.push({
      axis: 'x',
      position: x.position,
      start: Math.min(...tops),
      end: Math.max(...bottoms),
    })
  }

  if (y) {
    const snapped = { ...bounds, y: bounds.y + y.delta }
    const lefts = [snapped.x, ...y.rects.map((rect) => rect.x)]
    const rights = [snapped.x + snapped.width, ...y.rects.map((rect) => rect.x + rect.width)]
    guides.push({
      axis: 'y',
      position: y.position,
      start: Math.min(...lefts),
      end: Math.max(...rights),
    })
  }

  return { dx: x ? x.delta : 0, dy: y ? y.delta : 0, guides }
}

/**
 * Write guides into the pre-rendered <line> elements CanvasSurface keeps in the
 * world layer. Two elements, reused: a drag resolves at most one guide per axis, so
 * there is never anything to create or destroy mid-gesture.
 */
export function paintGuides(svg, guides) {
  if (!svg) return

  for (const axis of ['x', 'y']) {
    const line = svg.querySelector(`line[data-axis="${axis}"]`)
    if (!line) continue

    const guide = guides.find((candidate) => candidate.axis === axis)
    if (!guide) {
      line.style.display = 'none'
      continue
    }

    // An 'x' guide is a VERTICAL line: it marks a shared x position.
    const [x1, y1, x2, y2] =
      axis === 'x'
        ? [guide.position, guide.start, guide.position, guide.end]
        : [guide.start, guide.position, guide.end, guide.position]

    line.setAttribute('x1', x1)
    line.setAttribute('y1', y1)
    line.setAttribute('x2', x2)
    line.setAttribute('y2', y2)
    line.style.display = ''
  }
}
