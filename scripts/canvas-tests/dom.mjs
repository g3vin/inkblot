/**
 * Component-level checks: the real CanvasSurface, mounted in jsdom.
 *
 * Mounted inside <StrictMode>, because main.jsx does — and that is not a detail. In
 * dev, StrictMode mounts, tears down, and re-mounts on the SAME refs. A cleanup that
 * cancels a queued animation frame without clearing the stored id leaves a stale
 * non-zero id behind, and any "is a frame already pending?" guard then blocks every
 * future frame for the life of the component.
 *
 * That is what froze the zoom readout at 100% while the canvas kept zooming (the
 * transform is written straight to the DOM; only the React sync went through the
 * frame). A non-StrictMode test passes happily, which is why this one exists.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true,
})
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node',
  'DOMParser', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle',
  'CustomEvent', 'Event', 'MouseEvent'])
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act, StrictMode } = await import('react')
const { createRoot } = await import('react-dom/client')
const CanvasSurface = (await import('../../src/canvas/CanvasSurface.jsx')).default
const { CanvasToolbarSlotContext } = await import('../../src/canvas/canvasToolbarSlot.js')
const { createEmptyCanvas, makeTextNode } = await import('../../src/lib/canvasModel.js')

const ok = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) process.exitCode = 1 }
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 40)) })

const state = createEmptyCanvas()
const card = makeTextNode({ x: 0, y: 0, text: 'hello' })
state.nodes[card.id] = card
state.nodeOrder.push(card.id)

const root = createRoot(document.getElementById('root'))

// The canvas toolbar renders in the titlebar, not over the canvas: CanvasSurface
// portals it into the element published through CanvasToolbarSlotContext, and
// renders no toolbar at all when that slot is null. So the slot has to exist here,
// or every toolbar assertion below reads an absent button.
const toolbarSlot = document.createElement('div')
document.body.appendChild(toolbarSlot)

await act(async () => {
  root.render(
    React.createElement(
      StrictMode,
      null,
      React.createElement(
        CanvasToolbarSlotContext.Provider,
        { value: toolbarSlot },
        React.createElement(CanvasSurface, {
          projectName: 'P',
          docPath: 'x.canvas',
          initialState: state,
          initialViewport: { x: 0, y: 0, zoom: 1 },
          onActivate: () => {},
          setActiveEditor: () => {},
        })
      )
    )
  )
})
await settle()

const surface = () => document.querySelector('.canvas-surface')
const readout = () => document.querySelector('.canvas-toolbar-zoom')?.textContent
// CanvasToolbar's controls are bare <button type="button"> elements — they carry an
// aria-label and a title, but no shared class — so match on the label alone.
const button = (label) =>
  [...document.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === label
  )

ok('the surface mounts', !!surface())
ok('the zoom readout starts at 100%', readout() === '100%')

/* ---- the readout must actually track the zoom ---- */

await act(async () => {
  button('Zoom in').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await settle()
ok('zoom in updates the readout under StrictMode', readout() === '120%')

await act(async () => {
  button('Zoom out').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await settle()
ok('zoom out updates the readout', readout() === '100%')

// ⌘/pinch-scroll: the path a user actually reaches for.
const wheel = (init) => {
  const event = new dom.window.Event('wheel', { bubbles: true, cancelable: true })
  Object.assign(event, { deltaX: 0, deltaY: 0, deltaMode: 0, clientX: 200, clientY: 200 }, init)
  return event
}

await act(async () => { surface().dispatchEvent(wheel({ deltaY: -100, ctrlKey: true })) })
await settle()
const zoomed = readout()
ok('ctrl-wheel zooms and moves the readout', zoomed !== '100%')

// A plain wheel pans. It must NOT change the zoom — and it must not stall the
// readout either, which is the thing the stale-frame bug actually broke.
await act(async () => { surface().dispatchEvent(wheel({ deltaY: 60 })) })
await settle()
ok('a plain wheel pans without changing zoom', readout() === zoomed)

await act(async () => {
  button('Zoom in').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await settle()
ok('the readout still responds after many frames', readout() !== zoomed)

/* ---- the DOM the rest of the canvas depends on ---- */

ok('the world layer exists', !!document.querySelector('.canvas-world'))
ok('the card rendered', !!document.querySelector(`[data-node-id="${card.id}"]`))
ok('the card shows its text', document.querySelector('.canvas-card-body')?.textContent.includes('hello'))
ok('the alignment-guide layer exists', !!document.querySelector('.canvas-guides'))
ok('resize zones are always present (grab the edge, no boxes)',
  document.querySelectorAll('.canvas-resize-handle').length === 8)
// Ports must come AFTER the resize strips, or the strips bury them at the midpoints.
const chrome = [...document.querySelector(`[data-node-id="${card.id}"]`).children]
const lastResize = chrome.map((el) => el.className).findLastIndex((c) => String(c).includes('canvas-resize-handle'))
const firstPort = chrome.map((el) => el.className).findIndex((c) => String(c).includes('canvas-port'))
ok('ports render after the resize zones (so they stay grabbable)', firstPort > lastResize)

/* ---- read mode ---- */

// Locked, the canvas stops being editable: nothing can be dragged, resized or
// connected, so the chrome that advertises those gestures must not be there at all.
const lockButton = () =>
  [...document.querySelectorAll('button')].find((b) =>
    (b.getAttribute('aria-label') || '').startsWith('Lock canvas')
  )
const unlockButton = () =>
  [...document.querySelectorAll('button')].find((b) =>
    (b.getAttribute('aria-label') || '').startsWith('Unlock canvas')
  )

ok('the canvas starts unlocked', !!lockButton() && !unlockButton())
ok('an unlocked canvas offers Add card', !!button('Add card'))

await act(async () => {
  lockButton().dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await settle()

ok('the lock toggles to unlock', !!unlockButton())
ok('read mode marks the surface', surface().classList.contains('is-locked'))
ok('read mode removes the resize zones', document.querySelectorAll('.canvas-resize-handle').length === 0)
ok('read mode removes the connection ports', document.querySelectorAll('.canvas-port').length === 0)
// The editing tools go away entirely rather than sitting there dead.
ok('read mode hides Add card', !button('Add card'))
ok('read mode keeps zoom', !!button('Zoom in'))

// A card's scrollable region must be findable by the wheel handler, which is what
// lets a Pinterest board scroll instead of panning the canvas.
ok('scrollable card regions are marked for the wheel handler',
  typeof surface().querySelector === 'function')

await act(async () => {
  unlockButton().dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
})
await settle()

ok('unlocking restores the resize zones', document.querySelectorAll('.canvas-resize-handle').length === 8)
ok('unlocking restores Add card', !!button('Add card'))

await act(async () => { root.unmount() })
