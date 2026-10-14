/**
 * orbits.js — where the bodies of a star system are on a given story day.
 *
 * Two-body Kepler orbits: each body orbits its parent on an ellipse (semi-major axis
 * `aAU`, eccentricity `e`, periapsis angle, mean anomaly at day 0), tipped out of the
 * system's plane by `inclinationDeg` about the line where it crosses that plane
 * (`ascendingNodeDeg`). Its position is its parent's plus its own offset, so moons
 * follow planets and planets follow stars. Positions are `[x, y, z]` AU in ordinary
 * maths axes — x right, y UP, z out of the plane towards the viewer above it, so a
 * prograde orbit runs counter-clockwise seen from above; the renderer flips y for
 * the screen. An orbit with no inclination stays at z = 0, exactly where the flat
 * orbits of earlier versions put it.
 *
 * The period comes from Kepler's third law, P = √(a³ / (M + m)) years with masses in
 * suns, unless an orbit fixes `periodDays` itself (a binary pair does, so both stars
 * share one period).
 *
 * The Kepler solve takes a FIXED number of Newton steps rather than iterating to a
 * tolerance, so it stops in the same place every time on every machine.
 *
 * Systems whose bodies pull on each other (three stars, say) have no ellipses to
 * follow; nbody.js integrates them, and `systemPositionsAt` hands their positions
 * out the same way.
 */

export const DAYS_PER_YEAR = 365.256363
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

/**
 * A point in an orbit's own plane — x towards periapsis before it is turned — placed
 * in the system: turned by the periapsis angle, tipped by the inclination about the
 * line of nodes, then turned to the ascending node.
 */
export function orbitToSystem(orbit, x, y) {
  const w = (orbit.periapsisDeg || 0) * RAD
  const xw = x * Math.cos(w) - y * Math.sin(w)
  const yw = x * Math.sin(w) + y * Math.cos(w)
  const i = (orbit.inclinationDeg || 0) * RAD
  const node = (orbit.ascendingNodeDeg || 0) * RAD
  if (!i && !node) return [xw, yw, 0]
  const yi = yw * Math.cos(i)
  const zi = yw * Math.sin(i)
  return [xw * Math.cos(node) - yi * Math.sin(node), xw * Math.sin(node) + yi * Math.cos(node), zi]
}

/** A body's offset from its parent on `day`, `[x, y, z]` AU. */
export function orbitOffset(body, bodies, day) {
  const orbit = body?.orbit
  if (!orbit) return [0, 0, 0]
  const period = orbitPeriod(body, bodies)
  const direction = orbit.retrograde ? -1 : 1
  const mean = orbit.meanAnomalyDeg * RAD + direction * (TAU * day) / period
  const e = orbit.e
  const E = solveKepler(((mean % TAU) + TAU) % TAU, e)
  const x = orbit.aAU * (Math.cos(E) - e)
  const y = orbit.aAU * Math.sqrt(1 - e * e) * Math.sin(E) * direction
  return orbitToSystem(orbit, x, y)
}

/** Every body's absolute position on `day`: id → [x, y, z] AU. */
export function systemPositionsAt(system, day) {
  if (system?.dynamics === 'nbody' && nbodyPositions) return nbodyPositions(system, day)
  return keplerPositionsAt(system, day)
}

/**
 * Where an N-body system's bodies are: installed by nbody.js, which this module
 * cannot import without a cycle (it starts from these orbits).
 */
let nbodyPositions = null
export const installNbodyPositions = (fn) => {
  nbodyPositions = fn
}

/** Every body's position on `day` by nested Kepler orbits. */
export function keplerPositionsAt(system, day) {
  const bodies = bodyMap(system)
  const positions = new Map()
  const resolve = (id, depth = 0) => {
    if (positions.has(id)) return positions.get(id)
    const body = bodies.get(id)
    // A cycle in the parent chain (only a hand-edited file can make one) ends at the origin.
    if (!body || depth > bodies.size) return [0, 0, 0]
    const base = body.parent ? resolve(body.parent, depth + 1) : [0, 0, 0]
    const offset = orbitOffset(body, bodies, day)
    const position = [base[0] + offset[0], base[1] + offset[1], (base[2] || 0) + offset[2]]
    positions.set(id, position)
    return position
  }
  for (const id of bodies.keys()) resolve(id)
  return positions
}

/** A body's orbit as `samples` points around its parent (`[x, y, z]` offsets, AU), closed. */
export function orbitPath(body, bodies, samples = 128) {
  const orbit = body?.orbit
  if (!orbit) return []
  const out = []
  const b = orbit.aAU * Math.sqrt(1 - orbit.e * orbit.e)
  for (let index = 0; index <= samples; index += 1) {
    const E = (TAU * index) / samples
    out.push(orbitToSystem(orbit, orbit.aAU * (Math.cos(E) - orbit.e), b * Math.sin(E)))
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
    return Math.hypot(target[0] - start[0], target[1] - start[1], (target[2] || 0) - (start[2] || 0)) * kmPerAU
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
