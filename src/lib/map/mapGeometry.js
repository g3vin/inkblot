/**
 * mapGeometry.js — plane geometry for maps: lines, curves, polygons.
 *
 * Points are `[x, y]` pairs. Everything here is Euclidean in whatever units the
 * points are in; turning units into kilometres is mapSpace.js's job, and on the
 * sphere geodesy.js's.
 *
 * The functions a distance or a travel time depends on are mirrored in
 * `inkblot_core::map::geometry` and held to it by `npm run parity`. The two that only
 * shape what is drawn — `simplifyDP` and `chaikin`, used by the image tracer — are
 * not.
 */

export const segmentLength = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1])

/** Running length at each point: `[0, |p0p1|, |p0p1|+|p1p2|, …]`. */
export function cumulativeLengths(points) {
  const out = [0]
  for (let index = 1; index < points.length; index += 1) {
    out.push(out[index - 1] + segmentLength(points[index - 1], points[index]))
  }
  return out
}

export const polylineLength = (points) => {
  const lengths = cumulativeLengths(points)
  return lengths[lengths.length - 1] || 0
}

/**
 * The point `distance` along a polyline, with the segment it falls in and the
 * heading there (radians, atan2 of the segment). Clamped to the ends.
 */
export function pointAtDistance(points, distance) {
  if (!points.length) return null
  if (points.length === 1) return { point: [points[0][0], points[0][1]], index: 0, heading: 0 }
  const lengths = cumulativeLengths(points)
  const total = lengths[lengths.length - 1]
  const target = Math.min(total, Math.max(0, distance))

  let index = 0
  while (index < points.length - 2 && lengths[index + 1] < target) index += 1

  const a = points[index]
  const b = points[index + 1]
  const span = lengths[index + 1] - lengths[index]
  const t = span > 0 ? (target - lengths[index]) / span : 0
  return {
    point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    index,
    heading: Math.atan2(b[1] - a[1], b[0] - a[0]),
  }
}

/**
 * A centripetal Catmull–Rom curve through `points`, sampled `samples` times per
 * segment. The curve passes through every control point (which the sampled output
 * includes exactly), so a route drawn through pins still touches each pin, and the
 * centripetal parameterisation never loops or cusps on uneven spacing.
 */
export function catmullRomSample(points, samples = 8) {
  if (points.length < 3) return points.map((point) => [point[0], point[1]])
  const out = [[points[0][0], points[0][1]]]
  const step = Math.max(1, Math.floor(samples))

  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] || points[index]
    const p1 = points[index]
    const p2 = points[index + 1]
    const p3 = points[index + 2] || points[index + 1]

    // Knot spacing: √distance, the centripetal choice. A zero gap (a duplicated
    // end point) is nudged so the division below stays finite.
    const knot = (a, b) => Math.max(Math.sqrt(segmentLength(a, b)), 1e-9)
    const t1 = knot(p0, p1)
    const t2 = t1 + knot(p1, p2)
    const t3 = t2 + knot(p2, p3)

    for (let sample = 1; sample <= step; sample += 1) {
      if (sample === step) {
        out.push([p2[0], p2[1]])
        break
      }
      const t = t1 + ((t2 - t1) * sample) / step
      const point = [0, 1].map((axis) => {
        const a1 = ((t1 - t) / t1) * p0[axis] + (t / t1) * p1[axis]
        const a2 = ((t2 - t) / (t2 - t1)) * p1[axis] + ((t - t1) / (t2 - t1)) * p2[axis]
        const a3 = ((t3 - t) / (t3 - t2)) * p2[axis] + ((t - t2) / (t3 - t2)) * p3[axis]
        const b1 = ((t2 - t) / t2) * a1 + (t / t2) * a2
        const b2 = ((t3 - t) / (t3 - t1)) * a2 + ((t - t1) / (t3 - t1)) * a3
        return ((t2 - t) / (t2 - t1)) * b1 + ((t - t1) / (t2 - t1)) * b2
      })
      out.push(point)
    }
  }
  return out
}

/** Unsigned area of one ring (shoelace). */
export function ringArea(ring) {
  let sum = 0
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index]
    const b = ring[(index + 1) % ring.length]
    sum += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(sum) / 2
}

/** A region's area: its outer ring less its holes. */
export function regionArea(rings) {
  if (!rings.length) return 0
  let area = ringArea(rings[0])
  for (let index = 1; index < rings.length; index += 1) area -= ringArea(rings[index])
  return Math.max(0, area)
}

/** Even–odd containment in one ring (a ray cast to +x). */
export function pointInRing(point, ring) {
  const [x, y] = point
  let inside = false
  for (let index = 0, prev = ring.length - 1; index < ring.length; prev = index, index += 1) {
    const [xi, yi] = ring[index]
    const [xj, yj] = ring[prev]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Even–odd across every ring, so a hole is outside. */
export const pointInRegion = (point, rings) =>
  rings.reduce((inside, ring) => (pointInRing(point, ring) ? !inside : inside), false)

/**
 * Where segment a→b crosses the edges of `ring`, as parameters strictly between 0
 * and 1, ascending. Parallel and touching-at-an-end cases count as no crossing.
 */
export function segmentRingCrossings(a, b, ring) {
  const out = []
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  for (let index = 0; index < ring.length; index += 1) {
    const c = ring[index]
    const d = ring[(index + 1) % ring.length]
    const ex = d[0] - c[0]
    const ey = d[1] - c[1]
    const denominator = dx * ey - dy * ex
    if (denominator === 0) continue
    const t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / denominator
    const u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / denominator
    if (t > 0 && t < 1 && u >= 0 && u < 1) out.push(t)
  }
  return out.sort((left, right) => left - right)
}

/** The closest point on a polyline to `point`: its segment, parameter and distance. */
export function nearestOnPolyline(points, point) {
  let best = null
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index]
    const b = points[index + 1]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const lengthSq = dx * dx + dy * dy
    const t = lengthSq > 0
      ? Math.min(1, Math.max(0, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSq))
      : 0
    const at = [a[0] + dx * t, a[1] + dy * t]
    const distance = segmentLength(at, point)
    if (!best || distance < best.distance) best = { index, t, point: at, distance }
  }
  return best
}

/* ---------- drawing-only helpers (no Rust twin) ---------- */

/** Ramer–Douglas–Peucker: drop points closer than `epsilon` to the line they sit on. */
export function simplifyDP(points, epsilon) {
  if (points.length < 3) return points.slice()
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()
    const a = points[first]
    const b = points[last]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const length = Math.hypot(dx, dy)
    let farthest = -1
    let farthestDistance = 0
    for (let index = first + 1; index < last; index += 1) {
      const p = points[index]
      const distance = length > 0
        ? Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / length
        : Math.hypot(p[0] - a[0], p[1] - a[1])
      if (distance > farthestDistance) {
        farthestDistance = distance
        farthest = index
      }
    }
    if (farthest !== -1 && farthestDistance > epsilon) {
      keep[farthest] = 1
      stack.push([first, farthest], [farthest, last])
    }
  }
  return points.filter((_, index) => keep[index])
}

/** Chaikin corner cutting, `iterations` times. A closed ring stays closed. */
export function chaikin(points, iterations = 1, closed = false) {
  let current = points
  for (let pass = 0; pass < iterations; pass += 1) {
    if (current.length < 3) return current
    const next = closed ? [] : [current[0]]
    const count = closed ? current.length : current.length - 1
    for (let index = 0; index < count; index += 1) {
      const a = current[index]
      const b = current[(index + 1) % current.length]
      next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]])
      next.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]])
    }
    if (!closed) next.push(current[current.length - 1])
    current = next
  }
  return current
}

/**
 * An SVG path `d` through `points`; `closed` adds a Z. Rounded to 0.001 to keep it
 * small — still well under a pixel at the deepest zoom.
 */
export function pathData(points, closed = false) {
  if (!points.length) return ''
  const fmt = (value) => Math.round(value * 1000) / 1000
  let d = `M${fmt(points[0][0])} ${fmt(points[0][1])}`
  for (let index = 1; index < points.length; index += 1) d += `L${fmt(points[index][0])} ${fmt(points[index][1])}`
  return closed ? `${d}Z` : d
}
