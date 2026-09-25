/**
 * Edge geometry: side anchors, normals, bezier paths, and which side an edge attaches to.
 */
import {
  sideAnchor,
  sideNormal,
  bezierPath,
  edgeGeometry,
  inferSide,
  offsetAnchor,
  EDGE_SIDES,
  EDGE_ENDPOINT_GAP,
} from '../../src/lib/canvasGeometry.js'
import { ok } from './assert.mjs'
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e

const n = { x: 100, y: 200, width: 200, height: 100 } // center (200, 250)

// anchors sit ON the border, at the midpoint of their side
ok('right anchor', sideAnchor(n, 'right').x === 300 && sideAnchor(n, 'right').y === 250)
ok('left anchor',  sideAnchor(n, 'left').x === 100 && sideAnchor(n, 'left').y === 250)
ok('top anchor',   sideAnchor(n, 'top').x === 200 && sideAnchor(n, 'top').y === 200)
ok('bottom anchor',sideAnchor(n, 'bottom').x === 200 && sideAnchor(n, 'bottom').y === 300)

// every anchor must lie exactly on the node's boundary
for (const s of EDGE_SIDES) {
  const a = sideAnchor(n, s)
  const onEdge = (near(a.x, n.x) || near(a.x, n.x + n.width) || near(a.y, n.y) || near(a.y, n.y + n.height))
  const inBox = a.x >= n.x && a.x <= n.x + n.width && a.y >= n.y && a.y <= n.y + n.height
  ok(`anchor "${s}" lies on the node boundary`, onEdge && inBox)
  // normal must point AWAY from the node center
  const nm = sideNormal(s)
  const outward = (a.x - 200) * nm.x + (a.y - 250) * nm.y
  ok(`normal "${s}" points outward`, outward > 0)
}

// curve starts and ends exactly at the anchors
const a = { x: 100, y: 100 }, b = { x: 400, y: 300 }
const { d, mid } = bezierPath(a, 'right', b, 'left')
ok('path starts at the from-anchor', d.startsWith('M 100 100'))
ok('path ends at the to-anchor', d.trim().endsWith('400 300'))
ok('path is a cubic', d.includes(' C '))

// the label sits between the endpoints, not on top of one
ok('label midpoint is between the ends', mid.x > 100 && mid.x < 400 && mid.y > 100 && mid.y < 300)

// control points leave along the normals: a right→left edge bulges outward
const [, c0x] = d.match(/C ([\d.-]+) /) || []
ok('right-side control point pushes right of the start', Number(c0x) > 100)

// symmetry: a left→right edge is the mirror of right→left
const fwd = bezierPath({ x: 0, y: 0 }, 'right', { x: 200, y: 0 }, 'left')
const rev = bezierPath({ x: 200, y: 0 }, 'left', { x: 0, y: 0 }, 'right')
ok('curve is symmetric under reversal', near(fwd.mid.x, rev.mid.x) && near(fwd.mid.y, rev.mid.y))

// An EDGE stops short of the card by EDGE_ENDPOINT_GAP, pushed out along the side's
// normal. Nodes paint above the edge layer, so an arrowhead landing exactly on the
// border is half-buried under the card — the gap is what keeps the tip visible.
// (sideAnchor itself still returns the point ON the border, asserted above.)
const g = edgeGeometry({ fromSide: 'top', toSide: 'bottom' }, n, { x: 100, y: 500, width: 200, height: 100 })
ok('stored sides are used verbatim', g.d.startsWith(`M 200 ${200 - EDGE_ENDPOINT_GAP}`))
ok('a top endpoint is lifted off the card', g.d.startsWith('M 200 194'))
// a missing endpoint yields no geometry rather than throwing
ok('missing endpoint -> null, no throw', edgeGeometry({ fromSide: 'top', toSide: 'bottom' }, n, undefined) === null)
// defaults match the JSON Canvas spec when sides are absent
ok(
  'defaults to right->left',
  edgeGeometry({}, n, { x: 500, y: 200, width: 100, height: 100 }).d.startsWith(`M ${300 + EDGE_ENDPOINT_GAP} 250`)
)

// offsetAnchor pushes along the outward normal, never sideways
for (const s of EDGE_SIDES) {
  const anchor = sideAnchor(n, s)
  const off = offsetAnchor(anchor, s)
  const nm = sideNormal(s)
  ok(`offset "${s}" moves exactly the gap outward`, near(
    (off.x - anchor.x) * nm.x + (off.y - anchor.y) * nm.y,
    EDGE_ENDPOINT_GAP
  ))
  ok(`offset "${s}" does not drift sideways`, near(
    Math.hypot(off.x - anchor.x, off.y - anchor.y),
    EDGE_ENDPOINT_GAP
  ))
}

// An edge whose target sits BEHIND the port it leaves must swing wide rather than
// cut straight back across the card it just left (the "arrow goes behind a card" bug).
const behind = bezierPath({ x: 0, y: 0 }, 'right', { x: -300, y: 0 }, 'left')
const [, behindC0x] = behind.d.match(/C ([\d.-]+) /) || []
const ahead = bezierPath({ x: 0, y: 0 }, 'right', { x: 300, y: 0 }, 'left')
const [, aheadC0x] = ahead.d.match(/C ([\d.-]+) /) || []
ok('a backwards edge reaches further out than a forwards one', Number(behindC0x) > Number(aheadC0x))
ok('a backwards edge still leaves along its normal', Number(behindC0x) > 0)

// inferSide picks the face pointing at the other node
ok('infer right', inferSide(n, { x: 900, y: 250 }) === 'right')
ok('infer left',  inferSide(n, { x: -900, y: 250 }) === 'left')
ok('infer top',   inferSide(n, { x: 200, y: -900 }) === 'top')
ok('infer bottom',inferSide(n, { x: 200, y: 900 }) === 'bottom')
