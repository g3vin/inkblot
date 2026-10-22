/**
 * The ink wheel (src/ui/InkWheel.jsx): the arithmetic of the ring and the drag, and the
 * control mounted —
 *
 *   - where the slots sit, which one a direction points at, and the hysteresis that
 *     keeps a hand on a boundary from flickering between two;
 *   - the drag: the held dot gives without reaching the ring, the ink ahead leans in,
 *     far enough they swap, pulled back the swap undoes, and swinging round trades it
 *     to the next ink;
 *   - the keyboard: opened from the control, turned with the arrows and digits, taken
 *     with Enter, left with Escape and focus back on the control;
 *   - a mouse drag (the cursor-hidden path, since jsdom has no Pointer Lock): swap and
 *     let go takes the ink; swap, swipe back and let go keeps the old one.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'
import { ok } from './assert.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent'])
globalThis.IS_REACT_ACT_ENVIRONMENT = true
// Reduced motion: the wheel opens and closes without waiting on its animations.
window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })

const G = await import('../../src/ui/inkWheelGeometry.js')

/* ---------------- the ring ---------------- */

const near = (a, b) => Math.abs(a - b) < 0.01
ok('the first slot is at twelve o\'clock', near(G.slotOffset(0, 8).x, 0) && near(G.slotOffset(0, 8).y, -52))
ok('slots run clockwise: the third of eight is at three o\'clock', near(G.slotOffset(2, 8).x, 52) && near(G.slotOffset(2, 8).y, 0))
ok('nine slots sit on a wider ring', G.ringRadius(9) > G.ringRadius(8))

ok('inside the dead zone nothing is pointed at', G.pickSlot({ x: 2, y: -3 }, 8) === null)
ok('straight up points at the first slot', G.pickSlot({ x: 0, y: -20 }, 8) === 0)
ok('straight left points at the seventh of eight', G.pickSlot({ x: -20, y: 0 }, 8) === 6)
const past = (deg) => ({ x: 30 * Math.sin((deg * Math.PI) / 180), y: -30 * Math.cos((deg * Math.PI) / 180) })
ok('just past a boundary, the current slot holds', G.pickSlot(past(25), 8, 0) === 0)
ok('clearly past it, the next slot takes over', G.pickSlot(past(30), 8, 0) === 1)
ok('without a current slot the nearest wins', G.pickSlot(past(25), 8) === 1)
ok('nine slots are 40° apart', G.pickSlot(past(40), 9) === 1)

const clamped = G.clampToReach({ x: 300, y: 400 }, 30)
ok('the hand\'s travel stops at its reach, still pointing the same way', near(clamped.x, 18) && near(clamped.y, 24))
ok('within reach it is left alone', G.clampToReach({ x: 3, y: 4 }, 30).x === 3)

/* ---------------- the drag ---------------- */

const held = (x) => Math.hypot(G.heldOffset({ x, y: 0 }).x, 0)
ok('the held dot gives a little, then less', held(10) > 0 && held(20) - held(10) > held(G.REACH) - held(G.REACH - 10))
ok('it never gets as far as the ring, so two dots at rest never cover each other',
  held(G.REACH) + G.CENTRE / 2 < G.ringRadius(8) - G.LEAN_MAX - (G.DOT / 2) * (1 + G.LEAN_GROW))

ok('an ink leans toward a hand aimed straight at it', near(G.leanFor(2, 8, { x: G.SWAP_AT, y: 0 }), 1))
ok('its neighbours barely do', G.leanFor(1, 8, { x: G.SWAP_AT, y: 0 }) < 0.3)
ok('the ink behind the hand not at all', G.leanFor(6, 8, { x: G.SWAP_AT, y: 0 }) === 0)
const between = G.leanFor(2, 8, { x: 20, y: -8.3 })
ok('aiming between two inks, each leans part way (no snap between them)', between > 0 && between < 1 && near(between, G.leanFor(1, 8, { x: 8.3, y: -20 })))

let drag = G.dragState({ x: G.SWAP_AT - 2, y: 0 }, 8)
ok('heading for an ink, not far enough: a target, no swap', drag.target === 2 && drag.swapped === null)
drag = G.dragState({ x: G.SWAP_AT, y: 0 }, 8, drag)
ok('far enough, they swap', drag.swapped === 2)
drag = G.dragState({ x: G.UNSWAP_AT + 1, y: 0 }, 8, drag)
ok('easing off a little keeps the swap', drag.swapped === 2)
drag = G.dragState({ x: G.UNSWAP_AT - 1, y: 0 }, 8, drag)
ok('pulled back far enough, the swap undoes', drag.swapped === null)
drag = G.dragState({ x: G.REACH, y: 0 }, 8, drag)
const diagonal = G.REACH / Math.SQRT2
drag = G.dragState({ x: diagonal, y: diagonal }, 8, drag)
ok('swinging round trades the swap to the next ink', drag.swapped === 3)

ok('a tap on a dot lands on it', G.hitSlot({ x: 50, y: 4 }, 8) === 2)
ok('a tap between dots lands on none', G.hitSlot({ x: 0, y: 0 }, 8) === null)
ok('stepping wraps round the ring', G.stepSlot(7, 1, 8) === 0 && G.stepSlot(0, -1, 8) === 7)
ok('stepping from nothing starts at an end', G.stepSlot(null, 1, 8) === 0 && G.stepSlot(null, -1, 8) === 7)

const placed = G.placeRing({ x: 4, y: 500 }, { left: 72, right: 72, top: 72, bottom: 72 }, { width: 800, height: 600 })
ok('a ring by the window\'s edge is nudged in just far enough', placed.x === 80 && placed.y === 500)

/* ---------------- mounted ---------------- */

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: InkWheel } = await import('../../src/ui/InkWheel.jsx')

const container = document.getElementById('root')
const root = createRoot(container)
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)) })
let picks = []
const mount = (props) => act(async () => root.render(React.createElement(InkWheel, {
  label: 'Note colour', value: 'amber', onChange: (id) => picks.push(id), ...props,
})))
const trigger = () => container.querySelector('button')
const ring = () => document.querySelector('[role="listbox"]')
const key = (k) => act(async () => ring().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })))
const active = () => document.getElementById(ring().getAttribute('aria-activedescendant'))?.getAttribute('aria-label')

await mount()
ok('the control names the colour it shows', trigger().getAttribute('aria-label') === 'Note colour: Amber')
await act(async () => trigger().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })))
ok('Enter on the control opens the ring', Boolean(ring()) && trigger().getAttribute('aria-expanded') === 'true')
ok('focus goes to the ring', document.activeElement === ring())
ok('the keyboard starts on the current ink', active() === 'Amber')
ok('the current ink is the selected option', document.querySelector('[aria-selected="true"]')?.getAttribute('aria-label') === 'Amber')
await key('ArrowRight')
ok('→ turns clockwise', active() === 'Rust')
await key('ArrowLeft')
await key('ArrowLeft')
ok('← turns back', active() === 'Green')
await key('1')
ok('a digit jumps to its place', active() === 'Ink Blue')
await key('Enter')
await settle()
ok('Enter takes the ink', picks.join() === 'blue')
ok('and the ring is gone, focus back on the control', !ring() && document.activeElement === trigger())

picks = []
await act(async () => trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
ok('↓ on the control opens it too', Boolean(ring()))
await key('ArrowRight')
await key('Escape')
await settle()
ok('Escape leaves the colour as it was', picks.length === 0 && !ring())

await mount({ value: null, none: { label: 'No fill' } })
await act(async () => trigger().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })))
ok('"none" is the last place, and current when the value is null', active() === 'No fill')
await key('2')
await key('Enter')
await settle()
ok('an ink taken over "none"', picks.at(-1) === 'teal')

await mount({ value: 'teal', none: { label: 'No fill' } })
await act(async () => trigger().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })))
await key('9')
await key('Enter')
await settle()
ok('taking "none" gives null', picks.at(-1) === null)

// A mouse drag. jsdom lays nothing out, so the control is at (0, 0) and the ring is
// nudged in to (80, 80); the third ink (Green) is straight to its right.
const pointer = (type, x, y, target = window) => act(async () => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 })
  Object.defineProperty(event, 'pointerType', { value: 'mouse' })
  target.dispatchEvent(event)
})
picks = []
await mount()
await pointer('pointerdown', 0, 0, trigger())
ok('a press on the control opens the ring under a hidden pointer', document.querySelector('.ib-ink-wheel')?.dataset.mode === 'mouse')
const far = 80 + G.SWAP_AT + 2
await pointer('pointermove', 80 + G.SWAP_AT - 4, 80)
ok('short of an ink, it is only the target', document.querySelector('[data-target="true"]')?.getAttribute('aria-label') === 'Green')
const green = () => document.querySelector('[aria-label="Green"]')
ok('and it leans in', parseFloat(green().style.getPropertyValue('--tx')) < G.ringRadius(8) && parseFloat(green().style.getPropertyValue('--scale')) > 1)
await pointer('pointermove', far, 80)
ok('far enough, they swap: the ink is in hand', green().dataset.inHand === 'true')
await pointer('pointerup', far, 80)
await settle()
ok('letting go takes it', picks.join() === 'green' && !ring())

picks = []
await pointer('pointerdown', 0, 0, trigger())
await pointer('pointermove', far, 80)
await pointer('pointermove', 83, 80)
ok('swiping back undoes the swap', !document.querySelector('[data-in-hand]'))
await pointer('pointerup', 83, 80)
await settle()
ok('and letting go then keeps the old colour', picks.length === 0 && !ring())

await pointer('pointerdown', 0, 0, trigger())
await pointer('pointerup', 0, 0)
ok('a click leaves it open for the swipe', Boolean(ring()))
await pointer('pointermove', 80, far)
await pointer('pointerdown', 80, far)
await pointer('pointerup', 80, far)
await settle()
ok('and a second click takes the ink swapped in', picks.join() === 'rust' && !ring())

await act(async () => root.unmount())
