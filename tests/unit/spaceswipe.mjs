/**
 * A sidebar's swipe between panels (useSpaceSwipe), after Arc's spaces: a quick
 * swipe-and-release turns one panel, a swipe held down travels through several, and
 * the momentum after a lift is swallowed rather than read as more swiping.
 *
 * The hook is mounted for real and fed wheel events the way WKWebView sends them —
 * no phases — with the lifts the app reports from AppKit simulated beside them.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true,
})
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent', 'Event'])
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act, useRef, useState, StrictMode } = await import('react')
const { createRoot } = await import('react-dom/client')
const swipeModule = await import('../../src/hooks/useSpaceSwipe.js')
const { default: useSpaceSwipe, settleIndex, rubberBand, liftVelocity, SWIPE_IDLE_END_MS } = swipeModule
const { simulateTrackpadPhase, knowsTrackpadPhases } = await import('../../src/lib/wheelPhase.js')

import { ok } from './assert.mjs'

/* ---------------- the rules ---------------- */

ok('a slow lift settles on the nearest panel', settleIndex(1.4, 0.1, 5) === 1 && settleIndex(1.6, -0.1, 5) === 2)
ok('a flick goes on to the next panel that way', settleIndex(1.2, 1, 5) === 2 && settleIndex(1.8, -1, 5) === 1)
ok('a flick from rest still turns one panel', settleIndex(2, 1, 5) === 3 && settleIndex(2, -1, 5) === 1)
ok('a flick past the ends stays inside', settleIndex(4.1, 2, 5) === 4 && settleIndex(-0.1, -2, 5) === 0)
ok('the panels give past the ends, but never far', rubberBand(-3, 5) > -0.3 && rubberBand(-0.1, 5) < 0 && rubberBand(2.5, 5) === 2.5)
ok('the lift speed is the last moments, not the whole swipe',
  Math.abs(liftVelocity([{ t: 0, x: 0 }, { t: 500, x: 50 }, { t: 540, x: 90 }, { t: 560, x: 110 }]) - 1) < 0.01)

/* ---------------- mounted ---------------- */

const PANEL = 200
let view = null
function Harness() {
  const [index, setIndex] = useState(0)
  const targetRef = useRef(null)
  const swipe = useSpaceSwipe({ targetRef, index, count: 5, panelWidth: PANEL, onSettle: setIndex })
  view = { index, ...swipe }
  return React.createElement('div', { id: 'pane', ref: targetRef })
}

const root = createRoot(document.getElementById('root'))
await act(async () => { root.render(React.createElement(StrictMode, null, React.createElement(Harness))) })
const pane = document.getElementById('pane')

let clock = 1000
const wheel = (deltaX, deltaY = 0, gap = 16) => {
  clock += gap
  const event = new dom.window.WheelEvent('wheel', { deltaX, deltaY, bubbles: true, cancelable: true })
  Object.defineProperty(event, 'timeStamp', { value: clock })
  act(() => { pane.dispatchEvent(event) })
  return event
}
const phase = (name) => act(() => { simulateTrackpadPhase(name) })
const wait = (ms) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))

// In a browser there are no phases: a pause in the wheel stands in for the lift.
{
  ok('no phases heard yet', !knowsTrackpadPhases())
  for (let i = 0; i < 6; i += 1) wheel(12, 0, 8)
  ok('without phases, the panels follow the fingers', view.dragging && view.progress > 0.2)
  await wait(SWIPE_IDLE_END_MS + 40)
  ok('and a pause lets go: the quick swipe turned one panel', !view.dragging && view.index === 1)
  clock += 1000
}

// In the app the lift is heard.
{
  phase('began')
  for (let i = 0; i < 4; i += 1) wheel(15, 0, 8)
  ok('a quick swipe moves the panels a little', view.progress > 1.1 && view.progress < 1.5 && view.index === 1)
  phase('ended')
  ok('letting go turns exactly one panel', view.index === 2 && view.progress === 2 && !view.dragging)
  phase('momentum')
  const coasts = [40, 35, 30, 25, 20, 15, 10, 5].map((dx) => wheel(dx, 0, 16))
  ok('its momentum is swallowed, not read as another swipe', coasts.every((event) => event.defaultPrevented) && view.index === 2)
  clock += 1000
}

{
  phase('began')
  const flick = []
  for (let i = 0; i < 6; i += 1) { wheel(150, 0, 8); flick.push(view.progress) }
  ok('a very fast flick never shows more than the next panel', flick.every((p) => p <= 3))
  phase('ended')
  ok('and turns exactly one panel', view.index === 3)
  phase('momentum')
  for (let i = 0; i < 6; i += 1) wheel(80, 0, 16)
  ok('its hard coast is swallowed too', view.index === 3)
  clock += 1000
  phase('began')
  for (let i = 0; i < 6; i += 1) wheel(-150, 0, 8)
  phase('ended')
  ok('a very fast flick back turns one panel back', view.index === 2)
  clock += 1000
}

{
  phase('began')
  const steps = []
  for (let i = 0; i < 90; i += 1) { wheel(5, 0, 16); steps.push(view.progress) }
  ok('held down, a swipe travels through several panels', steps.some((p) => p > 3.5) && view.dragging)
  phase('ended')
  ok('and lifted slowly, it settles on the nearest', view.index === 4)
  clock += 1000
}

{
  phase('began')
  for (let i = 0; i < 70; i += 1) wheel(-5, 0, 16)
  for (let i = 0; i < 4; i += 1) wheel(-20, 0, 8)
  ok('held most of the way back, then flicked', view.progress < 2.5 && view.progress > 1.5)
  phase('ended')
  ok('the flick carries it one panel further', view.index === 1)
  clock += 1000
}

{
  phase('began')
  const scrolls = [wheel(1, 8), wheel(1, 12), wheel(2, 14)]
  phase('ended')
  ok('scrolling up and down is left to the panel', scrolls.every((event) => !event.defaultPrevented) && view.index === 1)
  clock += 1000
}

{
  phase('began')
  for (let i = 0; i < 30; i += 1) wheel(-8, 0, 16)
  ok('past the first panel the swipe gives a little', view.progress < 0 && view.progress > -0.3)
  phase('ended')
  ok('and springs back', view.index === 0 && view.progress === 0)
  clock += 1000
}

{
  phase('began')
  for (let i = 0; i < 5; i += 1) wheel(6, 0, 16)
  act(() => { view.jumpTo(3) })
  ok('a click mid-swipe goes straight there', view.progress === 3 && !view.dragging)
  phase('ended')
}

await act(async () => { root.unmount() })

/* ---------------- the selector's indicator, grabbed and dragged ---------------- */

const { default: SidebarTabs } = await import('../../src/components/RightSidebar/SidebarTabs.jsx')
const TABS = ['a', 'b', 'c', 'd'].map((id) => ({ id, icon: 'file', label: id.toUpperCase() }))
const STEP = 50 // the indicator's width (46, stubbed below) and the 4px gap
dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
  return this.classList?.contains('sidebar-tabs-indicator')
    ? { left: 0, top: 0, right: 46, bottom: 28, width: 46, height: 28, x: 0, y: 0 }
    : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }
}

let strip = null
function Strip() {
  const [index, setIndex] = useState(0)
  const targetRef = useRef(null)
  const swipe = useSpaceSwipe({ targetRef, index, count: TABS.length, panelWidth: PANEL, onSettle: setIndex })
  strip = { index, ...swipe }
  return React.createElement('div', { ref: targetRef }, React.createElement(SidebarTabs, {
    tabs: TABS,
    tab: TABS[index].id,
    setTab: (id) => setIndex(TABS.findIndex((t) => t.id === id)),
    visualProgress: swipe.progress,
    gestureActive: swipe.dragging,
    onIndicatorDrag: swipe.follow,
    onIndicatorDrop: swipe.settle,
  }))
}

const stripRoot = createRoot(document.getElementById('root'))
await act(async () => { stripRoot.render(React.createElement(StrictMode, null, React.createElement(Strip))) })
const indicator = document.querySelector('.sidebar-tabs-indicator')
const pointer = (type, clientX) => act(() => {
  indicator.dispatchEvent(new dom.window.MouseEvent(type, { clientX, button: 0, bubbles: true, cancelable: true }))
})

pointer('pointerdown', 100)
pointer('pointermove', 101)
ok('a press that barely moves is not a drag', !strip.dragging && strip.index === 0)
pointer('pointermove', 100 + STEP * 1.5)
ok('dragged, the panels follow the indicator', strip.dragging && Math.abs(strip.progress - 1.5) < 0.01)
ok('and the strip shows it is held', !!document.querySelector('.sidebar-tabs.is-grabbing'))
pointer('pointermove', 100 + STEP * 2.3)
pointer('pointerup', 100 + STEP * 2.3)
ok('letting go chooses the tab it is over', strip.index === 2 && strip.progress === 2 && !strip.dragging)

pointer('pointerdown', 100)
pointer('pointermove', 100 - STEP * 5)
ok('dragged past the first tab it gives, but only a little', strip.progress < 0 && strip.progress > -0.3)
pointer('pointerup', 100 - STEP * 5)
ok('and lands on the first', strip.index === 0)

pointer('pointerdown', 100)
pointer('pointerup', 100)
ok('a press without a drag changes nothing', strip.index === 0 && !strip.dragging)

await act(async () => { stripRoot.unmount() })
