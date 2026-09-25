/**
 * Snapping: the alignment math behind a drag.
 *
 * Worth testing headlessly because it is invisible when subtly wrong — a card that
 * lands one pixel off looks like a rendering artifact, not a bug in a pure function.
 */
const C = '../../src'
const { computeSnap, snapCandidates, SNAP_THRESHOLD_PX } = await import(`${C}/canvas/useCanvasSnapping.js`)
const { createEmptyCanvas, makeTextNode, makeGroupNode } = await import(`${C}/lib/canvasModel.js`)
import { ok } from './assert.mjs'

const rect = (x, y, width = 100, height = 100) => ({ x, y, width, height })
const T = SNAP_THRESHOLD_PX

/* ---- edges ---- */

const still = [rect(0, 0)]

// Left edges 3px apart: within the threshold, so it should pull flush.
let snap = computeSnap(rect(3, 500), still, T)
ok('a near-aligned left edge snaps flush', snap.dx === -3)
ok('a snap emits a guide', snap.guides.some((g) => g.axis === 'x' && g.position === 0))

// Well outside the threshold: no pull at all.
snap = computeSnap(rect(40, 500), still, T)
ok('a distant edge does not snap', snap.dx === 0)
ok('no snap means no guide', snap.guides.length === 0)

// Exactly at the threshold still snaps; one pixel past it does not.
ok('a delta exactly at the threshold snaps', computeSnap(rect(T, 500), still, T).dx === -T)
ok('a delta past the threshold does not', computeSnap(rect(T + 1, 500), still, T).dx === 0)

/* ---- the right edge of one card against the left of another ---- */

snap = computeSnap(rect(98, 500), still, T)
// The moving left edge (98) is 2 from the static RIGHT edge (100) — the closest
// line wins, so it snaps to 100 rather than back to 0.
ok('the nearest line wins, not the first', snap.dx === 2)

/* ---- centers ---- */

// A 50-wide card whose center is near the static card's center (50).
snap = computeSnap({ x: 22, y: 500, width: 50, height: 50 }, still, T)
ok('centers align', snap.dx === 3)
ok('the guide sits on the shared center line', snap.guides[0].position === 50)

/* ---- the two axes resolve independently ---- */

snap = computeSnap(rect(2, 3), still, T)
ok('x and y snap independently', snap.dx === -2 && snap.dy === -3)
ok('both axes emit a guide', snap.guides.length === 2)

// A card can snap its left to one neighbour and its top to a different one.
snap = computeSnap(rect(2, 402), [rect(0, 0), rect(900, 400)], T)
ok('x snaps to one rect, y to another', snap.dx === -2 && snap.dy === -2)

/* ---- guides span everything they touch ---- */

// Three rects share x = 0. The vertical guide must reach from the topmost to the
// bottommost of them, not just the one the snap happened to resolve against.
snap = computeSnap(rect(3, 1000), [rect(0, 0), rect(0, 400), rect(0, 800)], T)
const vertical = snap.guides.find((g) => g.axis === 'x')
ok('the guide starts at the topmost aligned rect', vertical.start === 0)
ok('the guide reaches the moving card', vertical.end === 1100)

/* ---- candidates ---- */

const state = createEmptyCanvas()
const a = makeTextNode({ x: 0, y: 0 })
const b = makeTextNode({ x: 400, y: 0 })
const g = makeGroupNode({ x: -50, y: -50, width: 900, height: 400 })
for (const node of [a, b, g]) {
  state.nodes[node.id] = node
  state.nodeOrder.push(node.id)
}

const candidates = snapCandidates(state, [a.id])
ok('the dragged node is not a snap target', !candidates.some((r) => r.x === 0 && r.y === 0))
ok('a standing node is a snap target', candidates.some((r) => r.x === 400))
// A group's frame is padding around the very cards being dragged — snapping to it
// would fight the user.
ok('a group is not a snap target', candidates.length === 1)

ok('no candidates means no snap', computeSnap(rect(3, 3), [], T).dx === 0)
