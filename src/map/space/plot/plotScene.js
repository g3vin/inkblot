/**
 * plotScene.js — a 3D map as a printed plate: vector line art in one ink, drawn
 * through the camera as the writer framed it, for SVG, PDF and the printer.
 *
 * A star system: orbits as fine lines, their far halves dashed (depth without
 * colour); stars as discs with rays; worlds as small discs, their night halves
 * hatched away from the brightest star; belts stippled; a three-body dance as its
 * trails. A galaxy: stippled, a dot per star of the generator (galaxyGen.js), its
 * dust lanes left as paper, with rings of distance. A group of galaxies: each a
 * little stipple of itself, turned as on screen. Names in the map's label face.
 *
 * Deterministic: the same map, day and camera give the same SVG, with no raster in
 * it. Colours are the map theme's ink (spacePalette.js `INK_PALETTES`).
 */
import { Euler, Matrix4, Vector3 } from 'three'
import { generateGalaxy } from '../../../lib/map/galaxyGen'
import { runFor } from '../../../lib/map/nbody'
import { orbitPath } from '../../../lib/map/orbits'
import { random, seedOf } from '../../../lib/map/seeded'
import { INK_PALETTES } from '../../../lib/map/spacePalette'
import { pinLabel } from '../../../lib/map/mapModel'
import { systemToScene } from '../spaceMath'
import { plotCamera } from './plotCamera'

const RAD = Math.PI / 180
const KLY = 1000
const LY_PER_MPC = 3261563.8
/** Smallest disc each kind of body is drawn, in pixels across (as on screen). */
const MIN_PIXELS = { star: 12, planet: 7, dwarf: 4.5, moon: 4, station: 4.5 }
const ORBIT_SAMPLES = 240
/** A galaxy in a group is drawn at least this many pixels in radius (galaxyScene.js holds them to 30 across). */
const MIN_GALAXY_PX = 15

const fmt = (value) => (Math.round(value * 10) / 10).toString()
const escapeXml = (text) => String(text).replace(/[<>&"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[char])

/** Dots as one path: a zero-length stroke with a round cap is a dot. */
const dotsPath = (points) => points.map(([x, y]) => `M${fmt(x)} ${fmt(y)}h0`).join('')

/** A polyline's points split into runs (`split(index)` says which side a point is on). */
function runs(points, side) {
  const out = []
  let current = null
  points.forEach((point, index) => {
    if (!point) {
      current = null
      return
    }
    const which = side(index)
    if (!current || current.side !== which) {
      // Each run starts where the last ended, so the line is unbroken.
      current = { side: which, points: current ? [current.points[current.points.length - 1], point] : [point] }
      out.push(current)
    } else current.points.push(point)
  })
  return out
}
const linePath = (points) => points.map(([x, y], index) => `${index ? 'L' : 'M'}${fmt(x)} ${fmt(y)}`).join('')

/** Names placed where they do not overlap one already written. */
function namer(scale) {
  const boxes = []
  const out = []
  return {
    add(text, [x, y], dx = 8, { bold = false, force = false } = {}) {
      if (!text) return
      const size = 11 * scale
      const box = { left: x + dx * scale, right: x + dx * scale + text.length * size * 0.56, top: y - size, bottom: y + size * 0.3 }
      if (!force && boxes.some((other) => box.left < other.right && other.left < box.right && box.top < other.bottom && other.top < box.bottom)) return
      boxes.push(box)
      out.push(`<text x="${fmt(box.left)}" y="${fmt(y + size * 0.35)}" font-size="${fmt(size)}"${bold ? ' font-weight="600"' : ''}>${escapeXml(text)}</text>`)
    },
    svg: () => out.join(''),
  }
}

/* ---------------- a star system ---------------- */

function plotSystem(map, space, day, eye, scale, out) {
  const { system } = map
  const display = system.display
  const byId = new Map(system.bodies.map((body) => [body.id, body]))
  const turn = new Matrix4().makeRotationFromEuler(new Euler((system.plane?.tiltDeg || 0) * RAD, (system.plane?.headingDeg || 0) * RAD, 0, 'YXZ'))
  const scene = (point) => new Vector3(...systemToScene(point, display)).applyMatrix4(turn)
  const positions = space.positionsAt(day)
  const at = (id) => positions.get(id) || [0, 0, 0]
  const nbody = system.dynamics === 'nbody'

  // Orbits and trails.
  const front = []
  const back = []
  if (nbody) {
    const run = runFor(system)
    const horizon = system.nbody?.horizonDays || 3650
    for (const id of run.ids) {
      const points = run.trail(id, 0, horizon).map((point) => eye.project(scene(point)))
      for (const part of runs(points, () => 'front')) front.push(linePath(part.points))
    }
  } else {
    for (const body of system.bodies) {
      if (!body.orbit || body.kind === 'belt') continue
      const centre = at(body.parent)
      const centreDepth = eye.depth(scene(centre))
      const world = orbitPath(body, byId, ORBIT_SAMPLES).map((offset) => scene([centre[0] + offset[0], centre[1] + offset[1], (centre[2] || 0) + offset[2]]))
      const points = world.map((v) => eye.project(v))
      for (const part of runs(points, (index) => (eye.depth(world[index]) > centreDepth + 1e-9 ? 'back' : 'front'))) {
        ;(part.side === 'back' ? back : front).push(linePath(part.points))
      }
    }
  }
  out.push(`<path d="${front.join('')}" fill="none" stroke="var(--plot-ink)" stroke-width="${fmt(0.7 * scale)}"/>`)
  if (back.length) out.push(`<path d="${back.join('')}" fill="none" stroke="var(--plot-ink)" stroke-width="${fmt(0.6 * scale)}" stroke-dasharray="${fmt(3 * scale)} ${fmt(2.5 * scale)}"/>`)

  // Belts, stippled.
  for (const body of system.bodies) {
    if (body.kind !== 'belt') continue
    const inner = Number(body.belt?.innerAU) || 2
    const outer = Number(body.belt?.outerAU) || inner * 1.3
    const rand = random(seedOf(body.id))
    const centre = at(body.parent)
    const dots = []
    for (let index = 0; index < 1400; index += 1) {
      const r = inner + (outer - inner) * Math.sqrt(rand())
      const angle = rand() * Math.PI * 2
      const point = eye.project(scene([centre[0] + r * Math.cos(angle), centre[1] + r * Math.sin(angle), (centre[2] || 0) + (rand() - 0.5) * 0.08 * r]))
      if (point) dots.push(point)
    }
    out.push(`<path d="${dotsPath(dots)}" stroke="var(--plot-ink)" stroke-width="${fmt(1.1 * scale)}" stroke-linecap="round"/>`)
  }

  // Bodies, far ones first so near ones overlap them.
  const stars = system.bodies.filter((body) => body.kind === 'star').sort((a, b) => (b.star?.luminositySun ?? 1) - (a.star?.luminositySun ?? 1))
  const brightest = stars[0] ? scene(at(stars[0].id)) : null
  const drawn = system.bodies
    .filter((body) => body.kind !== 'belt' && body.kind !== 'barycenter')
    .map((body) => ({ body, world: scene(at(body.id)) }))
    .map((entry) => ({ ...entry, screen: eye.project(entry.world), depth: eye.depth(entry.world) }))
    .filter((entry) => entry.screen)
    .sort((a, b) => b.depth - a.depth)
  const names = namer(scale)
  for (const { body, world, screen } of drawn) {
    const [x, y] = screen
    const r = ((MIN_PIXELS[body.kind] || 3) / 2) * scale
    if (body.kind === 'star') {
      const rays = []
      for (let index = 0; index < 8; index += 1) {
        const angle = (index / 8) * Math.PI * 2
        rays.push(`M${fmt(x + Math.cos(angle) * r * 1.35)} ${fmt(y + Math.sin(angle) * r * 1.35)}L${fmt(x + Math.cos(angle) * r * (index % 2 ? 1.9 : 2.4))} ${fmt(y + Math.sin(angle) * r * (index % 2 ? 1.9 : 2.4))}`)
      }
      out.push(`<circle cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(r)}" fill="var(--plot-ink)"/><path d="${rays.join('')}" stroke="var(--plot-ink)" stroke-width="${fmt(0.8 * scale)}" stroke-linecap="round"/>`)
      names.add(body.name, [x, y], 12 + r / scale, { bold: true, force: true })
      continue
    }
    out.push(`<circle cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(r)}" fill="var(--plot-paper)" stroke="var(--plot-ink)" stroke-width="${fmt(0.8 * scale)}"/>`)
    // The night half, hatched: the side facing away from the brightest star.
    const sun = brightest ? eye.project(brightest) : null
    if (sun && (sun[0] !== x || sun[1] !== y) && body.kind !== 'station') {
      const toward = Math.atan2(sun[1] - y, sun[0] - x)
      const point = (angle) => `${fmt(x + Math.cos(angle) * r)} ${fmt(y + Math.sin(angle) * r)}`
      out.push(`<path d="M${point(toward + Math.PI / 2)}A${fmt(r)} ${fmt(r)} 0 0 1 ${point(toward + Math.PI)}A${fmt(r)} ${fmt(r)} 0 0 1 ${point(toward + Math.PI * 1.5)}Z" fill="url(#plot-hatch)" stroke="none"/>`)
    }
    // Rings, as an ellipse through the camera (its far side would hide behind the disc; drawn whole, it reads).
    if (body.rings) {
      const ringPoints = []
      for (let index = 0; index <= 64; index += 1) {
        const angle = (index / 64) * Math.PI * 2
        ringPoints.push(eye.project(world.clone().add(new Vector3(Math.cos(angle), 0, Math.sin(angle)).applyMatrix4(turn).multiplyScalar((r * 2.1) / Math.max(1e-9, eye.pxPerUnitAt(world))))))
      }
      if (ringPoints.every(Boolean)) out.push(`<path d="${linePath(ringPoints)}" fill="none" stroke="var(--plot-ink)" stroke-width="${fmt(0.7 * scale)}"/>`)
    }
    if (body.kind !== 'moon') names.add(body.name, [x, y], 6 + r / scale)
  }
  for (const { body, screen } of drawn) if (body.kind === 'moon') names.add(body.name, screen, 4)
  out.push(`<g class="plot-names">${names.svg()}</g>`)
}

/* ---------------- a galaxy, and a group of them ---------------- */

/** Galaxy light-years (disc in x–y) → scene units of `unit` light-years. */
const galaxyPoint = (positions, index, unit) => new Vector3(positions[index] / unit, positions[index + 2] / unit, -positions[index + 1] / unit)

function plotGalaxy(map, eye, scale, out) {
  const galaxy = map.galaxy
  const result = generateGalaxy(galaxy, { count: 26000 })
  const stars = []
  for (let index = 0; index < result.positions.length; index += 3) {
    const point = eye.project(galaxyPoint(result.positions, index, KLY))
    if (point) stars.push(point)
  }
  const reach = galaxy.radiusLy / KLY
  // Rings of distance every ten thousand light-years, dotted.
  const rings = []
  for (let radius = 10; radius <= Math.ceil(reach / 10) * 10; radius += 10) {
    const points = []
    for (let index = 0; index <= 128; index += 1) {
      const angle = (index / 128) * Math.PI * 2
      points.push(eye.project(new Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)))
    }
    for (const part of runs(points, () => 'all')) rings.push(linePath(part.points))
  }
  out.push(`<path d="${rings.join('')}" fill="none" stroke="var(--plot-ink)" stroke-width="${fmt(0.4 * scale)}" stroke-dasharray="${fmt(1 * scale)} ${fmt(3 * scale)}" opacity="0.6"/>`)
  out.push(`<path d="${dotsPath(stars)}" stroke="var(--plot-ink)" stroke-width="${fmt(0.95 * scale)}" stroke-linecap="round"/>`)
  // Dust, as paper laid over the stars: the dark lanes of a photograph, here gaps.
  const dust = []
  for (let index = 0; index < result.dust.positions.length; index += 3) {
    const point = eye.project(galaxyPoint(result.dust.positions, index, KLY))
    if (point) dust.push(point)
  }
  if (dust.length) out.push(`<path d="${dotsPath(dust)}" stroke="var(--plot-paper)" stroke-width="${fmt(1.6 * scale)}" stroke-linecap="round" opacity="0.8"/>`)
  plotPins(map, eye, scale, out, (pin) => new Vector3((pin.at[0] || 0) / KLY, (pin.at[2] || 0) / KLY, -(pin.at[1] || 0) / KLY))
}

function plotUniverse(map, eye, scale, out) {
  const dots = []
  for (const pin of map.pins) {
    const look = pin.galaxy
    if (!look || !pin.at) continue
    const seed = Number.isFinite(look.seed) ? look.seed : seedOf(pin.id)
    const centre = new Vector3(pin.at[0], pin.at[2] || 0, -pin.at[1])
    // Turned as on screen (galaxyScene.js), and as much bigger than life.
    const rand = random(seed)
    const turn = new Matrix4().makeRotationFromEuler(new Euler(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI))
    const result = generateGalaxy({ type: look.type || 'Sb', seed, radiusLy: look.radiusLy || 50000, thicknessLy: 1000 }, { count: 320 })
    // As on screen: bigger than life, and never smaller than a thumbnail's worth.
    const radiusLy = look.radiusLy || 50000
    const stretch = Math.max(3 / LY_PER_MPC, (MIN_GALAXY_PX * scale) / (eye.pxPerUnitAt(centre) * radiusLy))
    for (let index = 0; index < result.positions.length; index += 3) {
      const local = new Vector3(result.positions[index], result.positions[index + 1], result.positions[index + 2]).multiplyScalar(stretch).applyMatrix4(turn)
      const point = eye.project(local.add(centre))
      if (point) dots.push(point)
    }
  }
  out.push(`<path d="${dotsPath(dots)}" stroke="var(--plot-ink)" stroke-width="${fmt(0.9 * scale)}" stroke-linecap="round"/>`)
  plotPins(map, eye, scale, out, (pin) => new Vector3(pin.at[0], pin.at[2] || 0, -pin.at[1]), { marks: false })
}

/** Places (star systems in a galaxy, galaxies in a group): a ring (unless `marks` is off) and a name. */
function plotPins(map, eye, scale, out, toScene, { marks = true } = {}) {
  const names = namer(scale)
  const rings = []
  for (const pin of map.pins) {
    if (!pin.at) continue
    const point = eye.project(toScene(pin))
    if (!point) continue
    if (marks) rings.push(`<circle cx="${fmt(point[0])}" cy="${fmt(point[1])}" r="${fmt(3.5 * scale)}" fill="var(--plot-paper)" stroke="var(--plot-ink)" stroke-width="${fmt(0.9 * scale)}"/>`)
    names.add(pinLabel(pin), point, marks ? 7 : MIN_GALAXY_PX + 2)
  }
  out.push(rings.join(''), `<g class="plot-names">${names.svg()}</g>`)
}

/* ---------------- the plate ---------------- */

/**
 * The plate as an SVG string: `map` on `day`, through `camera` (a saved space
 * camera), `width` × `height` pixels times `scale`. `mono` draws black on white
 * whatever the theme.
 */
export function plotScene(map, space, { day = 0, camera, width, height, scale = 1, mono = false, title = null }) {
  const palette = mono ? INK_PALETTES.ink : INK_PALETTES[map.style.theme] || INK_PALETTES.ink
  const W = Math.round(width * scale)
  const H = Math.round(height * scale)
  const eye = plotCamera(camera, W, H)
  const out = []
  if (map.mapKind === 'system') plotSystem(map, space, day, eye, scale, out)
  else if (map.mapKind === 'galaxy') plotGalaxy(map, eye, scale, out)
  else if (map.mapKind === 'universe') plotUniverse(map, eye, scale, out)
  const heading = title ? `<text x="${fmt(24 * scale)}" y="${fmt(40 * scale)}" font-size="${fmt(20 * scale)}" letter-spacing="${fmt(2 * scale)}">${escapeXml(String(title).toUpperCase())}</text>` : ''
  return {
    width: W,
    height: H,
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
      `<style>svg{--plot-ink:${palette.ink};--plot-paper:${palette.paper};}text{fill:var(--plot-ink);font-family:Georgia, 'Times New Roman', serif;}</style>` +
      `<defs><pattern id="plot-hatch" width="${fmt(2.2 * scale)}" height="${fmt(2.2 * scale)}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V${fmt(2.2 * scale)}" stroke="var(--plot-ink)" stroke-width="${fmt(0.6 * scale)}"/></pattern></defs>` +
      `<rect width="100%" height="100%" fill="var(--plot-paper)"/>` +
      out.join('') +
      heading +
      `</svg>`,
  }
}
