/**
 * mapSpace.js — what a stored `[x, y]` means, and how far apart two of them are.
 *
 * One interface over the three kinds of space a map can be:
 *
 *   plane    (blank, image)  pixels of the sheet or picture; distance is Euclidean
 *                            times the map's calibrated km per unit
 *   lonlat   (earth)         degrees; distance along great circles
 *   orbital  (system)        AU, where a pin on a body moves with it, so where a
 *                            thing is — and how far — depends on the day
 *
 * Travel times, the timeline, the ruler and the scale bar all measure through this
 * and never ask which kind of map they are on. Drawing is separate (mapProjection.js):
 * where a point lands on screen is not the same question as how far away it is.
 *
 * Mirrored in `inkblot_core::map::space` for the plane and lonlat spaces.
 */
import { pointInRegion, regionArea, catmullRomSample } from './mapGeometry'
import { densifyGreatCircle, haversineKm, interpolateGreatCircle, sphericalRingAreaKm2 } from './geodesy'
import { KM_PER_AU } from './mapUnits'
import { systemPositionsAt } from './orbits'

/** Samples per segment when a smoothed route is measured — enough to be within 0.1%. */
export const ROUTE_SMOOTH_SAMPLES = 12
/** How finely an Earth route is cut when it is measured and checked for terrain. */
export const GREAT_CIRCLE_STEP_KM = 50

const planeSpace = (map) => {
  const kmPerUnit = map?.scale?.kmPerUnit > 0 ? map.scale.kmPerUnit : 1
  return {
    kind: 'plane',
    kmPerUnit,
    distanceKm: (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]) * kmPerUnit,
    interpolate: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    densify: (a, b) => [[a[0], a[1]], [b[0], b[1]]],
    areaKm2: (rings) => regionArea(rings) * kmPerUnit * kmPerUnit,
    contains: (rings, point) => pointInRegion(point, rings),
  }
}

const lonlatSpace = () => ({
  kind: 'lonlat',
  kmPerUnit: null,
  distanceKm: haversineKm,
  interpolate: interpolateGreatCircle,
  densify: (a, b) => densifyGreatCircle(a, b, GREAT_CIRCLE_STEP_KM),
  areaKm2: (rings) => {
    if (!rings.length) return 0
    let area = sphericalRingAreaKm2(rings[0])
    for (let index = 1; index < rings.length; index += 1) area -= sphericalRingAreaKm2(rings[index])
    return Math.max(0, area)
  },
  // Terrain on a globe is tested in lon/lat: fine at story scale, wrong only for
  // regions straddling the antimeridian, which the region tool does not draw.
  contains: (rings, point) => pointInRegion(point, rings),
})

const orbitalSpace = (map) => {
  const cache = new Map()
  const positionsAt = (day) => {
    const key = String(day)
    if (!cache.has(key)) {
      if (cache.size > 64) cache.clear()
      cache.set(key, systemPositionsAt(map?.system, day))
    }
    return cache.get(key)
  }
  return {
    kind: 'orbital',
    kmPerUnit: KM_PER_AU,
    distanceKm: (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]) * KM_PER_AU,
    interpolate: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    densify: (a, b) => [[a[0], a[1]], [b[0], b[1]]],
    areaKm2: (rings) => regionArea(rings) * KM_PER_AU * KM_PER_AU,
    contains: (rings, point) => pointInRegion(point, rings),
    positionsAt,
  }
}

/** The space a map's coordinates live in. */
export function createSpace(map) {
  if (map?.mapKind === 'earth') return lonlatSpace(map)
  if (map?.mapKind === 'system') return orbitalSpace(map)
  return planeSpace(map)
}

/** Where a pin is on `day`: its fixed point, or its body's position. */
export function resolvePin(map, space, pin, day = 0) {
  if (!pin) return null
  if (pin.body && space.kind === 'orbital') {
    const position = space.positionsAt(day).get(pin.body)
    if (position) return position
  }
  return pin.at ? [pin.at[0], pin.at[1]] : null
}

/** A route's stops as coordinates on `day`, with smoothing applied where asked. */
export function routeCoords(map, space, route, day = 0) {
  if (!route) return []
  const pins = new Map((map.pins || []).map((pin) => [pin.id, pin]))
  const stops = []
  for (const node of route.nodes || []) {
    const at = node.pin ? resolvePin(map, space, pins.get(node.pin), day) : node.at
    if (at) stops.push(at)
  }
  if (route.smooth === 'catmullRom' && space.kind === 'plane') return catmullRomSample(stops, ROUTE_SMOOTH_SAMPLES)
  return stops
}

/**
 * A line through `points` as it is travelled: every segment densified (a great
 * circle on the Earth), with the running distance at each point in km.
 */
export function measuredLine(space, points) {
  if (!points.length) return { points: [], km: [0], totalKm: 0 }
  const dense = [points[0]]
  for (let index = 1; index < points.length; index += 1) {
    dense.push(...space.densify(points[index - 1], points[index]).slice(1))
  }
  const km = [0]
  for (let index = 1; index < dense.length; index += 1) {
    km.push(km[index - 1] + space.distanceKm(dense[index - 1], dense[index]))
  }
  return { points: dense, km, totalKm: km[km.length - 1] }
}

/** Total length of a polyline in km. */
export const lineKm = (space, points) => measuredLine(space, points).totalKm

/** The point `targetKm` along a measured line, interpolated in the space. */
export function pointAtKm(space, line, targetKm) {
  const { points, km } = line
  if (!points.length) return null
  if (points.length === 1 || targetKm <= 0) return { point: points[0], index: 0 }
  const total = km[km.length - 1]
  if (targetKm >= total) return { point: points[points.length - 1], index: points.length - 2 }
  let index = 0
  while (index < km.length - 2 && km[index + 1] < targetKm) index += 1
  const span = km[index + 1] - km[index]
  const t = span > 0 ? (targetKm - km[index]) / span : 0
  return { point: space.interpolate(points[index], points[index + 1], t), index }
}

/** Plane-only: kilometres per unit that makes the two points `distanceKm` apart. */
export function calibrationKmPerUnit(a, b, distanceKm) {
  const units = Math.hypot(b[0] - a[0], b[1] - a[1])
  return units > 0 && distanceKm > 0 ? distanceKm / units : null
}

