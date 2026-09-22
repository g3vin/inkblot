/**
 * canvasGeometry.js against `inkblot_core::canvas_geometry`.
 *
 * Float math compared bit for bit, so the corpus is built from viewports and rects
 * that produce awkward values rather than round ones: zoom levels that do not divide
 * evenly, coordinates either side of zero, degenerate and inverted rects, and the
 * non-finite values `Math.min` propagates but Rust's `f64::min` swallows.
 *
 * `bezierPath` is the one that matters most — it is the only function here whose
 * output is a string the webview uses verbatim, so it exercises the number formatter
 * as well as the math.
 */
import {
  clamp, clampZoom, worldToScreen, screenToWorld, worldTransform,
  zoomAt, zoomTo, panBy, nodesBounds, fitViewport,
  rectsIntersect, rectContains, padRect, rectFromPoints,
  sideAnchor, sideNormal, bezierPath, offsetAnchor, edgeGeometry, inferSide,
  EDGE_ENDPOINT_GAP,
} from '../../../src/lib/canvasGeometry.js'
import { encode } from '../encode.mjs'

const VIEWPORTS = [
  { x: 0, y: 0, zoom: 1 },
  { x: 137, y: -42, zoom: 1.73 },
  { x: -1e6, y: 1e6, zoom: 0.1 },
  { x: 0.1, y: 0.2, zoom: 4 },
  { x: -0.5, y: 12345.6789, zoom: 1 / 3 },
  { x: 1e-7, y: -1e21, zoom: 0.35 },
]

const POINTS = [
  { x: 0, y: 0 }, { x: 1, y: -1 }, { x: 400, y: 300 }, { x: -12.5, y: 0.1 },
  { x: 1e13 + 0.25, y: -7 }, { x: 1 / 3, y: 2 / 3 },
]

const RECTS = [
  { x: 0, y: 0, width: 200, height: 100 },
  { x: 300, y: 200, width: 100, height: 100 },
  { x: -50.5, y: -50.5, width: 0, height: 0 },
  { x: 10, y: 10, width: -20, height: -20 },
  { x: 1e-7, y: 1e21, width: 1, height: 1 },
  { x: -1e6, y: -1e6, width: 2e6, height: 2e6 },
  { x: 0.1, y: 0.2, width: 0.30000000000000004, height: 1 / 7 },
]

const SIDES = ['top', 'right', 'bottom', 'left', 'sideways', '', null]
const SIZES = [[800, 600], [1, 1], [0, 600], [1920, 1080], [-100, 50], [NaN, 600]]
const SCALARS = [0, -0, 1, -1, 0.5, 4, 5, 0.001, 1e21, -1e-7, NaN, Infinity, -Infinity, 1 / 3]

const node = (rect) => ({ id: 'n', type: 'text', ...rect })

export default {
  name: 'canvasGeometry',
  *cases() {
    const emit = (fn, args, expected) => ({ fn, args: encode(args), expected })

    for (const value of SCALARS) {
      yield emit('clampZoom', [value], clampZoom(value))
      for (const [min, max] of [[0, 1], [40, 160], [-1, 1], [NaN, 1]]) {
        yield emit('clamp', [value, min, max], clamp(value, min, max))
      }
    }

    for (const v of VIEWPORTS) {
      yield emit('worldTransform', [v], worldTransform(v))
      for (const p of POINTS) {
        yield emit('worldToScreen', [p.x, p.y, v], worldToScreen(p.x, p.y, v))
        yield emit('screenToWorld', [p.x, p.y, v], screenToWorld(p.x, p.y, v))
        yield emit('panBy', [v, p.x, p.y], panBy(v, p.x, p.y))
        for (const factor of [1.2, 0.5, 3.1, 1, 1e6]) {
          yield emit('zoomAt', [v, factor, p.x, p.y], zoomAt(v, factor, p.x, p.y))
        }
      }
      for (const [width, height] of SIZES) {
        for (const zoom of [0.5, 1, 2.5, 100]) {
          yield emit('zoomTo', [v, zoom, width, height], zoomTo(v, zoom, width, height))
        }
      }
    }

    // nodesBounds over every subset-ish combination, including the empty list and a
    // list carrying NaN — where Math.min and f64::min disagree.
    const nodeLists = [
      [], [RECTS[0]], RECTS, RECTS.slice(0, 3), RECTS.slice(2),
      [{ x: NaN, y: 0, width: 10, height: 10 }, RECTS[0]],
      [{ x: 0, y: 0, width: Infinity, height: 10 }],
    ]
    for (const list of nodeLists) {
      yield emit('nodesBounds', [list], nodesBounds(list))
      for (const [width, height] of SIZES) {
        for (const padding of [64, 0, 500]) {
          const bounds = nodesBounds(list)
          yield emit(
            'fitViewport',
            [bounds, width, height, { padding, maxZoom: 1 }],
            fitViewport(bounds, width, height, { padding, maxZoom: 1 })
          )
        }
      }
    }

    for (const a of RECTS) {
      yield emit('padRect', [a, 24], padRect(a, 24))
      for (const b of RECTS) {
        yield emit('rectsIntersect', [a, b], rectsIntersect(a, b))
        yield emit('rectContains', [a, b], rectContains(a, b))
      }
      for (const side of SIDES) {
        yield emit('sideAnchor', [a, side], sideAnchor(a, side))
        yield emit('sideNormal', [side], sideNormal(side))
        yield emit('inferSide', [a, POINTS[2]], inferSide(a, POINTS[2]))
        for (const p of POINTS) {
          yield emit('inferSide', [a, p], inferSide(a, p))
          yield emit(
            'offsetAnchor',
            [p, side, EDGE_ENDPOINT_GAP],
            offsetAnchor(p, side, EDGE_ENDPOINT_GAP)
          )
        }
      }
    }

    for (const a of POINTS) {
      for (const b of POINTS) {
        yield emit('rectFromPoints', [a, b], rectFromPoints(a, b))
        for (const fromSide of SIDES) {
          for (const toSide of SIDES) {
            yield emit('bezierPath', [a, fromSide, b, toSide], bezierPath(a, fromSide, b, toSide))
          }
        }
      }
    }

    for (const from of RECTS) {
      for (const to of RECTS) {
        for (const [fromSide, toSide] of [['right', 'left'], ['top', 'bottom'], [null, null], ['sideways', 'left']]) {
          const edge = { id: 'e', fromNode: 'a', toNode: 'b', fromSide, toSide }
          yield emit(
            'edgeGeometry',
            [edge, node(from), node(to)],
            edgeGeometry(edge, node(from), node(to))
          )
        }
      }
    }
  },
}
