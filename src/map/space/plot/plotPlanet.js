/**
 * plotPlanet.js — a world (or a star) as an engraved plate: its outline, a light
 * graticule, coastlines traced from the same seeded ground the 3D view paints
 * (planetTexture.js), the sea in fine level lines, high ground stippled, the night
 * side hatched beyond the terminator, and the writer's regions, routes, labels and
 * places in one ink.
 *
 * Giants are drawn by their bands' edges, ice worlds by their cracks, a star as a
 * stippled disc that darkens to its limb, with rays. A world wearing a picture
 * (`look.kind 'texture'`) has no ground to trace, so it is outline, graticule and
 * what the writer drew.
 *
 * Fills are hatching: lines across the plate, kept where the ray through them meets
 * the part of the globe they fill. Pure and deterministic, like the other plates.
 */
import { Vector3 } from 'three'
import { pinLabel } from '../../../lib/map/mapModel'
import { hiddenLayers, isItemShown } from '../../../lib/map/mapVisibility'
import { planetTexture } from '../../../lib/map/planetTexture'
import { routeCoords } from '../../../lib/map/mapSpace'
import { random } from '../../../lib/map/seeded'
import { lonLatToUnit, subsolarPoint } from '../spaceMath'
import { dotsPath, escapeXml, fmt, linePath, namer, runs } from './plotParts'

/** The ground is traced from a picture of the world this size (lon × lat). */
export const PLANET_PLOT_GRID = { width: 384, height: 192 }
/** Points on the globe high ground may be stippled at. */
const STIPPLE_POINTS = 60000
/** Degrees between the graticule's lines, and between the points along them. */
const GRATICULE_STEP = 30
const ALONG_STEP = 2

const unit = (point) => new Vector3(...lonLatToUnit(point))

/** Where a ray meets the unit sphere first, or null. */
function hitSphere({ origin, direction }) {
  const b = origin.dot(direction)
  const c = origin.lengthSq() - 1
  const discriminant = b * b - c
  if (discriminant < 0) return null
  const t = -b - Math.sqrt(discriminant)
  return t < 0 ? null : origin.clone().addScaledVector(direction, t)
}

/** A great-circle walk from `a` to `b` (unit vectors), a point every `ALONG_STEP` degrees. */
function along(a, b) {
  const angle = a.angleTo(b)
  const steps = Math.max(1, Math.ceil(angle / ((ALONG_STEP * Math.PI) / 180)))
  const out = []
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps
    if (angle < 1e-9) out.push(a.clone())
    else {
      const s = Math.sin(angle)
      out.push(a.clone().multiplyScalar(Math.sin((1 - t) * angle) / s).addScaledVector(b, Math.sin(t * angle) / s))
    }
  }
  return out
}

/** A line of lon/lat points on the globe, densified, as unit vectors. */
function globeLine(points, closed = false) {
  const units = points.map(unit)
  if (closed && units.length > 2) units.push(units[0])
  const out = []
  for (let index = 1; index < units.length; index += 1) {
    const step = along(units[index - 1], units[index])
    out.push(...(index === 1 ? step : step.slice(1)))
  }
  return units.length === 1 ? units : out
}

/**
 * A scalar field over the grid to trace: the ground's height for a rocky world,
 * the bands' brightness for a giant, the ice's shade for an ice world. Values 0…1.
 */
function groundField(look, mask) {
  const { width, height } = PLANET_PLOT_GRID
  if (!['generated', 'gas', 'ice'].includes(look.kind)) return null
  const picture = planetTexture(look, { width, height, mask })
  const field = new Float32Array(width * height)
  if (look.kind === 'generated') {
    for (let index = 0; index < field.length; index += 1) field[index] = picture.relief[index] / 255
    return { field, width, height }
  }
  let low = Infinity
  let high = -Infinity
  for (let index = 0; index < field.length; index += 1) {
    const value = 0.3 * picture.color[index * 4] + 0.59 * picture.color[index * 4 + 1] + 0.11 * picture.color[index * 4 + 2]
    field[index] = value
    low = Math.min(low, value)
    high = Math.max(high, value)
  }
  for (let index = 0; index < field.length; index += 1) field[index] = (field[index] - low) / Math.max(1e-6, high - low)
  return { field, width, height }
}

/** The field's value under a unit vector (nearest cell). */
function sample(ground, v) {
  const lon = Math.atan2(-v.z, v.x)
  const lat = Math.asin(Math.max(-1, Math.min(1, v.y)))
  const x = Math.min(ground.width - 1, Math.max(0, Math.floor(((lon + Math.PI) / (2 * Math.PI)) * ground.width)))
  const y = Math.min(ground.height - 1, Math.max(0, Math.floor(((Math.PI / 2 - lat) / Math.PI) * ground.height)))
  return ground.field[y * ground.width + x]
}

/**
 * Where the field crosses `level`, by marching squares: `[[lon, lat], [lon, lat]]`
 * segments (the grid wraps east–west, so a coast across the date line is whole).
 */
function contour(ground, level) {
  const { field, width, height } = ground
  const value = (x, y) => field[y * width + (((x % width) + width) % width)]
  const lonOf = (x) => ((x + 0.5) / width) * 360 - 180
  const latOf = (y) => 90 - ((y + 0.5) / height) * 180
  const segments = []
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const corners = [value(x, y), value(x + 1, y), value(x + 1, y + 1), value(x, y + 1)]
      const at = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]]
      const crossings = []
      for (let edge = 0; edge < 4; edge += 1) {
        const a = corners[edge]
        const b = corners[(edge + 1) % 4]
        if ((a < level) === (b < level)) continue
        const t = (level - a) / (b - a)
        const [ax, ay] = at[edge]
        const [bx, by] = at[(edge + 1) % 4]
        crossings.push([lonOf(ax + (bx - ax) * t), latOf(ay + (by - ay) * t)])
      }
      if (crossings.length === 2) segments.push(crossings)
      else if (crossings.length === 4) segments.push([crossings[0], crossings[1]], [crossings[2], crossings[3]])
    }
  }
  return segments
}

/** Hatching: parallel lines `spacing` apart at `angle`, kept where `keep(point)` on the globe. */
function hatch(eye, box, angle, spacing, keep, step) {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const nx = -dy
  const ny = dx
  const cx = (box.left + box.right) / 2
  const cy = (box.top + box.bottom) / 2
  const reach = Math.hypot(box.right - box.left, box.bottom - box.top) / 2
  const out = []
  for (let offset = -reach; offset <= reach; offset += spacing) {
    let start = null
    let last = null
    for (let t = -reach; t <= reach; t += step) {
      const x = cx + nx * offset + dx * t
      const y = cy + ny * offset + dy * t
      const inside = x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
      const point = inside ? hitSphere(eye.ray(x, y)) : null
      if (point && keep(point)) {
        if (!start) start = [x, y]
        last = [x, y]
      } else if (start) {
        out.push(`M${fmt(start[0])} ${fmt(start[1])}L${fmt(last[0])} ${fmt(last[1])}`)
        start = null
      }
    }
    if (start) out.push(`M${fmt(start[0])} ${fmt(start[1])}L${fmt(last[0])} ${fmt(last[1])}`)
  }
  return out.join('')
}

/** Points along the globe projected, null where they face away. */
const projectFacing = (eye, facing, points) => points.map((v) => (facing(v) ? eye.project(v) : null))
const stroke = (d, width, scale, extra = '') => (d ? `<path d="${d}" fill="none" stroke="var(--plot-ink)" stroke-width="${fmt(width * scale)}" stroke-linecap="round" stroke-linejoin="round"${extra}/>` : '')

/** A world or a star: the plate's strokes into `out`. `mask` is the writer's drawn ground (planetSurface.js `regionMask`). */
export function plotPlanet(map, space, day, eye, scale, out, { mask = null } = {}) {
  const { surface } = map
  const look = surface.look
  const isStar = look.kind === 'star'
  // A point on the near side: in front of its own horizon from where the eye is.
  const facing = eye.ortho
    ? (v) => v.dot(eye.forward) < 0
    : (v) => v.dot(eye.position.clone().sub(v)) > 0

  // The limb: where the line of sight grazes the globe.
  const distance = eye.position.length()
  const axis = eye.ortho ? eye.forward.clone().negate() : eye.position.clone().normalize()
  const centre = eye.ortho ? new Vector3() : eye.position.clone().divideScalar(distance * distance)
  const radius = eye.ortho ? 1 : Math.sqrt(Math.max(0, 1 - 1 / (distance * distance)))
  const across = new Vector3(0, 1, 0).cross(axis)
  if (across.lengthSq() < 1e-9) across.set(1, 0, 0)
  across.normalize()
  const up = axis.clone().cross(across).normalize()
  const limb = []
  for (let index = 0; index <= 256; index += 1) {
    const angle = (index / 256) * Math.PI * 2
    limb.push(eye.project(centre.clone().addScaledVector(across, Math.cos(angle) * radius).addScaledVector(up, Math.sin(angle) * radius)))
  }
  const onPlate = limb.filter(Boolean)
  const box = onPlate.length
    ? {
        left: Math.max(0, Math.min(...onPlate.map((p) => p[0]))),
        right: Math.max(...onPlate.map((p) => p[0])),
        top: Math.max(0, Math.min(...onPlate.map((p) => p[1]))),
        bottom: Math.max(...onPlate.map((p) => p[1])),
      }
    : null

  const sun = isStar ? null : unit(subsolarPoint(surface, day))
  const ground = isStar ? null : groundField(look, mask)
  const seaLevel = look.seaLevel ?? 0.55

  if (isStar) {
    // Granulation, stippled thicker toward the limb, where a star darkens.
    const rand = random(look.seed >>> 0)
    const dots = []
    for (let index = 0; index < STIPPLE_POINTS / 2; index += 1) {
      const v = new Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1)
      if (v.lengthSq() > 1 || v.lengthSq() < 1e-6) continue
      v.normalize()
      if (!facing(v)) continue
      const toward = Math.abs(v.dot(axis))
      if (rand() > 0.12 + (1 - toward) * 0.7) continue
      const point = eye.project(v)
      if (point) dots.push(point)
    }
    out.push(`<path d="${dotsPath(dots)}" stroke="var(--plot-ink)" stroke-width="${fmt(0.9 * scale)}" stroke-linecap="round"/>`)
  }

  if (box && ground && look.kind === 'generated') {
    // The sea in level lines, as an engraver lays water.
    out.push(stroke(hatch(eye, box, 0, 3 * scale, (v) => sample(ground, v) < seaLevel, 1.2 * scale), 0.4, scale, ' opacity="0.75"'))
    // High ground, stippled the thicker the higher.
    const rand = random((look.seed >>> 0) + 3)
    const dots = []
    const golden = Math.PI * (3 - Math.sqrt(5))
    for (let index = 0; index < STIPPLE_POINTS; index += 1) {
      const y = 1 - ((index + 0.5) / STIPPLE_POINTS) * 2
      const r = Math.sqrt(1 - y * y)
      const v = new Vector3(Math.cos(golden * index) * r, y, Math.sin(golden * index) * r)
      const height = (sample(ground, v) - seaLevel) / Math.max(1e-6, 1 - seaLevel)
      if (height < 0.35 || rand() > (height - 0.35) * 1.6 || !facing(v)) continue
      const point = eye.project(v)
      if (point) dots.push(point)
    }
    if (dots.length) out.push(`<path d="${dotsPath(dots)}" stroke="var(--plot-ink)" stroke-width="${fmt(0.8 * scale)}" stroke-linecap="round"/>`)
  }

  // The night side, hatched beyond the terminator.
  if (box && sun) out.push(stroke(hatch(eye, box, Math.PI / 4, 2.4 * scale, (v) => v.dot(sun) < 0, 1.2 * scale), 0.5, scale))

  // Coastlines, band edges or cracks: the ground's own lines.
  if (ground) {
    const levels = look.kind === 'generated' ? [seaLevel] : look.kind === 'gas' ? [0.35, 0.65] : [0.25]
    const lines = []
    for (const level of levels) {
      for (const [a, b] of contour(ground, level)) {
        const ua = unit(a)
        const ub = unit(b)
        if (!facing(ua) || !facing(ub)) continue
        const pa = eye.project(ua)
        const pb = eye.project(ub)
        if (pa && pb) lines.push(`M${fmt(pa[0])} ${fmt(pa[1])}L${fmt(pb[0])} ${fmt(pb[1])}`)
      }
    }
    out.push(stroke(lines.join(''), look.kind === 'generated' ? 0.8 : 0.55, scale))
  }

  // The graticule, faint and dotted.
  const graticule = []
  for (let lat = -90 + GRATICULE_STEP; lat < 90; lat += GRATICULE_STEP) {
    const ring = []
    for (let lon = -180; lon <= 180; lon += ALONG_STEP) ring.push(unit([lon, lat]))
    for (const part of runs(projectFacing(eye, facing, ring), () => 'all')) graticule.push(linePath(part.points))
  }
  for (let lon = -180; lon < 180; lon += GRATICULE_STEP) {
    const meridian = []
    for (let lat = -90; lat <= 90; lat += ALONG_STEP) meridian.push(unit([lon, lat]))
    for (const part of runs(projectFacing(eye, facing, meridian), () => 'all')) graticule.push(linePath(part.points))
  }
  out.push(stroke(graticule.join(''), 0.35, scale, ` stroke-dasharray="${fmt(1 * scale)} ${fmt(2.5 * scale)}" opacity="0.6"`))

  // The outline.
  for (const part of runs(limb, () => 'all')) out.push(stroke(linePath(part.points), 1.1, scale))

  // Rays, for a star.
  if (isStar && box) {
    const cx = (box.left + box.right) / 2
    const cy = (box.top + box.bottom) / 2
    const r = (box.right - box.left) / 2
    const rays = []
    for (let index = 0; index < 24; index += 1) {
      const angle = (index / 24) * Math.PI * 2
      const length = index % 2 ? 1.12 : 1.22
      rays.push(`M${fmt(cx + Math.cos(angle) * r * 1.04)} ${fmt(cy + Math.sin(angle) * r * 1.04)}L${fmt(cx + Math.cos(angle) * r * length)} ${fmt(cy + Math.sin(angle) * r * length)}`)
    }
    out.push(stroke(rays.join(''), 0.8, scale))
  }

  // What the writer drew.
  const hidden = hiddenLayers(map)
  const shown = (item) => isItemShown(map, item, day, hidden)
  const names = namer(scale)
  const regionLines = []
  for (const region of map.regions.filter(shown)) {
    for (const ring of region.rings) {
      if (ring.length < 2) continue
      for (const part of runs(projectFacing(eye, facing, globeLine(ring, true)), () => 'all')) regionLines.push(linePath(part.points))
    }
  }
  out.push(stroke(regionLines.join(''), 0.9, scale))
  const routeLines = []
  for (const route of map.routes.filter(shown)) {
    const coords = routeCoords(map, space, route, day).filter(Boolean)
    if (coords.length < 2) continue
    for (const part of runs(projectFacing(eye, facing, globeLine(coords)), () => 'all')) routeLines.push(linePath(part.points))
  }
  out.push(stroke(routeLines.join(''), 1, scale, ` stroke-dasharray="${fmt(4 * scale)} ${fmt(2 * scale)}"`))

  const marks = []
  for (const pin of map.pins.filter(shown)) {
    if (!pin.at) continue
    const v = unit(pin.at)
    if (!facing(v)) continue
    const point = eye.project(v)
    if (!point) continue
    marks.push(`<circle cx="${fmt(point[0])}" cy="${fmt(point[1])}" r="${fmt(2.6 * scale)}" fill="var(--plot-ink)" stroke="var(--plot-paper)" stroke-width="${fmt(0.8 * scale)}"/>`)
    names.add(pinLabel(pin), point, 6, { force: true })
  }
  for (const region of map.regions.filter(shown)) {
    if (!region.name || !region.rings[0]?.length) continue
    const middle = region.rings[0].reduce((sum, point) => sum.add(unit(point)), new Vector3()).normalize()
    if (!facing(middle)) continue
    const point = eye.project(middle)
    if (point) names.add(region.name.toUpperCase(), [point[0] - region.name.length * 3 * scale, point[1]], 0)
  }
  const texts = []
  for (const label of map.labels.filter(shown)) {
    const at = label.at || label.path?.[0]
    if (!at || !label.text) continue
    const v = unit(at)
    if (!facing(v)) continue
    const point = eye.project(v)
    if (point) texts.push(`<text x="${fmt(point[0])}" y="${fmt(point[1])}" font-size="${fmt(12 * scale)}" font-style="italic" text-anchor="middle">${escapeXml(label.text)}</text>`)
  }
  out.push(marks.join(''), `<g class="plot-names">${names.svg()}${texts.join('')}</g>`)
}
