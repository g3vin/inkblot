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
  /**
   * After a flick or a drag: the release's speed carries it a little past. The most a
   * release gets; `releaseSpring` gives a slower one less.
   */
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

/**
 * How much a rubber band gives, by what is pulling it: UIKit's coefficients per input
 * (`-[UIScrollView _currentRubberBandCoefficient]`). A finger drags the content itself
 * and gets the most give; a mouse or a trackpad moves a pointer over it, and an edge
 * that gave as much would feel loose.
 */
export const RUBBER_BANDS = Object.freeze({ touch: 0.55, pen: 0.55, mouse: 0.4, trackpad: 0.17 })

/** The rubber band for an input: a `pointerType`, or 'trackpad' for wheel gestures. */
export const rubberCoefficient = (input) => RUBBER_BANDS[input] ?? RUBBER_BANDS.touch

/** How far back a release's speed is measured. */
export const VELOCITY_WINDOW_MS = 90

/**
 * The thresholds a gesture decides by.
 *   slop    how far a press moves before it is a drag (Euclidean px): a finger is
 *           imprecise and gets Apple's 10pt, a pointer 4px
 *   flick   release speed (px/ms) that counts as thrown: iOS pages on ≥ 300pt/s
 *   pause   slower than this (px/ms) the hand has stopped
 */
export const GESTURE = Object.freeze({ slop: { pointer: 4, touch: 10 }, flick: 0.3, pause: 0.05 })

/** Whether a press that has moved (`dx`, `dy`) is now a drag. */
export const pastSlop = (dx, dy, pointerType = 'mouse') => (
  Math.hypot(dx, dy) >= (pointerType === 'touch' ? GESTURE.slop.touch : GESTURE.slop.pointer)
)

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
 * How long until the spring is still for good: within `precision` of where it is going
 * (as a fraction of the distance, or absolute when the distance is 0) and slower than
 * `precision` of it per 16ms, and never outside that again. A bouncy spring passes
 * through its target on the way to its overshoot, so the first moment it looks still
 * is not when it is.
 */
export function settleTime(preset, { from = 0, to = 1, velocity = 0, precision = 0.005 } = {}) {
  const params = paramsOf(preset)
  const distance = Math.abs(to - from) || 1
  const limit = (TAU / params.omega) * 4
  let settled = 0
  for (let t = 0; t <= limit; t += 4) {
    const state = springAt(params, from, to, velocity, t)
    const still = Math.abs(state.value - to) <= precision * distance
      && Math.abs(state.velocity) * 16 <= precision * distance
    if (!still) settled = t + 4
  }
  return Math.min(settled, limit)
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
 * How close a CSS curve gets before its last stop puts it on 1: under a pixel in 300.
 * Finer only lengthens the `-dur` tokens that hand-offs wait on, for no visible change.
 */
const EASING_PRECISION = 0.002

/**
 * A spring as a CSS easing: `{ easing: 'linear(…)', duration }`, the duration being
 * the settle time in ms. From rest by default; `velocity` sets it off at that speed,
 * in progress (of the whole distance) per ms, so a release's speed can be baked into
 * a one-off curve and handed to the compositor. CSS can't retarget a spring, so
 * anything held while it moves runs in script instead.
 */
export function springEasing(preset, { tolerance = 0.002, velocity = 0 } = {}) {
  const params = paramsOf(preset)
  const duration = settleTime(params, { velocity, precision: EASING_PRECISION })
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

const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Above this release speed (px/ms) a landing gets all of `momentum`'s bounce. */
const FULL_BOUNCE_SPEED = 1.5

const releaseSprings = new Map()

/**
 * The spring a release lands on: `momentum`, with its bounce scaled by how hard the
 * hand let go (`speed`, px/ms). A slow let-go lands dead; only a flick overshoots, as
 * Apple rewards momentum. Shared per bounce, so callers may compare them by identity.
 */
export function releaseSpring(speed) {
  const bounce = Math.round(SPRINGS.momentum.bounce * smoothstep(GESTURE.flick, FULL_BOUNCE_SPEED, Math.abs(speed)) * 100) / 100
  if (bounce >= SPRINGS.momentum.bounce) return SPRINGS.momentum
  let preset = releaseSprings.get(bounce)
  if (!preset) {
    preset = Object.freeze({ duration: SPRINGS.momentum.duration, bounce })
    releaseSprings.set(bounce, preset)
  }
  return preset
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
 * Where a release at `position` moving at `velocity` lands among `targets`: the one
 * nearest where it would coast to (`nearestTarget`), so a flick decides by where it
 * was going and a slow let-go by where it is. With `from` and `maxStep`, it lands no
 * further than `maxStep` targets from `from`, as a page view turns one page per flick.
 */
export function settleOnTargets({ position, velocity, targets, rate = DECELERATION.normal, from, maxStep = Infinity }) {
  let candidates = targets
  if (from !== undefined && Number.isFinite(maxStep)) {
    const sorted = [...targets].sort((a, b) => a - b)
    const home = sorted.indexOf(nearestTarget(from, 0, sorted))
    candidates = sorted.slice(Math.max(0, home - maxStep), home + maxStep + 1)
  }
  return nearestTarget(position, velocity, candidates, rate)
}

/**
 * Past an edge, `offset` beyond it moves only part of the way, less and less the
 * further it is pulled, and never more than `dimension`: Apple's rubber band,
 * `c·x·d / (d + c·x)`, with `c` from `rubberCoefficient` for the input pulling it.
 */
export function rubberBand(offset, dimension, constant = RUBBER_BANDS.touch) {
  if (!offset || dimension <= 0) return 0
  const give = (1 - 1 / ((Math.abs(offset) * constant) / dimension + 1)) * dimension
  return Math.sign(offset) * give
}

/**
 * The pull that `rubberBand` shows as `shown`: how far past the edge the hand must be
 * for the edge to be drawn there, so an edge caught as it springs back is held where
 * it is drawn rather than jumping to the hand.
 */
export function unRubberBand(shown, dimension, constant = RUBBER_BANDS.touch) {
  if (!shown || dimension <= 0) return 0
  const x = Math.min(Math.abs(shown), dimension * 0.999)
  return Math.sign(shown) * ((dimension * x) / (constant * (dimension - x)))
}

/** `value` held to [min, max] with rubber-banded give past either end. */
export function rubberClamp(value, min, max, dimension, constant = RUBBER_BANDS.touch) {
  if (value < min) return min + rubberBand(value - min, dimension, constant)
  if (value > max) return max + rubberBand(value - max, dimension, constant)
  return value
}

/** The inverse of `rubberClamp`: the unbanded value that is drawn at `shown`. */
export function rubberUnclamp(shown, min, max, dimension, constant = RUBBER_BANDS.touch) {
  if (shown < min) return min + unRubberBand(shown - min, dimension, constant)
  if (shown > max) return max + unRubberBand(shown - max, dimension, constant)
  return shown
}

/**
 * How fast `rubberClamp` moves for each unit of pull at `value`: 1 inside, less past
 * either end. A release past an edge hands the spring the speed the edge was drawn
 * moving at, which is the hand's speed times this.
 */
export function rubberSlope(value, min, max, dimension, constant = RUBBER_BANDS.touch) {
  const over = value < min ? min - value : value > max ? value - max : 0
  if (!over || dimension <= 0) return 1
  return constant / (1 + (constant * over) / dimension) ** 2
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** Least-squares slope of `key` over time through `points` (at least two). */
function slope(points, key) {
  const n = points.length
  let mt = 0
  let mv = 0
  for (const p of points) { mt += p.t; mv += p[key] ?? 0 }
  mt /= n
  mv /= n
  let num = 0
  let den = 0
  for (const p of points) {
    const dt = p.t - mt
    num += dt * ((p[key] ?? 0) - mv)
    den += dt * dt
  }
  return den > 0 ? num / den : 0
}

/** The samples in the `windowMs` before `at`, with the hand held still at `at` if it has been. */
function recent(samples, windowMs, at) {
  const last = samples[samples.length - 1]
  const points = samples.filter((sample) => sample.t >= at - windowMs && sample.t <= at)
  // A pointer that stops sends no more moves; a gap over a frame since the last one
  // is the hand holding still, and counts as a sample where it was.
  if (at - last.t > 20) points.push({ t: at, x: last.x, y: last.y })
  if (points.length < 2) {
    const before = samples.filter((sample) => sample.t <= at)
    return before.slice(-2)
  }
  return points
}

/**
 * A pointer's speed from its recent samples (`{ t, x, y? }`, oldest first) in
 * units/ms at the moment `at` (the release; now by default): fitted over the last
 * `windowMs`, so a hand that slows before lifting is read as slow and one jittery
 * event counts for little. A hand that held still longer than the window before
 * letting go has no speed, so a drag that stops and then lifts is never thrown.
 */
export function velocityFrom(samples, windowMs = VELOCITY_WINDOW_MS, at = now()) {
  if (!samples || samples.length < 2) return { x: 0, y: 0 }
  const last = samples[samples.length - 1]
  const when = Math.max(at, last.t)
  if (when - last.t > windowMs) return { x: 0, y: 0 }
  const points = recent(samples, windowMs, when)
  if (points.length < 2 || points[points.length - 1].t - points[0].t < 1) return { x: 0, y: 0 }
  return { x: slope(points, 'x'), y: slope(points, 'y') }
}

/**
 * Whether the hand has just stopped, read from its samples as Apple reads it: a sharp
 * fall in speed, which comes sooner than any timer could tell, or a hand that has been
 * slow for a while. For a drag that acts on a pause (a dwell over a folder).
 */
export function isPausing(samples, at = now(), { recentMs = 32, priorMs = 64 } = {}) {
  if (!samples || samples.length < 2) return false
  const speed = (v) => Math.hypot(v.x, v.y)
  const latest = speed(velocityFrom(samples, recentMs, at))
  if (latest >= GESTURE.pause) return false
  const before = speed(velocityFrom(samples, priorMs, at - recentMs))
  const braked = (before - latest) / recentMs > GESTURE.pause / recentMs
  const still = before < GESTURE.pause && at - samples[0].t >= recentMs + priorMs
  return braked || still
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
