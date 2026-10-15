/**
 * distanceOverTime.js — how far apart two things are across the story: two worlds
 * in their orbits, a traveller and home, a ship and the station it left.
 *
 * Anything that has a place on a day can be one end: a place (`pin`, which may ride
 * on a body), a `body` of a system, or a `traveler` on their journey. The distance
 * is the map's own (mapSpace.js), so it is great-circle on a world, straight in
 * space; light's travel time is alongside for the space kinds.
 *
 * Pure: the Travel tab charts it, the tests check it.
 */
import { pinLabel } from './mapModel'
import { resolvePin } from './mapSpace'
import { orbitPeriod } from './orbits'
import { buildSchedule, travelerPositionAt } from './timeline'

/** Kilometres light covers in a day. */
export const LIGHT_KM_PER_DAY = 299792.458 * 86400
/** How many points a chart is drawn from. */
export const DISTANCE_SAMPLES = 200
/** The longest span a chart covers: a century. */
const MAX_SPAN_DAYS = 36525

/** Everything on `map` that can be one end: `[{ value: 'kind:id', label, group }]`. */
export function distanceEnds(map, docName) {
  const ends = map.pins.map((pin) => ({ value: `pin:${pin.id}`, label: pinLabel(pin, docName), group: 'Places' }))
  if (map.mapKind === 'system') {
    for (const body of map.system.bodies) if (body.kind !== 'belt' && body.kind !== 'barycenter') ends.push({ value: `body:${body.id}`, label: body.name || 'Body', group: 'Bodies' })
  }
  map.travelers.forEach((traveler) => ends.push({ value: `traveler:${traveler.id}`, label: traveler.name || (traveler.doc && docName ? docName(traveler.doc) : 'Traveller'), group: 'Travellers' }))
  return ends
}

/** `day → point | null` for an end (`'kind:id'`), or null when it names nothing. */
function locator(map, space, end) {
  const [kind, id] = String(end || '').split(':')
  if (kind === 'pin') {
    const pin = map.pins.find((candidate) => candidate.id === id)
    return pin ? (day) => resolvePin(map, space, pin, day) : null
  }
  if (kind === 'body' && space.positionsAt) {
    return map.system?.bodies.some((body) => body.id === id) ? (day) => space.positionsAt(day).get(id) || null : null
  }
  if (kind === 'traveler') {
    const traveler = map.travelers.find((candidate) => candidate.id === id)
    if (!traveler) return null
    const schedule = buildSchedule(map, space, traveler)
    return (day) => travelerPositionAt(map, space, schedule, day)?.point || null
  }
  return null
}

/**
 * The days a chart of `a` and `b` should cover: the story's journeys (`extent`),
 * and for bodies twice the longer orbit, so the closest and farthest both show.
 */
export function distanceSpan(map, a, b, extent) {
  let from = extent.from
  let to = extent.to
  if (map.mapKind === 'system') {
    const bodies = new Map(map.system.bodies.map((body) => [body.id, body]))
    const orbitOf = (end) => {
      const [kind, id] = String(end || '').split(':')
      const bodyId = kind === 'body' ? id : kind === 'pin' ? map.pins.find((pin) => pin.id === id)?.body : null
      return bodyId ? orbitPeriod(bodies.get(bodyId), bodies) : null
    }
    const period = Math.max(orbitOf(a) || 0, orbitOf(b) || 0)
    if (period) to = Math.max(to, from + Math.min(period * 2, MAX_SPAN_DAYS))
  }
  return { from, to: Math.min(to, from + MAX_SPAN_DAYS) }
}

/**
 * The distance between `a` and `b` over `[from, to]`: `{ points: [[day, km]], closest,
 * farthest }` (each `{ day, km }`), or null when either end is missing. Days where
 * either is nowhere (a traveller not yet set out) are left out.
 */
export function distanceSeries(map, space, a, b, { from, to, samples = DISTANCE_SAMPLES }) {
  const locateA = locator(map, space, a)
  const locateB = locator(map, space, b)
  if (!locateA || !locateB || !(to > from)) return null
  const points = []
  for (let index = 0; index <= samples; index += 1) {
    const day = from + ((to - from) * index) / samples
    const pa = locateA(day)
    const pb = locateB(day)
    if (pa && pb) points.push([day, space.distanceKm(pa, pb)])
  }
  if (!points.length) return { points, closest: null, farthest: null }
  let closest = points[0]
  let farthest = points[0]
  for (const point of points) {
    if (point[1] < closest[1]) closest = point
    if (point[1] > farthest[1]) farthest = point
  }
  return { points, closest: { day: closest[0], km: closest[1] }, farthest: { day: farthest[0], km: farthest[1] } }
}

/** The distance on one `day`, or null. */
export function distanceOn(map, space, a, b, day) {
  const pa = locator(map, space, a)?.(day)
  const pb = locator(map, space, b)?.(day)
  return pa && pb ? space.distanceKm(pa, pb) : null
}
