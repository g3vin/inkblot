/**
 * Motion is physical (src/ui/physics.js, useSpring.js): the closed-form spring against
 * the equation it solves, velocity carried through a release and a retarget, the
 * same motion at any refresh rate, Apple's projection and rubber band, and the CSS
 * tokens generated from the same springs.
 */
import fs from 'node:fs'
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'
import { ok } from './assert.mjs'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
installGlobals(dom.window, ['window', 'requestAnimationFrame', 'cancelAnimationFrame'])

const {
  SPRINGS, RUBBER_BANDS, spring, springAt, settleTime, springEasing, releaseSpring, toFramer, project, decayAt,
  nearestTarget, settleOnTargets, rubberCoefficient, rubberBand, unRubberBand, rubberClamp, rubberUnclamp,
  rubberSlope, pastSlop, velocityFrom, isPausing,
} = await import('../../src/ui/physics.js')
const { SpringValue } = await import('../../src/ui/useSpring.js')
const { springBlock, currentBlock } = await import('../../scripts/gen-spring-tokens.mjs')

const near = (a, b, tolerance = 1e-3) => Math.abs(a - b) <= tolerance

/** x'' = −k(x − target) − c·x', stepped finely: what the closed form must agree with. */
function integrate(preset, from, to, velocity, t) {
  const { stiffness, damping } = spring(preset)
  const k = stiffness / 1e6
  const c = damping / 1e3
  let x = from
  let v = velocity
  const dt = 0.005
  for (let s = 0; s < t; s += dt) {
    v += (-k * (x - to) - c * v) * dt
    x += v * dt
  }
  return { value: x, velocity: v }
}

/* ---------------- the spring ---------------- */

ok('Apple\'s conversion: stiffness (2π/d)², damping 4πζ/d', (() => {
  const s = spring({ duration: 500, bounce: 0.2 })
  return near(s.stiffness, (2 * Math.PI / 0.5) ** 2) && near(s.damping, 4 * Math.PI * 0.8 / 0.5) && near(s.zeta, 0.8)
})())
ok('a negative bounce is overdamped', spring({ duration: 400, bounce: -0.5 }).zeta === 2)

for (const [label, preset] of [['underdamped', { duration: 300, bounce: 0.3 }], ['critically damped', { duration: 300, bounce: 0 }], ['overdamped', { duration: 300, bounce: -0.4 }]]) {
  const exact = springAt(preset, 0, 100, 0.8, 150)
  const stepped = integrate(preset, 0, 100, 0.8, 150)
  ok(`${label}: the closed form solves the equation`, near(exact.value, stepped.value, 0.05) && near(exact.velocity, stepped.velocity, 0.002))
}

ok('a spring starts where it is, at the speed it was given', (() => {
  const start = springAt(SPRINGS.momentum, 10, 50, 1.5, 0)
  const soon = springAt(SPRINGS.momentum, 10, 50, 1.5, 0.01)
  return start.value === 10 && near((soon.value - 10) / 0.01, 1.5, 0.01)
})())
ok('state changes never overshoot', (() => {
  for (let t = 0; t < 600; t += 2) if (springAt(SPRINGS.smooth, 0, 1, 0, t).value > 1 + 1e-9) return false
  return true
})())
ok('momentum overshoots a little, and only a little', (() => {
  let peak = 0
  for (let t = 0; t < 800; t += 2) peak = Math.max(peak, springAt(SPRINGS.momentum, 0, 1, 0, t).value)
  return peak > 1.005 && peak < 1.1
})())
ok('a bouncy spring is not settled until its overshoot has come back', (() => {
  let peakAt = 0
  let peak = 0
  for (let t = 0; t < 1000; t += 1) {
    const { value } = springAt(SPRINGS.momentum, 0, 1, 0, t)
    if (value > peak) { peak = value; peakAt = t }
  }
  return settleTime(SPRINGS.momentum) > peakAt
})())
ok('the momentum curve overshoots, and ends a hair from 1', (() => {
  const stops = springEasing(SPRINGS.momentum).easing.slice(7, -1).split(', ').map((stop) => Number(stop.split(' ')[0]))
  return Math.max(...stops) > 1.005 && Math.abs(stops[stops.length - 2] - 1) < 0.01
})())
ok('a slow let-go lands dead, a flick bounces, a hard one gets all of momentum', (() => {
  const speeds = [0, 0.2, 0.5, 0.8, 1.2, 1.5, 4]
  const bounces = speeds.map((speed) => releaseSpring(speed).bounce)
  return bounces[0] === 0 && bounces[1] === 0 && bounces.every((b, i) => i === 0 || b >= bounces[i - 1])
    && releaseSpring(4) === SPRINGS.momentum && releaseSpring(0.8) === releaseSpring(-0.8)
})())
ok('a spring settles, and later for a longer one', settleTime(SPRINGS.quick) < settleTime(SPRINGS.smooth)
  && settleTime(SPRINGS.smooth) < settleTime(SPRINGS.gentle))
ok('framer-motion gets the same constants', (() => {
  const f = toFramer(SPRINGS.smooth)
  const s = spring(SPRINGS.smooth)
  return f.type === 'spring' && f.stiffness === s.stiffness && f.damping === s.damping && f.mass === 1
})())

/* ---------------- the driver ---------------- */

// A clock the driver tests turn by hand; the real one is put back after them, as the
// suites that follow use it.
const clock = { t: 0 }
const realPerformance = globalThis.performance
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock.t }, configurable: true, writable: true })

ok('the same motion at 60Hz and 120Hz', (() => {
  const sample = (hz) => {
    clock.t = 0
    const value = new SpringValue(0, { spring: SPRINGS.smooth })
    value.set(100)
    for (let f = 1; f * (1000 / hz) <= 120; f += 1) value.step(f * (1000 / hz))
    value.stop()
    return value.value
  }
  return near(sample(60), sample(120), 1e-6)
})())

ok('a retarget keeps its place and its speed', (() => {
  clock.t = 0
  const value = new SpringValue(0, { spring: SPRINGS.smooth })
  value.set(100)
  value.step(80)
  const before = { value: value.value, velocity: value.velocity }
  clock.t = 80
  value.set(-50)
  value.step(80)
  const after = { value: value.value, velocity: value.velocity }
  value.stop()
  return near(before.value, after.value, 1e-9) && near(before.velocity, after.velocity, 1e-9)
})())

ok('a release hands its speed to the spring', (() => {
  clock.t = 0
  const value = new SpringValue(0, { spring: SPRINGS.momentum })
  value.set(0, { velocity: 2 })
  value.step(10)
  const moved = value.value
  value.stop()
  return moved > 10
})())

ok('a spring comes to rest on its target and says so', (() => {
  clock.t = 0
  let rested = null
  const value = new SpringValue(0, { spring: SPRINGS.quick, onRest: (v) => { rested = v } })
  value.set(40)
  for (let t = 16; t < 2000 && rested === null; t += 16) value.step(t)
  return rested === 40 && !value.moving
})())

Object.defineProperty(globalThis, 'performance', { value: realPerformance, configurable: true, writable: true })

/* ---------------- gestures ---------------- */

ok('projection is Apple\'s: 1px/ms coasts 499px at the normal rate', near(project(1), 499, 1e-6))
ok('a coast travels the projection, and slows as it goes', (() => {
  const end = decayAt(1, 1e5)
  const early = decayAt(1, 100)
  return near(end.offset, project(1), 1) && early.velocity < 1 && early.velocity > 0.8
})())
ok('a flick lands on the target it is thrown towards', nearestTarget(0, 0.5, [0, 200, 400]) === 200
  && nearestTarget(10, 0, [0, 200, 400]) === 0)
ok('the rubber band gives less and less, and never past the dimension', (() => {
  const small = rubberBand(10, 300)
  const big = rubberBand(1e6, 300)
  return small > 0 && small < 10 && big < 300 && big > 299 && rubberBand(-10, 300) === -small
})())
ok('rubberClamp leaves the inside alone', rubberClamp(150, 100, 200, 300) === 150 && rubberClamp(90, 100, 200, 300) < 100
  && rubberClamp(90, 100, 200, 300) > 90)
ok('a release speed is the last moments, not the whole drag', (() => {
  const v = velocityFrom([{ t: 0, x: 0 }, { t: 500, x: 50 }, { t: 540, x: 90 }, { t: 560, x: 110 }], undefined, 560)
  return near(v.x, 1, 0.01) && v.y === 0
})())
const steady = [{ t: 0, x: 0 }, { t: 16, x: 16 }, { t: 32, x: 32 }, { t: 48, x: 48 }]
ok('a hand that stops before lifting has slowed, and one held still is not thrown', (() => {
  const moving = velocityFrom(steady, undefined, 50).x
  const slowed = velocityFrom(steady, undefined, 110).x
  const held = velocityFrom(steady, undefined, 300).x
  return near(moving, 1, 0.01) && slowed < moving / 2 && held === 0
})())
ok('one jittery event counts for little', (() => {
  const jitter = [...steady.slice(0, 3), { t: 40, x: 50 }, { t: 48, x: 48 }]
  return Math.abs(velocityFrom(jitter, undefined, 48).x - 1) < 0.5
})())
ok('a sudden stop is a pause; moving on is not', !isPausing(steady, 50) && isPausing(steady, 90)
  && isPausing([{ t: 0, x: 0 }, { t: 100, x: 1 }, { t: 200, x: 2 }], 200))
ok('a drag starts past the slop: a finger needs more than a pointer', !pastSlop(3, 0, 'mouse') && pastSlop(3, 3, 'mouse')
  && !pastSlop(6, 6, 'touch') && pastSlop(8, 8, 'touch'))
ok('a page turns on a 0.3px/ms flick from a tenth of the way, but no further than one', (() => {
  const pages = [0, 240, 480, 720]
  return settleOnTargets({ position: 24, velocity: 0.31, targets: pages, from: 0, maxStep: 1 }) === 240
    && settleOnTargets({ position: 24, velocity: 0.05, targets: pages, from: 0, maxStep: 1 }) === 0
    && settleOnTargets({ position: 24, velocity: 5, targets: pages, from: 0, maxStep: 1 }) === 240
    && settleOnTargets({ position: 24, velocity: 5, targets: pages }) === 720
})())
ok('a mouse pulls an edge stiffer than a finger, a trackpad stiffer still', (() => {
  const give = (input) => rubberBand(50, 300, rubberCoefficient(input))
  return give('touch') > give('mouse') && give('mouse') > give('trackpad') && rubberCoefficient('nope') === RUBBER_BANDS.touch
})())
ok('an edge caught as it springs back is held where it is drawn', [12, 80, 250].every((pull) => {
  const c = RUBBER_BANDS.mouse
  return near(unRubberBand(rubberBand(pull, 300, c), 300, c), pull, 1e-6)
    && near(rubberUnclamp(rubberClamp(100 + pull, 0, 100, 60, c), 0, 100, 60, c), 100 + pull, 1e-6)
}))
ok('past an edge the drawn speed is the hand\'s times the band\'s slope', (() => {
  const c = RUBBER_BANDS.mouse
  const at = 140
  const numeric = (rubberClamp(at + 0.01, 0, 100, 60, c) - rubberClamp(at, 0, 100, 60, c)) / 0.01
  return rubberSlope(50, 0, 100, 60, c) === 1 && near(rubberSlope(at, 0, 100, 60, c), numeric, 1e-3)
})())

/* ---------------- every drag ---------------- */

// A drag the system takes away (a gesture, a dialog, the pointer leaving the window)
// sends pointercancel, not pointerup: a drag that hears only pointerup stays on.
ok('every drag that ends on pointerup also ends on pointercancel', (() => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = `${dir}/${entry.name}`
    if (entry.isDirectory()) return walk(full)
    return /\.(jsx?|tsx?)$/.test(entry.name) ? [full] : []
  })
  const src = new URL('../../src', import.meta.url).pathname
  const missing = walk(src).filter((file) => {
    const text = fs.readFileSync(file, 'utf8')
    return /addEventListener\(\s*['"]pointerup['"]|onPointerUp=/.test(text) && !/pointercancel|onPointerCancel/.test(text)
  })
  if (missing.length) console.log('  no pointercancel:', missing.map((file) => file.slice(src.length + 1)).join(', '))
  return missing.length === 0
})())

/* ---------------- CSS ---------------- */

ok('every spring has a linear() curve from 0 to 1', Object.values(SPRINGS).every((preset) => {
  const { easing, duration } = springEasing(preset)
  return easing.startsWith('linear(0,') && easing.endsWith(', 1)') && duration > 0
}))
ok('the --spring-* tokens are generated from these springs', (() => {
  const tokens = fs.readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8')
  return currentBlock(tokens) === springBlock()
})())
