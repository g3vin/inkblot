/**
 * roughen.js — a hand-drawn wobble, baked into a line's geometry.
 *
 * The rough and inked route styles were SVG filters: turbulence noise displacing the
 * stroke. A filter is re-run on every repaint over the route's whole bounding box at
 * screen resolution, so zoomed in on a long route each frame of a pan paid for
 * millions of pixels of noise. The same wobble drawn into the path once costs nothing
 * to repaint, and reads the same in an exported SVG as in the app.
 *
 * Distances are in the path's own units (map world units), as the filters' were, so
 * the wobble grows with the zoom exactly as theirs did.
 */

/** `{ amplitude, wavelength, octaves }` for each style, matching the old filters. */
export const ROUGH_STYLE = { amplitude: 1.5, wavelength: 12, octaves: 2 }
export const INKED_STYLE = { amplitude: 0.6, wavelength: 2, octaves: 1 }

/** At most this many points are drawn for one subpath, however long it is. */
const MAX_POINTS = 4000

/** A stable number for a string, to seed a route's wobble by its id. */
export const hashSeed = (text = '') => {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** Deterministic value in [-1, 1] for an integer lattice point. */
const lattice = (i, seed) => {
  let h = Math.imul((i | 0) ^ seed, 0x27d4eb2d)
  h ^= h >>> 15
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  return ((h >>> 0) / 4294967295) * 2 - 1
}

/** Smooth 1D value noise in [-1, 1]. */
const noise1 = (t, seed) => {
  const i = Math.floor(t)
  const f = t - i
  const s = f * f * (3 - 2 * f)
  return lattice(i, seed) * (1 - s) + lattice(i + 1, seed) * s
}

const fractal = (t, seed, octaves) => {
  let sum = 0
  let weight = 1
  let total = 0
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += noise1(t * 2 ** octave, seed + octave * 7919) * weight
    total += weight
    weight /= 2
  }
  return sum / total
}

/** An SVG path of M/L/Z commands (d3's and pathData's) → subpaths of points. */
export function parsePath(d) {
  const subpaths = []
  let current = null
  for (const [, command, args] of String(d || '').matchAll(/([MLZmlz])([^MLZmlz]*)/g)) {
    const numbers = (args.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || []).map(Number)
    const upper = command.toUpperCase()
    if (upper === 'Z') {
      if (current) current.closed = true
      current = null
      continue
    }
    for (let i = 0; i + 1 < numbers.length; i += 2) {
      const point = [numbers[i], numbers[i + 1]]
      if (upper === 'M' && i === 0) {
        current = { points: [point], closed: false }
        subpaths.push(current)
      } else if (current) {
        current.points.push(point)
      }
    }
  }
  return subpaths
}

const fmt = (value) => Math.round(value * 1000) / 1000

/**
 * `d` with every line wobbled sideways by up to `amplitude`, in waves about
 * `wavelength` long. The ends of an open line stay put, so an arrowhead or a pin it
 * runs to is still met exactly. The same `seed` always draws the same wobble.
 */
export function roughenPath(d, { amplitude, wavelength, octaves = 1 }, seed = 0) {
  if (!d || !(amplitude > 0) || !(wavelength > 0)) return d || ''
  let out = ''
  for (const { points, closed } of parsePath(d)) {
    if (points.length < 2) {
      if (points.length) out += `M${fmt(points[0][0])} ${fmt(points[0][1])}`
      continue
    }
    const ring = closed ? [...points, points[0]] : points
    let length = 0
    for (let i = 1; i < ring.length; i += 1) length += Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1])
    const step = Math.max(wavelength / 4, length / MAX_POINTS)

    const drawn = []
    let travelled = 0
    const place = (x, y, nx, ny, pinned) => {
      const offset = pinned ? 0 : fractal(travelled / wavelength, seed, octaves) * amplitude
      drawn.push([x + nx * offset, y + ny * offset])
    }
    for (let i = 1; i < ring.length; i += 1) {
      const [x0, y0] = ring[i - 1]
      const [x1, y1] = ring[i]
      const segment = Math.hypot(x1 - x0, y1 - y0)
      if (!segment) continue
      const nx = -(y1 - y0) / segment
      const ny = (x1 - x0) / segment
      if (!drawn.length) place(x0, y0, nx, ny, !closed)
      const pieces = Math.max(1, Math.ceil(segment / step))
      for (let piece = 1; piece <= pieces; piece += 1) {
        const t = piece / pieces
        travelled += segment / pieces
        const last = i === ring.length - 1 && piece === pieces
        place(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, nx, ny, last && !closed)
      }
    }
    if (!drawn.length) continue
    out += `M${fmt(drawn[0][0])} ${fmt(drawn[0][1])}`
    for (let i = 1; i < drawn.length; i += 1) out += `L${fmt(drawn[i][0])} ${fmt(drawn[i][1])}`
    if (closed) out += 'Z'
  }
  return out
}
