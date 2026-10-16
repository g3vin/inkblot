/**
 * nbody.js — star systems whose bodies all pull on each other.
 *
 * A Kepler system (orbits.js) is a tree of ellipses. Three stars have no ellipses to
 * follow, so a system with `dynamics: 'nbody'` is integrated instead: every body
 * starts where its `state` says (`pos` AU, `vel` AU a day) — or, without one, where
 * its orbit puts it on day 0 — and Newton's gravity moves them all.
 *
 * Units: AU, days and solar masses, so G is the Gaussian constant squared.
 *
 * The integrator is Yoshida's fourth-order symplectic scheme with a fixed step
 * (`nbody.stepDays`), split into more substeps on a close approach by a rule that
 * reads only the state, and Plummer softening (`nbody.softeningAU`) so a collision
 * does not blow up. Nothing in it depends on the clock, the machine or the order
 * days are asked for: the same system gives the same positions, bit for bit.
 *
 * It integrates outward from day 0 (both ways) on demand, keeping a full state
 * every CHECKPOINT_STEPS steps. Asking for a day integrates from the checkpoint
 * before it — at most a few hundred steps — so scrubbing a timeline is instant, and
 * the trail of each body (for drawing) is kept at the checkpoints.
 */
import { bodyMass, installNbodyPositions, keplerPositionsAt, orbitPeriod } from './orbits'

/** G in AU³ / (M☉ · day²): the Gaussian gravitational constant, squared. */
export const G = 0.01720209895 ** 2
/** One AU a day, in kilometres a second. */
export const KMS_PER_AU_DAY = 149597870.7 / 86400
const CHECKPOINT_STEPS = 16
/** Yoshida's coefficients for a fourth-order symplectic step. */
const W1 = 1 / (2 - 2 ** (1 / 3))
const W0 = 1 - 2 * W1
const DRIFT = [W1 / 2, (W0 + W1) / 2, (W0 + W1) / 2, W1 / 2]
const KICK = [W1, W0, W1]
/** The most a step is ever split. */
const MAX_SUBSTEPS = 4096
/** A step is split until it is this fraction of the closest pair's free-fall time. */
const ETA = 0.05

/* ---------------- the starting state ---------------- */

/** Which bodies take part: everything with a place, but not belts or barycentres. */
const takesPart = (body) => body.kind !== 'belt' && body.kind !== 'barycenter'

/**
 * Where a Kepler body is and how fast it moves on day 0, as state vectors: the
 * position from the orbit, the velocity by differentiating it (a centred
 * difference over a tiny fraction of the period, which is exact to ~1e-12).
 */
export function stateFromOrbits(system) {
  const bodies = new Map((system?.bodies || []).map((body) => [body.id, body]))
  const out = new Map()
  const at = keplerPositionsAt(system, 0)
  let h = Infinity
  for (const body of bodies.values()) {
    const period = orbitPeriod(body, bodies)
    if (period) h = Math.min(h, period * 1e-6)
  }
  if (!Number.isFinite(h)) h = 1e-3
  const before = keplerPositionsAt(system, -h)
  const after = keplerPositionsAt(system, h)
  for (const id of bodies.keys()) {
    const p = at.get(id) || [0, 0, 0]
    const a = before.get(id) || p
    const b = after.get(id) || p
    out.set(id, { pos: [p[0], p[1], p[2] || 0], vel: [(b[0] - a[0]) / (2 * h), (b[1] - a[1]) / (2 * h), ((b[2] || 0) - (a[2] || 0)) / (2 * h)] })
  }
  return out
}

/** The bodies an integration runs on, with their masses and day-0 states. */
export function initialBodies(system) {
  const bodies = new Map((system?.bodies || []).map((body) => [body.id, body]))
  const fromOrbits = stateFromOrbits(system)
  const list = []
  for (const body of bodies.values()) {
    if (!takesPart(body)) continue
    const state = body.state || fromOrbits.get(body.id)
    list.push({ id: body.id, mass: bodyMass(body, bodies), pos: state.pos.slice(0, 3), vel: state.vel.slice(0, 3) })
  }
  // The system as a whole stands still: its centre of mass keeps its place.
  const total = list.reduce((sum, body) => sum + body.mass, 0)
  if (total > 0) {
    const drift = [0, 1, 2].map((axis) => list.reduce((sum, body) => sum + body.mass * (body.vel[axis] || 0), 0) / total)
    for (const body of list) for (let axis = 0; axis < 3; axis += 1) body.vel[axis] = (body.vel[axis] || 0) - drift[axis]
  }
  return list
}

/* ---------------- one step ---------------- */

/** Flat arrays for speed: x,y,z per body. */
function pack(list) {
  const n = list.length
  const pos = new Float64Array(n * 3)
  const vel = new Float64Array(n * 3)
  const mass = new Float64Array(n)
  list.forEach((body, index) => {
    mass[index] = body.mass
    for (let axis = 0; axis < 3; axis += 1) {
      pos[index * 3 + axis] = body.pos[axis] || 0
      vel[index * 3 + axis] = body.vel[axis] || 0
    }
  })
  return { n, pos, vel, mass }
}

function accelerations(state, eps2, acc) {
  const { n, pos, mass } = state
  acc.fill(0)
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const dx = pos[j * 3] - pos[i * 3]
      const dy = pos[j * 3 + 1] - pos[i * 3 + 1]
      const dz = pos[j * 3 + 2] - pos[i * 3 + 2]
      const r2 = dx * dx + dy * dy + dz * dz + eps2
      const inv = 1 / (r2 * Math.sqrt(r2))
      const fi = G * mass[j] * inv
      const fj = G * mass[i] * inv
      acc[i * 3] += dx * fi
      acc[i * 3 + 1] += dy * fi
      acc[i * 3 + 2] += dz * fi
      acc[j * 3] -= dx * fj
      acc[j * 3 + 1] -= dy * fj
      acc[j * 3 + 2] -= dz * fj
    }
  }
}

/** How many pieces a step of `dt` needs, from the closest pair now. */
function substepsFor(state, dt, eps2) {
  const { n, pos, vel, mass } = state
  let shortest = Infinity
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const m = mass[i] + mass[j]
      if (!(m > 0)) continue
      const dx = pos[j * 3] - pos[i * 3]
      const dy = pos[j * 3 + 1] - pos[i * 3 + 1]
      const dz = pos[j * 3 + 2] - pos[i * 3 + 2]
      const r2 = dx * dx + dy * dy + dz * dz + eps2
      const r = Math.sqrt(r2)
      const dvx = vel[j * 3] - vel[i * 3]
      const dvy = vel[j * 3 + 1] - vel[i * 3 + 1]
      const dvz = vel[j * 3 + 2] - vel[i * 3 + 2]
      const v = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz)
      // The shorter of the free-fall time and the crossing time.
      const time = Math.min(Math.sqrt((r2 * r) / (G * m)), v > 0 ? r / v : Infinity)
      if (time < shortest) shortest = time
    }
  }
  if (!Number.isFinite(shortest)) return 1
  return Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(Math.abs(dt) / (ETA * shortest))))
}

function yoshida(state, dt, eps2, acc) {
  const { n, pos, vel } = state
  const size = n * 3
  for (let stage = 0; stage < 4; stage += 1) {
    const d = DRIFT[stage] * dt
    for (let k = 0; k < size; k += 1) pos[k] += vel[k] * d
    if (stage === 3) break
    accelerations(state, eps2, acc)
    const c = KICK[stage] * dt
    for (let k = 0; k < size; k += 1) vel[k] += acc[k] * c
  }
}

/** Advance `state` by `dt` days (negative runs it backwards). */
export function step(state, dt, eps2, acc = new Float64Array(state.n * 3)) {
  const pieces = substepsFor(state, dt, eps2)
  const h = dt / pieces
  for (let piece = 0; piece < pieces; piece += 1) yoshida(state, h, eps2, acc)
}

const copy = (state) => ({ n: state.n, mass: state.mass, pos: state.pos.slice(), vel: state.vel.slice() })

/** Total energy (kinetic + potential), for checking an integration holds together. */
export function energy(state, eps2 = 0) {
  const { n, pos, vel, mass } = state
  let kinetic = 0
  let potential = 0
  for (let i = 0; i < n; i += 1) {
    kinetic += 0.5 * mass[i] * (vel[i * 3] ** 2 + vel[i * 3 + 1] ** 2 + vel[i * 3 + 2] ** 2)
    for (let j = i + 1; j < n; j += 1) {
      const r = Math.sqrt((pos[j * 3] - pos[i * 3]) ** 2 + (pos[j * 3 + 1] - pos[i * 3 + 1]) ** 2 + (pos[j * 3 + 2] - pos[i * 3 + 2]) ** 2 + eps2)
      potential -= (G * mass[i] * mass[j]) / r
    }
  }
  return kinetic + potential
}

/* ---------------- a run: checkpoints both ways from day 0 ---------------- */

/**
 * A run of `system`: `stateAt(day)` and `positionsAt(day)`, integrated lazily and
 * cached at checkpoints, and `trail(id, from, to)` for drawing.
 */
export function createRun(system) {
  const list = initialBodies(system)
  const ids = list.map((body) => body.id)
  const settings = system?.nbody || {}
  const dt = settings.stepDays > 0 ? settings.stepDays : 0.25
  const softening = settings.softeningAU > 0 ? settings.softeningAU : 0.001
  const eps2 = softening * softening
  const span = dt * CHECKPOINT_STEPS
  const acc = new Float64Array(list.length * 3)
  // checkpoints[k] is the state on day k·span, for k ≥ 0 (forward) and k < 0 (back).
  const forward = [pack(list)]
  const backward = [forward[0]]

  const checkpoint = (k) => {
    const chain = k >= 0 ? forward : backward
    const target = Math.abs(k)
    const sign = k >= 0 ? 1 : -1
    while (chain.length <= target) {
      const next = copy(chain[chain.length - 1])
      for (let index = 0; index < CHECKPOINT_STEPS; index += 1) step(next, sign * dt, eps2, acc)
      chain.push(next)
    }
    return chain[target]
  }

  const stateAt = (day) => {
    const d = Number.isFinite(day) ? day : 0
    const k = Math.trunc(d / span)
    let state = copy(checkpoint(k))
    let remaining = d - k * span
    const sign = remaining < 0 ? -1 : 1
    while (Math.abs(remaining) >= dt) {
      step(state, sign * dt, eps2, acc)
      remaining -= sign * dt
    }
    if (Math.abs(remaining) > 1e-12) step(state, remaining, eps2, acc)
    return state
  }

  const positionsAt = (day) => {
    const state = stateAt(day)
    const out = new Map()
    ids.forEach((id, index) => out.set(id, [state.pos[index * 3], state.pos[index * 3 + 1], state.pos[index * 3 + 2]]))
    return out
  }

  /** A body's path from `from` to `to` (days), one point per checkpoint. */
  const trail = (id, from, to) => {
    const index = ids.indexOf(id)
    if (index < 0) return []
    const first = Math.floor(from / span)
    const last = Math.ceil(to / span)
    const out = []
    for (let k = first; k <= last; k += 1) {
      const state = checkpoint(k)
      out.push([state.pos[index * 3], state.pos[index * 3 + 1], state.pos[index * 3 + 2]])
    }
    return out
  }

  return { ids, dt, span, eps2, stateAt, positionsAt, trail, checkpoint }
}

/* ---------------- the cache, and orbits.js's hook ---------------- */

const runs = new Map()
const MAX_RUNS = 8

/** The key a run is cached under: everything that changes where the bodies go. */
const runKey = (system) =>
  JSON.stringify([
    system.nbody,
    (system.bodies || []).map((body) => [body.id, body.kind, body.parent, body.massSun, body.state, body.orbit]),
  ])

export function runFor(system) {
  const key = runKey(system)
  let run = runs.get(key)
  if (run) {
    runs.delete(key)
    runs.set(key, run)
    return run
  }
  run = createRun(system)
  runs.set(key, run)
  if (runs.size > MAX_RUNS) runs.delete(runs.keys().next().value)
  return run
}

/** Positions on `day` for an N-body system; belts and barycentres sit at the centre of mass. */
export function nbodyPositionsAt(system, day) {
  const run = runFor(system)
  const positions = run.positionsAt(day)
  const bodies = new Map((system.bodies || []).map((body) => [body.id, body]))
  let mx = 0
  let my = 0
  let mz = 0
  let total = 0
  for (const [id, position] of positions) {
    const mass = bodyMass(bodies.get(id), bodies)
    mx += position[0] * mass
    my += position[1] * mass
    mz += position[2] * mass
    total += mass
  }
  const centre = total > 0 ? [mx / total, my / total, mz / total] : [0, 0, 0]
  for (const body of bodies.values()) if (!positions.has(body.id)) positions.set(body.id, centre.slice())
  return positions
}

installNbodyPositions(nbodyPositionsAt)

/* ---------------- stability ---------------- */

/**
 * What happens to an N-body system over `horizonDays`: the first body to leave for
 * good (unbound from the rest and far away), and the closest pass.
 *
 * Returns `{ stable, ejected: {id, day} | null, closest: {ids, day, au} | null }`.
 */
export function stabilityOf(system, horizonDays = system?.nbody?.horizonDays || 3650) {
  const run = runFor(system)
  const n = run.ids.length
  if (n < 2) return { stable: true, ejected: null, closest: null }
  const start = run.checkpoint(0)
  const size = systemSize(start)
  let closest = null
  const steps = Math.ceil(horizonDays / run.span)
  for (let k = 1; k <= steps; k += 1) {
    const state = run.checkpoint(k)
    const day = k * run.span
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        if (!(state.mass[i] > 0 && state.mass[j] > 0)) continue
        const au = distance(state, i, j)
        if (!closest || au < closest.au) closest = { ids: [run.ids[i], run.ids[j]], day, au }
      }
    }
    const gone = escaping(state, size)
    if (gone >= 0) return { stable: false, ejected: { id: run.ids[gone], day }, closest }
  }
  return { stable: true, ejected: null, closest }
}

const distance = (state, i, j) =>
  Math.hypot(state.pos[j * 3] - state.pos[i * 3], state.pos[j * 3 + 1] - state.pos[i * 3 + 1], state.pos[j * 3 + 2] - state.pos[i * 3 + 2])

/** The largest distance from the centre of mass, AU. */
function systemSize(state) {
  const centre = centreOf(state, -1)
  let size = 0
  for (let i = 0; i < state.n; i += 1) {
    size = Math.max(size, Math.hypot(state.pos[i * 3] - centre.pos[0], state.pos[i * 3 + 1] - centre.pos[1], state.pos[i * 3 + 2] - centre.pos[2]))
  }
  return size
}

/** The centre of mass (and its velocity) of every body but `skip`. */
function centreOf(state, skip) {
  const pos = [0, 0, 0]
  const vel = [0, 0, 0]
  let mass = 0
  for (let i = 0; i < state.n; i += 1) {
    if (i === skip) continue
    const m = state.mass[i]
    mass += m
    for (let axis = 0; axis < 3; axis += 1) {
      pos[axis] += state.pos[i * 3 + axis] * m
      vel[axis] += state.vel[i * 3 + axis] * m
    }
  }
  if (mass > 0) for (let axis = 0; axis < 3; axis += 1) {
    pos[axis] /= mass
    vel[axis] /= mass
  }
  return { pos, vel, mass }
}

/** The index of a body that has left — unbound from the rest, beyond 10× the start size — or −1. */
function escaping(state, size) {
  for (let i = 0; i < state.n; i += 1) {
    const rest = centreOf(state, i)
    if (!(rest.mass > 0)) continue
    const dx = [0, 1, 2].map((axis) => state.pos[i * 3 + axis] - rest.pos[axis])
    const dv = [0, 1, 2].map((axis) => state.vel[i * 3 + axis] - rest.vel[axis])
    const r = Math.hypot(...dx)
    if (r < size * 10) continue
    const specific = 0.5 * (dv[0] ** 2 + dv[1] ** 2 + dv[2] ** 2) - (G * (rest.mass + state.mass[i])) / r
    // Moving away, too fast to come back.
    if (specific > 0 && dx[0] * dv[0] + dx[1] * dv[1] + dx[2] * dv[2] > 0) return i
  }
  return -1
}

/**
 * Turn a Kepler system into an N-body one: every body's state on day 0, so the
 * system starts exactly where it was and then moves under everyone's gravity.
 */
export function toNbody(system) {
  const states = stateFromOrbits(system)
  return {
    ...system,
    dynamics: 'nbody',
    bodies: system.bodies.map((body) => (takesPart(body) && states.has(body.id) ? { ...body, state: states.get(body.id) } : body)),
  }
}

/* ---------------- close passes, and holding a system together ---------------- */

const KM_PER_AU_HERE = 149597870.7
/** Passes closer than this (AU) are worth telling the writer about. */
export const CLOSE_PASS_AU = 0.05

/**
 * Every close pass over the story: `[{ ids: [a, b], day, au, touching }]`, one per
 * approach (the closest moment of each dip below CLOSE_PASS_AU), earliest first, at
 * most `limit`. `touching` when they come within their summed radii: a collision,
 * or a star swallowing a planet.
 */
export function closePasses(system, { horizonDays = system?.nbody?.horizonDays || 3650, limit = 8 } = {}) {
  const run = runFor(system)
  const n = run.ids.length
  if (n < 2) return []
  const byId = new Map((system.bodies || []).map((body) => [body.id, body]))
  const radiusAU = (id) => (byId.get(id)?.radiusKm || 0) / KM_PER_AU_HERE
  const steps = Math.ceil(horizonDays / run.span)
  const dips = new Map()
  const passes = []
  for (let k = 0; k <= steps; k += 1) {
    const state = run.checkpoint(k)
    const day = k * run.span
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const key = `${i}|${j}`
        const au = distance(state, i, j)
        const dip = dips.get(key)
        if (au < CLOSE_PASS_AU) {
          if (!dip || au < dip.au) dips.set(key, { ids: [run.ids[i], run.ids[j]], day, au })
        } else if (dip) {
          passes.push(dip)
          dips.delete(key)
        }
      }
    }
  }
  passes.push(...dips.values())
  return passes
    .map((pass) => ({ ...pass, touching: pass.au <= radiusAU(pass.ids[0]) + radiusAU(pass.ids[1]) }))
    .sort((a, b) => a.day - b.day)
    .slice(0, limit)
}

/**
 * The system with every body's starting state written out (`state`), centre of
 * mass at rest, its speeds about it times `factor` — and, for `circular`, that
 * body set on a circular path round all the others.
 */
export function withStartSpeeds(system, factor = 1, { circular = null } = {}) {
  const list = initialBodies(system)
  const states = new Map(list.map((body) => [body.id, { pos: body.pos.slice(), vel: body.vel.map((value) => value * factor) }]))
  if (circular && states.has(circular)) {
    const rest = list.filter((body) => body.id !== circular)
    const mass = rest.reduce((sum, body) => sum + body.mass, 0)
    if (mass > 0) {
      const centre = [0, 1, 2].map((axis) => rest.reduce((sum, body) => sum + body.mass * body.pos[axis], 0) / mass)
      const restVel = [0, 1, 2].map((axis) => rest.reduce((sum, body) => sum + body.mass * states.get(body.id).vel[axis], 0) / mass)
      const own = states.get(circular)
      const dx = own.pos.map((value, axis) => value - centre[axis])
      const r = Math.hypot(...dx)
      if (r > 0) {
        // Round the others, in the plane the system mostly lies in (the x–y plane).
        const speed = Math.sqrt((G * mass) / r)
        const flat = Math.hypot(dx[0], dx[1]) || 1
        own.vel = [restVel[0] - (dx[1] / flat) * speed, restVel[1] + (dx[0] / flat) * speed, restVel[2]]
      }
    }
  }
  return {
    ...system,
    dynamics: 'nbody',
    bodies: system.bodies.map((body) => (states.has(body.id) ? { ...body, state: states.get(body.id) } : body)),
  }
}

/** Speeds tried, nearest first, when holding a system together. */
const STEADYING_FACTORS = [0.97, 0.94, 0.9, 0.85, 0.8, 0.75, 0.7, 0.6, 0.5]

/**
 * The nearest system to `system` that holds together over the story, or null: the
 * starting speeds slowed a little at a time (a bound system is a stabler one),
 * then the body that leaves set on a circular path round the rest. Returns
 * `{ system, how }`, `how` in words.
 */
export function makeStable(system) {
  const verdict = stabilityOf(system)
  if (verdict.stable) return { system, how: 'It already holds together.' }
  for (const factor of STEADYING_FACTORS) {
    const next = withStartSpeeds(system, factor)
    if (stabilityOf(next).stable) return { system: next, how: `Starting speeds slowed by ${Math.round((1 - factor) * 100)}%.` }
  }
  const leaving = verdict.ejected?.id
  if (leaving) {
    const next = withStartSpeeds(system, 1, { circular: leaving })
    if (stabilityOf(next).stable) return { system: next, how: 'The body that left now circles the rest.' }
  }
  // Last, a hierarchy, as stable triples are in the sky: the closest pair circling
  // each other, the rest circling them, further out each try.
  for (const spread of [1, 1.5, 2, 3, 4, 6]) {
    const next = asHierarchy(system, spread)
    if (next && stabilityOf(next).stable) {
      return { system: next, how: spread === 1 ? 'Set as a close pair with the others circling it.' : `Set as a close pair with the others circling it, ${spread} times as far out.` }
    }
  }
  return null
}

/** A circular velocity for a body at `dx` from a centre of `mass`, in the x–y plane. */
const circularVelocity = (dx, mass) => {
  const r = Math.hypot(...dx)
  const flat = Math.hypot(dx[0], dx[1])
  if (!(r > 0) || !(mass > 0)) return [0, 0, 0]
  const speed = Math.sqrt((G * mass) / r)
  // A body on the axis gets a direction of its own.
  return flat > 0 ? [(-dx[1] / flat) * speed, (dx[0] / flat) * speed, 0] : [speed, 0, 0]
}

/**
 * The system rebuilt as a hierarchy: its closest pair on a circular orbit about
 * their middle, each other body (nearest first) on a circle round everything
 * inside it, `spread` times as far out as it was. Null with fewer than two bodies.
 */
export function asHierarchy(system, spread = 1) {
  const list = initialBodies(system).filter((body) => body.mass > 0)
  if (list.length < 2) return null
  let pair = [0, 1]
  let best = Infinity
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const d = Math.hypot(...[0, 1, 2].map((axis) => list[i].pos[axis] - list[j].pos[axis]))
      if (d < best) {
        best = d
        pair = [i, j]
      }
    }
  }
  const [a, b] = pair.map((index) => list[index])
  const inner = a.mass + b.mass
  const middle = [0, 1, 2].map((axis) => (a.mass * a.pos[axis] + b.mass * b.pos[axis]) / inner)
  const states = new Map()
  const relative = [0, 1, 2].map((axis) => b.pos[axis] - a.pos[axis])
  const vRel = circularVelocity(relative, inner)
  states.set(a.id, { pos: a.pos.slice(), vel: vRel.map((value) => (-value * b.mass) / inner) })
  states.set(b.id, { pos: b.pos.slice(), vel: vRel.map((value) => (value * a.mass) / inner) })
  let mass = inner
  let centre = middle
  const rest = list.filter((body) => body !== a && body !== b)
    .sort((x, y) => Math.hypot(...x.pos.map((value, axis) => value - middle[axis])) - Math.hypot(...y.pos.map((value, axis) => value - middle[axis])))
  for (const body of rest) {
    const dx = body.pos.map((value, axis) => (value - centre[axis]) * spread)
    const pos = dx.map((value, axis) => value + centre[axis])
    states.set(body.id, { pos, vel: circularVelocity(dx, mass + body.mass) })
    centre = [0, 1, 2].map((axis) => (mass * centre[axis] + body.mass * pos[axis]) / (mass + body.mass))
    mass += body.mass
  }
  return {
    ...system,
    dynamics: 'nbody',
    bodies: system.bodies.map((body) => (states.has(body.id) ? { ...body, state: states.get(body.id) } : body)),
  }
}

/**
 * How many days of motion a velocity arrow on the map shows: a quarter of the
 * system's size at its bodies' typical starting speed, so arrows are long enough to
 * grab and their lengths compare. Fixed for a drag (MapSurface reads it at the press).
 */
export function arrowDays(system) {
  const list = initialBodies(system)
  if (!list.length) return 30
  const size = Math.max(...list.map((body) => Math.hypot(...body.pos)), 1e-6)
  const speeds = list.map((body) => Math.hypot(...body.vel)).filter((speed) => speed > 0).sort((a, b) => a - b)
  const typical = speeds.length ? speeds[Math.floor(speeds.length / 2)] : 0
  return typical > 0 ? (0.25 * size) / typical : 30
}

/** Where `id` starts and how fast it goes on day 0 (its `state`, or its orbit's). */
export const startStateOf = (system, id) => {
  const body = system.bodies.find((candidate) => candidate.id === id)
  return body?.state || stateFromOrbits(system).get(id) || null
}
