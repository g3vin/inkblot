/**
 * physics.js — the maths every motion in Inkblot is built from (docs/DESIGN.md §7,
 * "Motion is physical"). Pure functions, no DOM: CSS gets these springs as generated
 * `linear()` tokens (scripts/gen-spring-tokens.mjs), script drives them through
 * `SpringValue` / `useSpring` (useSpring.js), and framer-motion through `toFramer`.
 *
 * Units: time in milliseconds and velocity in units per millisecond, the same as
 * `performance.now()` and the pointer helpers, so a release speed can be handed
 * straight to a spring.
 *
 * The springs follow Apple's model (WWDC23 "Animate with springs"): a perceptual
 * `duration` and a `bounce`, with mass 1,
 *   stiffness k = (2π / duration)²
 *   damping ratio ζ = 1 − bounce          (bounce ≥ 0)
 *                   = 1 / (1 + bounce)    (bounce < 0)
 *   damping c = 4π·ζ / duration
 * and solved in closed form, so a spring is a function of time rather than of frames:
 * it moves the same at 60Hz and 120Hz, and a frame dropped is a frame skipped, not a
 * frame slowed.
 */

/**
 * The springs, by role. Bounce is 0 everywhere a state changes (a menu opens, a panel
 * slides): only motion driven by a gesture with momentum is rewarded with overshoot,
 * as Apple does (DESIGN.md §7). Durations are perceptual: how long the motion feels,
 * not when it is finally still (that is `settleTime`).
 */
export const SPRINGS = Object.freeze({
  /** Hovers, presses, small state changes, menus. */
  quick: Object.freeze({ duration: 200, bounce: 0 }),
  /** Popovers, panels, sidebars, dialogs, content arriving. */
  smooth: Object.freeze({ duration: 300, bounce: 0 }),
  /** The one long carry: a landing sheet growing into the document card. */
  gentle: Object.freeze({ duration: 550, bounce: 0 }),
  /** A thing leaving the way it came, quicker than it arrived. */
  exit: Object.freeze({ duration: 160, bounce: 0 }),
  /** After a flick or a drag: the release's speed carries it a little past. */
  momentum: Object.freeze({ duration: 350, bounce: 0.15 }),
  /**
   * Things tied to what the hand is moving, as on a string: a dragged note's children
   * trail it and swing into place. Bouncier than anything else, because the hand is
   * still moving them.
   */
  tether: Object.freeze({ duration: 330, bounce: 0.48 }),
})

/** How quickly a coasting thing slows, per millisecond (UIScrollView's rates). */
export const DECELERATION = Object.freeze({ normal: 0.998, fast: 0.99 })

/** How far past an edge a rubber band lets things go: Apple's constant. */
export const RUBBER_BAND = 0.55

/** How far back a release's speed is measured. */
export const VELOCITY_WINDOW_MS = 90

const TAU = Math.PI * 2

/**
 * A spring's physical constants from its perceptual description. `duration` is in
 * milliseconds; `stiffness` and `damping` are per second, as framer-motion and the
 * Apple APIs give them, and `omega` (the natural frequency) is per millisecond.
 */
export function spring({ duration = SPRINGS.smooth.duration, bounce = 0 } = {}) {
  const seconds = Math.max(duration, 1) / 1000
  const b = Math.max(-0.99, Math.min(0.99, bounce))
  const zeta = b >= 0 ? 1 - b : 1 / (1 + b)
  return {
    mass: 1,
    stiffness: (TAU / seconds) ** 2,
    damping: (4 * Math.PI * zeta) / seconds,
    zeta,
    omega: TAU / seconds / 1000,
  }
}

const paramsOf = (preset) => (preset && 'omega' in preset ? preset : spring(preset))

/**
 * Where a spring is `t` ms after it set off from `from` towards `to` at `velocity`
 * (units/ms), and how fast it is going there.
 */
export function springAt(preset, from, to, velocity, t) {
  const { zeta, omega } = paramsOf(preset)
  const x0 = from - to
  const v0 = velocity
  if (t <= 0) return { value: from, velocity: v0 }
  let x
  let v
  if (zeta < 1) {
    const decay = zeta * omega
    const wd = omega * Math.sqrt(1 - zeta * zeta)
    const a = x0
    const b = (v0 + decay * x0) / wd
    const envelope = Math.exp(-decay * t)
    const cos = Math.cos(wd * t)
    const sin = Math.sin(wd * t)
    x = envelope * (a * cos + b * sin)
    v = envelope * ((b * wd - decay * a) * cos - (a * wd + decay * b) * sin)
  } else if (zeta === 1) {
    const c = v0 + omega * x0
    const envelope = Math.exp(-omega * t)
    x = envelope * (x0 + c * t)
    v = envelope * (c - omega * (x0 + c * t))
  } else {
    const root = omega * Math.sqrt(zeta * zeta - 1)
    const r1 = -zeta * omega + root
    const r2 = -zeta * omega - root
    const c2 = (v0 - r1 * x0) / (r2 - r1)
    const c1 = x0 - c2
    const e1 = Math.exp(r1 * t)
    const e2 = Math.exp(r2 * t)
    x = c1 * e1 + c2 * e2
    v = c1 * r1 * e1 + c2 * r2 * e2
  }
  return { value: to + x, velocity: v }
}

/**
 * How long until the spring is still: within `precision` of where it is going (as a
 * fraction of the distance, or absolute when the distance is 0) and slower than
 * `precision` of it per 16ms.
 */
export function settleTime(preset, { from = 0, to = 1, velocity = 0, precision = 0.005 } = {}) {
  const params = paramsOf(preset)
  const distance = Math.abs(to - from) || 1
  const limit = (TAU / params.omega) * 4
  for (let t = 0; t <= limit; t += 4) {
    const state = springAt(params, from, to, velocity, t)
    if (Math.abs(state.value - to) <= precision * distance
      && Math.abs(state.velocity) * 16 <= precision * distance) return t
  }
  return limit
}

/**
 * A spring from rest as progress from 0 to 1: `at(ms)`, and the `duration` after which
 * it is 1. For motion script steps itself with nothing to hand a velocity to.
 */
export function progressOf(preset) {
  const params = paramsOf(preset)
  const duration = settleTime(params)
  return { duration, at: (ms) => (ms >= duration ? 1 : springAt(params, 0, 1, 0, Math.max(0, ms)).value) }
}

/** Perpendicular distance from `p` to the chord from `a` to `b`. */
const offChord = (p, a, b) => {
  const dx = b.t - a.t
  const dy = b.v - a.v
  const length = Math.hypot(dx, dy) || 1
  return Math.abs(dy * (p.t - a.t) - dx * (p.v - a.v)) / length
}

/** Ramer–Douglas–Peucker: the fewest points that keep the curve within `tolerance`. */
const simplify = (points, tolerance) => {
  if (points.length < 3) return points
  let worst = 0
  let index = 0
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = offChord(points[i], points[0], points[points.length - 1])
    if (d > worst) { worst = d; index = i }
  }
  if (worst <= tolerance) return [points[0], points[points.length - 1]]
  const left = simplify(points.slice(0, index + 1), tolerance)
  return [...left.slice(0, -1), ...simplify(points.slice(index), tolerance)]
}

const fixed = (n, digits) => String(Number(n.toFixed(digits)))

/**
 * A spring as a CSS easing: `{ easing: 'linear(…)', duration }`, the duration being
 * the settle time in ms. From rest by default; `velocity` sets it off at that speed,
 * in progress (of the whole distance) per ms, so a release's speed can be baked into
 * a one-off curve and handed to the compositor. CSS can't retarget a spring, so
 * anything held while it moves runs in script instead.
 */
export function springEasing(preset, { tolerance = 0.002, velocity = 0 } = {}) {
  const params = paramsOf(preset)
  const duration = settleTime(params, { velocity })
  const steps = Math.max(32, Math.round(duration / 4))
  const points = []
  for (let i = 0; i <= steps; i += 1) {
    const t = (duration * i) / steps
    points.push({ t: i / steps, v: springAt(params, 0, 1, velocity, t).value })
  }
  points[points.length - 1] = { t: 1, v: 1 }
  const kept = simplify(points, tolerance)
  const stops = kept.map((p, i) => {
    const value = fixed(p.v, 4)
    return i === 0 || i === kept.length - 1 ? value : `${value} ${fixed(p.t * 100, 2)}%`
  })
  return { easing: `linear(${stops.join(', ')})`, duration: Math.round(duration) }
}

/** The same spring for framer-motion, so the two never drift apart. */
export function toFramer(preset, extra = {}) {
  const { stiffness, damping, mass } = paramsOf(preset)
  return { type: 'spring', stiffness, damping, mass, ...extra }
}

/**
 * How far something released at `velocity` (units/ms) coasts before friction stops
 * it, at a deceleration `rate` per ms. Apple's projection:
 * `(v / 1000) · rate / (1 − rate)` with v per second, which is `v · rate / (1 − rate)`
 * per millisecond.
 */
export const project = (velocity, rate = DECELERATION.normal) => (velocity * rate) / (1 - rate)

/**
 * A coast `t` ms after a release at `velocity`: how far it has gone and how fast it
 * still is. Speed falls by `rate` every millisecond, so the whole coast is `project`.
 */
export function decayAt(velocity, t, rate = DECELERATION.normal) {
  const k = Math.log(rate)
  const left = rate ** t
  return { offset: (velocity * (left - 1)) / k, velocity: velocity * left }
}

/**
 * Of `targets`, the one a release at `position` moving at `velocity` should land on:
 * the nearest to where it would coast to, not to where it was let go.
 */
export function nearestTarget(position, velocity, targets, rate = DECELERATION.normal) {
  const projected = position + project(velocity, rate)
  let best = targets[0]
  for (const target of targets) {
    if (Math.abs(target - projected) < Math.abs(best - projected)) best = target
  }
  return best
}

/**
 * Past an edge, `offset` beyond it moves only part of the way, less and less the
 * further it is pulled, and never more than `dimension`: Apple's rubber band.
 */
export function rubberBand(offset, dimension, constant = RUBBER_BAND) {
  if (!offset || dimension <= 0) return 0
  const give = (1 - 1 / ((Math.abs(offset) * constant) / dimension + 1)) * dimension
  return Math.sign(offset) * give
}

/** `value` held to [min, max] with rubber-banded give past either end. */
export function rubberClamp(value, min, max, dimension, constant = RUBBER_BAND) {
  if (value < min) return min + rubberBand(value - min, dimension, constant)
  if (value > max) return max + rubberBand(value - max, dimension, constant)
  return value
}

/**
 * A pointer's speed from its recent samples (`{ t, x, y? }`, oldest first) in
 * units/ms: over the last `windowMs`, so a hand that slows before lifting is read as
 * slow, and never from only the last two samples, which jitter.
 */
export function velocityFrom(samples, windowMs = VELOCITY_WINDOW_MS) {
  if (!samples || samples.length < 2) return { x: 0, y: 0 }
  const last = samples[samples.length - 1]
  let first = samples.find((sample) => last.t - sample.t <= windowMs) ?? samples[0]
  if (first === last) first = samples[samples.length - 2]
  const dt = Math.max(1, last.t - first.t)
  return { x: (last.x - first.x) / dt, y: ((last.y ?? 0) - (first.y ?? 0)) / dt }
}

/** Keeps the last `windowMs` of a pointer's path, for `velocityFrom`. */
export function trackSample(samples, sample, windowMs = VELOCITY_WINDOW_MS * 2) {
  samples.push(sample)
  while (samples.length > 2 && sample.t - samples[0].t > windowMs) samples.shift()
  return samples
}

export const prefersReducedMotion = () => (
  typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
)
