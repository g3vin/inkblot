/**
 * orbits.js — where the bodies of a star system are on a given story day.
 *
 * Two-body Kepler orbits in the plane: each body orbits its parent on an ellipse
 * (semi-major axis `aAU`, eccentricity `e`, periapsis angle, mean anomaly at day 0),
 * and its position is its parent's plus its own offset, so moons follow planets and
 * planets follow stars. Positions are AU in ordinary maths axes — x right, y UP, so
 * a prograde orbit runs counter-clockwise; the renderer flips y for the screen.
 *
 * The period comes from Kepler's third law, P = √(a³ / (M + m)) years with masses in
 * suns, unless an orbit fixes `periodDays` itself (a binary pair does, so both stars
 * share one period).
 *
 * Mirrored in `inkblot_core::map::orbits`. The Kepler solve takes a FIXED number of
 * Newton steps rather than iterating to a tolerance, so the two implementations stop
 * in the same place.
 */

export const DAYS_PER_YEAR = 365.256363
export const SUN_MASS_EARTHS = 332946.0487
/** Default masses, in suns, for a body that does not say. */
const DEFAULT_MASS = { star: 1, planet: 3.003e-6, dwarf: 2e-9, moon: 3.69e-8, belt: 0, station: 0, barycenter: 0 }
const KEPLER_STEPS = 16
const TAU = Math.PI * 2
const RAD = Math.PI / 180

const bodyMap = (system) => new Map((system?.bodies || []).map((body) => [body.id, body]))

/** A body's mass in suns. A barycenter weighs what orbits it directly. */
export function bodyMass(body, bodies = new Map(), seen = new Set()) {
  if (!body) return 0
  if (Number.isFinite(body.massSun) && body.massSun > 0) return body.massSun
  if (body.kind === 'barycenter') {
    if (seen.has(body.id)) return 0
    seen.add(body.id)
    let total = 0
    for (const other of bodies.values()) {
      if (other.parent === body.id && other.kind === 'star') total += bodyMass(other, bodies, seen)
    }
    return total
  }
  return DEFAULT_MASS[body.kind] ?? 0
}

/** Orbital period in days of `aAU` around a central mass (suns). */
export const periodDays = (aAU, centralMassSun) =>
  DAYS_PER_YEAR * Math.sqrt((aAU * aAU * aAU) / Math.max(centralMassSun, 1e-12))

/** The period a body's orbit actually uses. */
export function orbitPeriod(body, bodies) {
  const orbit = body?.orbit
  if (!orbit) return null
  if (Number.isFinite(orbit.periodDays) && orbit.periodDays > 0) return orbit.periodDays
  const parent = bodies.get(body.parent)
  return periodDays(orbit.aAU, bodyMass(parent, bodies) + bodyMass(body, bodies))
}

/** Solve Kepler's equation M = E − e·sin E for E (radians), fixed Newton steps. */
export function solveKepler(meanAnomaly, e) {
  let E = e < 0.8 ? meanAnomaly : Math.PI
  for (let step = 0; step < KEPLER_STEPS; step += 1) {
    E -= (E - e * Math.sin(E) - meanAnomaly) / (1 - e * Math.cos(E))
  }
  return E
}

/** A body's offset from its parent on `day`, AU. */
export function orbitOffset(body, bodies, day) {
  const orbit = body?.orbit
  if (!orbit) return [0, 0]
  const period = orbitPeriod(body, bodies)
  const direction = orbit.retrograde ? -1 : 1
  const mean = orbit.meanAnomalyDeg * RAD + direction * (TAU * day) / period
  const e = orbit.e
  const E = solveKepler(((mean % TAU) + TAU) % TAU, e)
  const x = orbit.aAU * (Math.cos(E) - e)
  const y = orbit.aAU * Math.sqrt(1 - e * e) * Math.sin(E) * direction
  const w = orbit.periapsisDeg * RAD
  return [x * Math.cos(w) - y * Math.sin(w), x * Math.sin(w) + y * Math.cos(w)]
}

/** Every body's absolute position on `day`: id → [x, y] AU. */
export function systemPositionsAt(system, day) {
  const bodies = bodyMap(system)
  const positions = new Map()
  const resolve = (id, depth = 0) => {
    if (positions.has(id)) return positions.get(id)
    const body = bodies.get(id)
    // A cycle in the parent chain (only a hand-edited file can make one) ends at the origin.
    if (!body || depth > bodies.size) return [0, 0]
    const base = body.parent ? resolve(body.parent, depth + 1) : [0, 0]
    const offset = orbitOffset(body, bodies, day)
    const position = [base[0] + offset[0], base[1] + offset[1]]
    positions.set(id, position)
    return position
  }
  for (const id of bodies.keys()) resolve(id)
  return positions
}

export const bodyPositionAt = (system, id, day) => systemPositionsAt(system, day).get(id) || null

/** A body's orbit as `samples` points around its parent (offsets, AU), closed. */
export function orbitPath(body, bodies, samples = 128) {
  const orbit = body?.orbit
  if (!orbit) return []
  const out = []
  const w = orbit.periapsisDeg * RAD
  const b = orbit.aAU * Math.sqrt(1 - orbit.e * orbit.e)
  for (let index = 0; index <= samples; index += 1) {
    const E = (TAU * index) / samples
    const x = orbit.aAU * (Math.cos(E) - orbit.e)
    const y = b * Math.sin(E)
    out.push([x * Math.cos(w) - y * Math.sin(w), x * Math.sin(w) + y * Math.cos(w)])
  }
  return out
}

/**
 * When a traveller leaving A on `departDay` at `kmh` reaches B, when both move.
 *
 * Fixed-point iteration on the arrival time: aim at where B will be when you get
 * there. It converges whenever the traveller is much faster than the bodies (true of
 * any fraction of light speed); if it does not settle within `maxSteps`, the answer is
 * the straight distance at departure, flagged `approximate`.
 */
export function interceptDays(positionOf, fromId, toId, departDay, kmh, kmPerAU, maxSteps = 12) {
  const start = positionOf(fromId, departDay)
  const distanceAt = (day) => {
    const target = positionOf(toId, day)
    return Math.hypot(target[0] - start[0], target[1] - start[1]) * kmPerAU
  }
  const perDay = kmh * 24
  let arrival = departDay + distanceAt(departDay) / perDay
  for (let step = 0; step < maxSteps; step += 1) {
    const next = departDay + distanceAt(arrival) / perDay
    if (Math.abs(next - arrival) < 1 / 1440) return { days: next - departDay, approximate: false, arrival: next }
    arrival = next
  }
  const straight = distanceAt(departDay) / perDay
  return { days: straight, approximate: true, arrival: departDay + straight }
}
