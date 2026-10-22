/**
 * systemScene.js — a star system's contents in 3D.
 *
 * The scene graph is: a `plane` group turned by the system's tilt and heading
 * (`system.plane`), holding a faint polar grid, every orbit (or N-body trail), belt
 * and habitable zone, and every body. Body positions come from the map's space
 * (`positionsAt(day)`, Kepler or N-body alike), squeezed as the flat map squeezes
 * them (spaceMath.js).
 *
 * What changes with the day — body positions, orbits round moving parents, a
 * pulsar's sweep — is set in `setDay`; what changes with the camera — how big each
 * body is drawn, never smaller than a few pixels — in `beforeRender`. Nothing else
 * is rebuilt until the system itself changes, and then the scene is built anew.
 */
import {
  AdditiveBlending,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  Points,
  PointsMaterial,
  RingGeometry,
  Vector3,
} from 'three'
import { KM_PER_AU } from '../../lib/map/mapUnits'
import { orbitPath } from '../../lib/map/orbits'
import { runFor } from '../../lib/map/nbody'
import { habitableZoneAU, temperatureToColor } from '../../lib/map/stars'
import { random, seedOf } from '../../lib/map/seeded'
import { STAR_PARTS } from '../../lib/map/spacePalette'
import { sceneScaleAt, sceneToSystem, systemToScene } from './spaceMath'
import { createStar } from './starMeshes'
import { createWorld } from './planetMeshes'

const RAD = Math.PI / 180
const SUN_RADIUS_KM = 695700
/** Radii (km) for a body that does not say. */
const DEFAULT_RADIUS_KM = { star: SUN_RADIUS_KM, planet: 6371, dwarf: 1188, moon: 1737, station: 0.2 }
/** The fewest pixels a body is drawn across, by kind, however far away. */
const MIN_PIXELS = { star: 12, planet: 7, dwarf: 4.5, moon: 4, station: 4.5 }
const ORBIT_SAMPLES = 160
const GRID_RADII_AU = [0.1, 0.3, 1, 3, 10, 30, 100, 300, 1000, 3000, 10000]
const MAX_LIGHTS = 4

const toVector = (point) => new Vector3(point[0], point[1], point[2])

function lineGeometry(points) {
  const array = new Float32Array(points.length * 3)
  points.forEach((point, index) => array.set(point, index * 3))
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(array, 3))
  return geometry
}

/** Rewrite a line's points in place (an orbit round a moving parent). */
function setLinePoints(line, points) {
  const attribute = line.geometry.getAttribute('position')
  points.forEach((point, index) => attribute.setXYZ(index, point[0], point[1], point[2]))
  attribute.needsUpdate = true
  line.geometry.computeBoundingSphere()
}

/**
 * Build the scene for a system map. `colors` are the look's: `{ orbit, grid,
 * habitable, belt, trail }`. Returns `{ root, plane, setDay, beforeRender, bodyAt,
 * hitList, dispose }`.
 */
export function createSystemScene(map, space, { colors }) {
  const { system } = map
  const display = system.display
  const byId = new Map(system.bodies.map((body) => [body.id, body]))
  const root = new Group()
  const plane = new Group()
  // Tilt about the scene's x axis, then turn by the heading about its up axis.
  plane.rotation.order = 'YXZ'
  plane.rotation.x = (system.plane?.tiltDeg || 0) * RAD
  plane.rotation.y = (system.plane?.headingDeg || 0) * RAD
  root.add(plane)
  const owned = []
  const own = (...items) => {
    owned.push(...items)
    return items[0]
  }

  root.add(new AmbientLight(0xffffff, 0.06))

  /* ---- the grid: rings of distance in the plane, faint ---- */
  const gridMaterial = own(new LineBasicMaterial({ color: new Color(colors.grid), transparent: true, opacity: 0.16, depthWrite: false }))
  const positions0 = space.positionsAt(0)
  let reachAU = 1
  for (const position of positions0.values()) reachAU = Math.max(reachAU, Math.hypot(position[0], position[1], position[2] || 0))
  for (const au of GRID_RADII_AU) {
    if (au > reachAU * 1.6) break
    const radius = systemToScene([au, 0, 0], display)[0]
    const points = []
    for (let index = 0; index < 128; index += 1) {
      const angle = (index / 128) * Math.PI * 2
      points.push([Math.cos(angle) * radius, 0, Math.sin(angle) * radius])
    }
    const ring = new LineLoop(own(lineGeometry(points)), gridMaterial)
    plane.add(ring)
  }

  /* ---- bodies ---- */
  const stars = system.bodies.filter((body) => body.kind === 'star')
  const bright = stars
    .filter((body) => (body.star?.luminositySun ?? 1) > 0)
    .sort((a, b) => (b.star?.luminositySun ?? 1) - (a.star?.luminositySun ?? 1))
    .slice(0, MAX_LIGHTS)
  const lights = new Map()
  for (const star of bright) {
    const color = star.color || temperatureToColor(star.star?.temperatureK ?? 5772)
    const light = new PointLight(new Color(color), 2.6, 0, 0)
    lights.set(star.id, light)
    plane.add(light)
  }

  const drawn = new Map()
  for (const body of system.bodies) {
    if (body.kind === 'belt' || body.kind === 'barycenter') continue
    const made = body.kind === 'star' ? createStar(body) : createWorld(body)
    made.core.userData.bodyId = body.id
    plane.add(made.object)
    drawn.set(body.id, { body, made, radiusKm: body.radiusKm || DEFAULT_RADIUS_KM[body.kind] || 3000, minPixels: MIN_PIXELS[body.kind] || 3 })
  }

  /* ---- orbits, trails, belts, habitable zones ---- */
  const orbitMaterial = own(new LineBasicMaterial({ color: new Color(colors.orbit), transparent: true, opacity: 0.42, depthWrite: false }))
  const moving = []
  const nbody = system.dynamics === 'nbody'
  const parentMoves = (body) => {
    if (!body.parent) return false
    const parent = byId.get(body.parent)
    return Boolean(parent?.orbit || parent?.parent || nbody)
  }
  if (nbody) {
    const run = runFor(system)
    const horizon = system.nbody?.horizonDays || 3650
    const trailMaterial = own(new LineBasicMaterial({ color: new Color(colors.trail), transparent: true, opacity: 0.32, depthWrite: false }))
    for (const id of run.ids) {
      const points = run.trail(id, 0, horizon).map((point) => systemToScene(point, display))
      plane.add(new Line(own(lineGeometry(points)), trailMaterial))
    }
  }
  for (const body of system.bodies) {
    if (!body.orbit || body.kind === 'belt' || nbody) continue
    const offsets = orbitPath(body, byId, ORBIT_SAMPLES)
    const at = (parentAt) => offsets.map((offset) => systemToScene([parentAt[0] + offset[0], parentAt[1] + offset[1], (parentAt[2] || 0) + offset[2]], display))
    const line = new Line(own(lineGeometry(at(positions0.get(body.parent) || [0, 0, 0]))), orbitMaterial)
    plane.add(line)
    if (parentMoves(body)) moving.push({ line, parent: body.parent, at })
  }

  const beltMaterial = own(new PointsMaterial({ color: new Color(colors.belt), size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.7, depthWrite: false }))
  const belts = []
  for (const body of system.bodies) {
    if (body.kind !== 'belt') continue
    const inner = Number(body.belt?.innerAU) || 2
    const outer = Number(body.belt?.outerAU) || inner * 1.3
    const rand = random(seedOf(body.id))
    const count = 1400
    const offsets = []
    for (let index = 0; index < count; index += 1) {
      const r = inner + (outer - inner) * Math.sqrt(rand())
      const angle = rand() * Math.PI * 2
      offsets.push([r * Math.cos(angle), r * Math.sin(angle), (rand() - 0.5) * 0.08 * r])
    }
    const place = (parentAt) => offsets.map((offset) => systemToScene([parentAt[0] + offset[0], parentAt[1] + offset[1], (parentAt[2] || 0) + offset[2]], display))
    const points = new Points(own(lineGeometry(place(positions0.get(body.parent) || [0, 0, 0]))), beltMaterial)
    plane.add(points)
    if (parentMoves(body)) belts.push({ line: points, parent: body.parent, at: place })
  }

  const habitableMaterial = own(new MeshBasicMaterial({ color: new Color(colors.habitable), transparent: true, opacity: 0.07, side: DoubleSide, depthWrite: false, blending: AdditiveBlending }))
  const zones = []
  for (const star of stars) {
    const zone = habitableZoneAU(star.star?.luminositySun)
    if (!zone) continue
    const inner = systemToScene([zone[0], 0, 0], display)[0]
    const outer = systemToScene([zone[1], 0, 0], display)[0]
    if (!(outer > inner)) continue
    const ring = new Mesh(own(new RingGeometry(inner, outer, 128, 1)), habitableMaterial)
    ring.rotation.x = -Math.PI / 2
    plane.add(ring)
    // Round a star that moves, the zone goes with it (exactly only at the centre).
    zones.push({ ring, star: star.id })
  }

  /* ---- an X-ray binary's stream: from the star that feeds to the one it feeds ---- */
  const streams = []
  for (const star of stars) {
    const target = star.star?.feeds
    if (!target || !drawn.has(target)) continue
    const geometry = own(lineGeometry(new Array(48).fill([0, 0, 0])))
    const material = own(new LineBasicMaterial({ color: new Color(STAR_PARTS.stream), transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false }))
    const line = new Line(geometry, material)
    plane.add(line)
    streams.push({ line, from: star.id, to: target })
  }

  /* ---- the day ---- */
  let current = positions0
  let day = 0
  const sceneOf = (id) => systemToScene(current.get(id) || [0, 0, 0], display)

  function setDay(nextDay) {
    day = nextDay
    current = space.positionsAt(day)
    for (const [id, entry] of drawn) {
      const at = sceneOf(id)
      entry.made.object.position.set(at[0], at[1], at[2])
      entry.made.update(day)
      entry.distanceAU = Math.hypot(...(current.get(id) || [0, 0, 0]))
    }
    for (const [id, light] of lights) light.position.copy(drawn.get(id).made.object.position)
    for (const entry of [...moving, ...belts]) setLinePoints(entry.line, entry.at(current.get(entry.parent) || [0, 0, 0]))
    for (const zone of zones) {
      const at = sceneOf(zone.star)
      zone.ring.position.set(at[0], at[1], at[2])
    }
    for (const stream of streams) {
      // A curve that winds into the companion: the gas falls in on a spiral.
      const a = toVector(sceneOf(stream.from))
      const b = toVector(sceneOf(stream.to))
      const points = []
      const span = a.distanceTo(b)
      const side = new Vector3().subVectors(b, a).cross(new Vector3(0, 1, 0)).normalize()
      for (let index = 0; index < 48; index += 1) {
        const t = index / 47
        const bend = Math.sin(t * Math.PI) * span * 0.18
        const point = a.clone().lerp(b, t).addScaledVector(side, bend)
        points.push([point.x, point.y, point.z])
      }
      setLinePoints(stream.line, points)
    }
  }

  /* ---- the camera: how big things are drawn ---- */
  const worldPosition = new Vector3()
  function beforeRender(camera, heightPx) {
    const perPixel = (distance) => (camera.isOrthographicCamera ? (camera.top - camera.bottom) / camera.zoom / heightPx : (2 * distance * Math.tan((camera.fov * RAD) / 2)) / heightPx)
    const planeScale = plane.matrixWorld.getMaxScaleOnAxis() || 1
    for (const entry of drawn.values()) {
      entry.made.object.getWorldPosition(worldPosition)
      const distance = Math.max(1e-9, camera.position.distanceTo(worldPosition))
      const trueRadius = (entry.radiusKm / KM_PER_AU) * sceneScaleAt(entry.distanceAU || 0, display)
      const least = (entry.minPixels / 2) * perPixel(distance) / planeScale
      entry.made.setRadius(Math.max(trueRadius, least))
      entry.drawnRadius = Math.max(trueRadius, least)
    }
  }

  setDay(0)

  return {
    root,
    plane,
    /** A system point (AU) in the plane group's space, and back (onto the plane). */
    toScene: (point) => systemToScene(point, display),
    fromScene: (local) => {
      const point = sceneToSystem(local, display)
      return [point[0], point[1]]
    },
    setDay,
    beforeRender,
    /** A body's scene position (in the plane group's space) on the current day. */
    bodyAt: (id) => drawn.get(id)?.made.object.position || null,
    /** What a click can hit: each body, where it is (world space) and how big it is drawn. */
    hitList: () => [...drawn.values()].map((entry) => ({ id: entry.body.id, object: entry.made.object, radius: entry.drawnRadius || 0 })),
    dispose() {
      for (const entry of drawn.values()) entry.made.dispose()
      for (const item of owned) item.dispose()
    },
  }
}
