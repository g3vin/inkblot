/**
 * useSpring.js — motion a writer can hold: a value driven by a spring from physics.js
 * that can be retargeted, grabbed and released at any moment without a jump in where
 * it is or how fast it is going (docs/DESIGN.md §7).
 *
 * Every running spring shares one requestAnimationFrame loop, which stops when the
 * last one comes to rest. A spring is solved in closed form from the moment it was
 * last set, so it is exact at any refresh rate. Values are handed to `onChange`
 * rather than to React state, so a moving thing is restyled each frame without a
 * render.
 */
import { useEffect, useLayoutEffect, useState } from 'react'
import { DECELERATION, SPRINGS, decayAt, prefersReducedMotion, releaseSpring, spring, springAt, springEasing } from './physics.js'

/** Slower than this (px/ms) a coast has stopped: a twentieth of a pixel a frame. */
const COAST_MIN_SPEED = 0.003

/**
 * Without a `precision`, a spring has arrived within this fraction of the distance it
 * set off over, as the CSS curves do (physics.js), so script and CSS land together.
 * The floor is for a spring set off only by a release, with no distance to go.
 */
const RELATIVE_PRECISION = 0.002
const PRECISION_FLOOR = 0.001

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

const running = new Set()
let frame = 0

// The frame's own timestamp is not used: a spring was set by now(), and the two clocks
// need not share an origin.
function tick() {
  frame = 0
  const time = now()
  for (const value of running) value.step(time)
  if (running.size) frame = requestAnimationFrame(tick)
}

function wake(value) {
  running.add(value)
  if (!frame && typeof requestAnimationFrame !== 'undefined') frame = requestAnimationFrame(tick)
}

const timings = new Map()
const supportsLinear = () => (
  typeof CSS !== 'undefined' && Boolean(CSS.supports?.('transition-timing-function', 'linear(0, 1)'))
)

/**
 * A CSS transition's timing (`'<ms>ms linear(…)'`) for a spring from `from` to `to`
 * setting off at `velocity` (units/ms): a release handed to the compositor with its
 * speed kept, so nothing is stepped in script. Where `linear()` isn't supported, or
 * there is no distance to go, it is the preset's token from rest: a cubic-bézier
 * can't start at speed, so on those webviews a release eases out from a standstill.
 */
export function springTransition(preset, { from, to, velocity = 0 }) {
  const name = Object.keys(SPRINGS).find((key) => SPRINGS[key] === preset)
    ?? (preset.bounce > 0 ? 'momentum' : 'smooth')
  const resting = `var(--spring-${name}-dur) var(--spring-${name})`
  const distance = to - from
  if (!supportsLinear() || Math.abs(distance) < 1e-6) return resting
  const { easing, duration } = springEasing(preset, { velocity: velocity / distance })
  return `${duration}ms ${easing}`
}

/**
 * A spring from rest as Web Animations timing, `{ duration, easing }`: the same curve
 * as its `--spring-*` token, for keyframes script builds. Where `linear()` isn't
 * supported the curve falls back to an ease-out, which the webview would otherwise
 * reject outright.
 */
export function springTiming(preset = SPRINGS.smooth) {
  let timing = timings.get(preset)
  if (!timing) {
    const { easing, duration } = springEasing(preset)
    timing = { duration, easing: supportsLinear() ? easing : 'ease-out' }
    timings.set(preset, timing)
  }
  return timing
}

/**
 * One number moving on a spring. `set` aims it somewhere new and keeps its current
 * velocity, unless a release velocity is given; `jump` puts it there at once.
 *
 *   precision   how close (in the value's units) counts as arrived; by default a
 *               fraction of the distance it set off over, as the CSS curves settle
 */
export class SpringValue {
  constructor(value = 0, { spring: preset = SPRINGS.smooth, precision, onChange, onRest } = {}) {
    this.onChange = onChange
    this.onRest = onRest
    this.precision = precision
    this.preset = preset
    this.params = spring(preset)
    this.origin = { value, velocity: 0, time: 0 }
    this.target = value
    this.current = value
    this.speed = 0
  }

  get value() { return this.current }
  get velocity() { return this.speed }
  get moving() { return running.has(this) }

  /** Aim at `target`. `velocity` (units/ms) replaces the current one, as a release does. */
  set(target, { velocity, spring: preset } = {}) {
    const time = now()
    this.sync(time)
    if (preset && preset !== this.preset) {
      this.preset = preset
      this.params = spring(preset)
    }
    if (velocity !== undefined) this.speed = velocity
    this.target = target
    if (prefersReducedMotion()) {
      this.jump(target)
      return this
    }
    this.origin = { value: this.current, velocity: this.speed, time }
    if (this.current !== target || this.speed !== 0) wake(this)
    return this
  }

  /** Put it at `value` with no motion, as a hand dragging it does. */
  jump(value) {
    running.delete(this)
    this.current = value
    this.target = value
    this.speed = 0
    this.origin = { value, velocity: 0, time: now() }
    this.onChange?.(value, 0)
    return this
  }

  /** Stop where it is, keeping no velocity. */
  stop() {
    this.sync(now())
    running.delete(this)
    this.speed = 0
    return this
  }

  /** Bring `current` and `speed` up to `time` without notifying. */
  sync(time) {
    if (!running.has(this)) return
    const state = springAt(this.params, this.origin.value, this.target, this.origin.velocity, time - this.origin.time)
    this.current = state.value
    this.speed = state.velocity
  }

  step(time) {
    this.sync(time)
    const precision = this.precision
      ?? Math.max(PRECISION_FLOOR, RELATIVE_PRECISION * Math.abs(this.target - this.origin.value))
    const arrived = Math.abs(this.current - this.target) <= precision
      && Math.abs(this.speed) * 16 <= precision
    if (arrived) {
      running.delete(this)
      this.current = this.target
      this.speed = 0
    }
    this.onChange?.(this.current, this.speed)
    if (arrived) this.onRest?.(this.current)
  }
}

/**
 * A `SpringValue` that lives as long as the component and stops with it. The
 * callbacks may change every render; the latest ones are called.
 */
export function useSpring(initial, { spring: preset = SPRINGS.smooth, precision, onChange, onRest } = {}) {
  const [{ value, handlers }] = useState(() => {
    const latest = {}
    const spring = new SpringValue(initial, {
      spring: preset,
      precision,
      onChange: (current, velocity) => latest.onChange?.(current, velocity),
      onRest: (current) => latest.onRest?.(current),
    })
    return { value: spring, handlers: latest }
  })
  useLayoutEffect(() => {
    handlers.onChange = onChange
    handlers.onRest = onRest
  })
  useEffect(() => () => { value.stop() }, [value])
  return value
}

/**
 * Let something thrown at `velocity` ({ x, y } in px/ms) coast to a stop under
 * friction, as a scroll view does: `apply(dx, dy)` moves it on each frame. Returns a
 * function that stops it, for the next touch. Under reduced motion nothing coasts.
 */
export function coast(velocity, apply, rate = DECELERATION.normal) {
  if (prefersReducedMotion() || Math.hypot(velocity.x, velocity.y) < COAST_MIN_SPEED
    || typeof requestAnimationFrame === 'undefined') return () => {}
  const start = now()
  let moved = { x: 0, y: 0 }
  let handle = 0
  const step = () => {
    const t = now() - start
    const x = decayAt(velocity.x, t, rate)
    const y = decayAt(velocity.y, t, rate)
    apply(x.offset - moved.x, y.offset - moved.y)
    moved = { x: x.offset, y: y.offset }
    handle = Math.hypot(x.velocity, y.velocity) < COAST_MIN_SPEED ? 0 : requestAnimationFrame(step)
  }
  handle = requestAnimationFrame(step)
  return () => cancelAnimationFrame(handle)
}

/**
 * After a list's items move (a reorder, a drop), spring each from where it was drawn
 * to where it now is, so nothing jumps: call `measure()` before the change and the
 * function it returns once the change is in the DOM. `from` places one item somewhere
 * else first, as a dropped item starts under the hand, at `velocity` (px/ms).
 * The offset is the `translate` property, which composes with a transform.
 */
export function springLayout(list, selector, idOf) {
  const rects = new Map()
  list?.querySelectorAll(selector).forEach((element) => rects.set(idOf(element), element.getBoundingClientRect()))
  return ({ id: movedId, from, velocity = { x: 0, y: 0 } } = {}) => {
    if (!list || prefersReducedMotion()) return
    list.querySelectorAll(selector).forEach((element) => {
      const id = idOf(element)
      const now = element.getBoundingClientRect()
      const moved = id === movedId && from
      const was = moved ? { left: from.x - now.width / 2, top: from.y - now.height / 2 } : rects.get(id)
      if (!was) return
      const dx = was.left - now.left
      const dy = was.top - now.top
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
      const offset = { x: dx, y: dy }
      const paint = () => {
        element.style.translate = offset.x || offset.y ? `${offset.x}px ${offset.y}px` : ''
      }
      const preset = moved ? releaseSpring(Math.hypot(velocity.x, velocity.y)) : SPRINGS.smooth
      const axis = (key, v) => new SpringValue(offset[key], {
        spring: preset,
        precision: 0.5,
        onChange: (value) => { offset[key] = value; paint() },
      }).set(0, { velocity: moved ? v : 0 })
      paint()
      axis('x', velocity.x)
      axis('y', velocity.y)
    })
  }
}
