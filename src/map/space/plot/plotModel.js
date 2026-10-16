/**
 * plotModel.js — a 3D model as a technical drawing: its outline and its creases in
 * one ink, the lines behind it taken out, as a draughtsman would.
 *
 * An edge is drawn when the two faces that share it bend more than `CREASE_DEG`, when
 * one faces the eye and the other away (the silhouette), or when it has only one
 * face (an open border). Hidden lines are removed with a depth buffer the plotter
 * fills itself, a triangle at a time: no WebGL, so the same model and camera always
 * give the same drawing.
 *
 * The model is the loaded scene graph (modelScene.js `object()`: the group the model
 * stands in), already placed; pins are in that group's units, like the 3D view's.
 */
import { Vector3 } from 'three'
import { pinLabel } from '../../../lib/map/mapModel'
import { hiddenLayers, isItemShown } from '../../../lib/map/mapVisibility'
import { fmt, namer } from './plotParts'

/** Faces bending more than this make a crease. */
const CREASE_DEG = 30
/** The depth buffer is this fraction of the plate's pixels across. */
const BUFFER_SCALE = 0.5
/** How far (as a share of depth) a line may sit behind a surface and still show. */
const DEPTH_SLACK = 0.004
/** Points tested along an edge, at most one every this many pixels. */
const TEST_STEP_PX = 1.5
/** Positions this close (in model units, relative to its size) are the same vertex. */
const WELD = 1e-5

/** Every triangle of `object`'s meshes, in world space: `[a, b, c]` of Vector3. */
function trianglesOf(object) {
  const triangles = []
  object.updateMatrixWorld(true)
  object.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.position || child.visible === false) return
    const position = child.geometry.attributes.position
    const index = child.geometry.index
    const count = index ? index.count : position.count
    const vertex = (i) => new Vector3().fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(child.matrixWorld)
    for (let i = 0; i + 2 < count; i += 3) triangles.push([vertex(i), vertex(i + 1), vertex(i + 2)])
  })
  return triangles
}

/** The depth buffer: each pixel the nearest surface's 1/depth (so it interpolates straight across the screen). */
function depthBuffer(triangles, eye, width, height) {
  const w = Math.max(1, Math.round(width * BUFFER_SCALE))
  const h = Math.max(1, Math.round(height * BUFFER_SCALE))
  const buffer = new Float32Array(w * h)
  for (const triangle of triangles) {
    const points = []
    for (const v of triangle) {
      const depth = eye.depth(v)
      const screen = eye.project(v)
      if (!screen || !(depth > 0)) break
      points.push([screen[0] * BUFFER_SCALE, screen[1] * BUFFER_SCALE, 1 / depth])
    }
    if (points.length < 3) continue
    const [a, b, c] = points
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    if (Math.abs(area) < 1e-9) continue
    const left = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])))
    const right = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])))
    const top = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])))
    const bottom = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])))
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const px = x + 0.5
        const py = y + 0.5
        const wa = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area
        const wb = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area
        const wc = 1 - wa - wb
        if (wa < 0 || wb < 0 || wc < 0) continue
        const inverse = wa * a[2] + wb * b[2] + wc * c[2]
        const at = y * w + x
        if (inverse > buffer[at]) buffer[at] = inverse
      }
    }
  }
  return {
    /** Whether a point `depth` away at pixel (x, y) is in front of every surface there. */
    seen(x, y, depth) {
      const bx = Math.floor(x * BUFFER_SCALE)
      const by = Math.floor(y * BUFFER_SCALE)
      if (bx < 0 || by < 0 || bx >= w || by >= h) return false
      // Against the farthest surface among a pixel and its neighbours (or none at
      // all), so a line along a surface's own edge is never hidden by that surface.
      let farthest = Infinity
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = bx + dx
          const ny = by + dy
          const inverse = nx >= 0 && ny >= 0 && nx < w && ny < h ? buffer[ny * w + nx] : 0
          if (!inverse) return true
          farthest = Math.min(farthest, inverse)
        }
      }
      return depth <= (1 / farthest) * (1 + DEPTH_SLACK)
    },
  }
}

/** The edges worth drawing: `{ a, b, outline }`, outline for silhouettes and borders. */
function drawnEdges(triangles, eye, size) {
  const weld = Math.max(1e-9, size * WELD)
  const key = (v) => `${Math.round(v.x / weld)},${Math.round(v.y / weld)},${Math.round(v.z / weld)}`
  const edges = new Map()
  const crease = Math.cos((CREASE_DEG * Math.PI) / 180)
  for (const [a, b, c] of triangles) {
    const normal = b.clone().sub(a).cross(c.clone().sub(a))
    if (normal.lengthSq() < 1e-30) continue
    normal.normalize()
    const toEye = eye.ortho ? eye.forward.clone().negate() : eye.position.clone().sub(a)
    const front = normal.dot(toEye) > 0
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const kp = key(p)
      const kq = key(q)
      const id = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`
      const entry = edges.get(id)
      if (entry) entry.faces.push({ normal, front })
      else edges.set(id, { a: p, b: q, faces: [{ normal, front }] })
    }
  }
  const out = []
  for (const { a, b, faces } of edges.values()) {
    if (faces.length === 1) {
      out.push({ a, b, outline: true })
      continue
    }
    const silhouette = faces.some((face) => face.front) && faces.some((face) => !face.front)
    if (silhouette) out.push({ a, b, outline: true })
    else if (faces[0].normal.dot(faces[1].normal) < crease && faces.some((face) => face.front)) out.push({ a, b, outline: false })
  }
  return out
}

/** The visible stretches of an edge, as path data. */
function visibleRuns(edge, eye, depth) {
  const pa = eye.project(edge.a)
  const pb = eye.project(edge.b)
  if (!pa || !pb) return ''
  const steps = Math.max(1, Math.ceil(Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) / TEST_STEP_PX))
  let path = ''
  let start = null
  let last = null
  const point = new Vector3()
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps
    point.copy(edge.a).lerp(edge.b, t)
    const screen = eye.project(point)
    const seen = screen && depth.seen(screen[0], screen[1], eye.depth(point))
    if (seen) {
      if (!start) start = screen
      last = screen
    } else if (start) {
      path += `M${fmt(start[0])} ${fmt(start[1])}L${fmt(last[0])} ${fmt(last[1])}`
      start = null
    }
  }
  if (start && start !== last) path += `M${fmt(start[0])} ${fmt(start[1])}L${fmt(last[0])} ${fmt(last[1])}`
  return path
}

/** A model: the plate's strokes into `out`. `object` is the placed model (or null while it loads). */
export function plotModel(map, day, eye, scale, width, height, out, { object = null } = {}) {
  if (object) {
    const triangles = trianglesOf(object)
    let low = new Vector3(Infinity, Infinity, Infinity)
    let high = new Vector3(-Infinity, -Infinity, -Infinity)
    for (const triangle of triangles) for (const v of triangle) {
      low = low.min(v)
      high = high.max(v)
    }
    const size = triangles.length ? high.distanceTo(low) : 1
    const depth = depthBuffer(triangles, eye, width, height)
    const outline = []
    const creases = []
    for (const edge of drawnEdges(triangles, eye, size)) {
      const path = visibleRuns(edge, eye, depth)
      if (path) (edge.outline ? outline : creases).push(path)
    }
    if (creases.length) out.push(`<path d="${creases.join('')}" fill="none" stroke="var(--plot-ink)" stroke-width="${fmt(0.55 * scale)}" stroke-linecap="round"/>`)
    if (outline.length) out.push(`<path d="${outline.join('')}" fill="none" stroke="var(--plot-ink)" stroke-width="${fmt(1.1 * scale)}" stroke-linecap="round"/>`)
  }

  // Places, as numbered callouts would be: a ring, a leader, a name.
  const hidden = hiddenLayers(map)
  const names = namer(scale)
  const marks = []
  for (const pin of map.pins.filter((item) => isItemShown(map, item, day, hidden))) {
    if (!pin.at) continue
    const local = new Vector3(pin.at[0], pin.at[1], pin.at[2] || 0)
    const world = object ? object.localToWorld(local) : local
    const point = eye.project(world)
    if (!point) continue
    marks.push(`<circle cx="${fmt(point[0])}" cy="${fmt(point[1])}" r="${fmt(3 * scale)}" fill="var(--plot-paper)" stroke="var(--plot-ink)" stroke-width="${fmt(0.9 * scale)}"/>`)
    names.add(pinLabel(pin), point, 7, { force: true })
  }
  out.push(marks.join(''), `<g class="plot-names">${names.svg()}</g>`)
}
