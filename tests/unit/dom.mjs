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

import { ok } from './assert.mjs'
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

/* Touch. A finger on the empty canvas pans; the Pencil does what the mouse
   does; a second finger ends the first one's pan, because two fingers are a pinch. */
{
  const world = () => document.querySelector('.canvas-world')
  const pointer = (target, type, { id, kind, x, y }) => {
    const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
    Object.defineProperty(event, 'pointerType', { value: kind })
    Object.defineProperty(event, 'pointerId', { value: id })
    target.dispatchEvent(event)
  }

  const before = world().style.transform
  await act(async () => {
    pointer(surface(), 'pointerdown', { id: 1, kind: 'touch', x: 100, y: 100 })
    pointer(dom.window, 'pointermove', { id: 1, kind: 'touch', x: 160, y: 130 })
  })
  await settle()
  const panned = world().style.transform
  ok('a finger on the empty canvas pans it', panned && panned !== before)
  ok('and draws no selection box', !document.querySelector('.canvas-marquee'))

  // A second finger lands: the pan ends, and the first finger no longer moves anything.
  await act(async () => {
    pointer(surface(), 'pointerdown', { id: 2, kind: 'touch', x: 300, y: 100 })
    pointer(dom.window, 'pointermove', { id: 1, kind: 'touch', x: 400, y: 400 })
  })
  await settle()
  ok('a second finger ends the pan — two fingers are a pinch', world().style.transform === panned)
  await act(async () => {
    pointer(dom.window, 'pointerup', { id: 1, kind: 'touch', x: 400, y: 400 })
    pointer(dom.window, 'pointerup', { id: 2, kind: 'touch', x: 300, y: 100 })
  })

  await act(async () => {
    pointer(surface(), 'pointerdown', { id: 3, kind: 'pen', x: 100, y: 100 })
    pointer(dom.window, 'pointermove', { id: 3, kind: 'pen', x: 200, y: 200 })
  })
  await settle()
  ok('the Pencil does not pan', world().style.transform === panned)
  await act(async () => { pointer(dom.window, 'pointerup', { id: 3, kind: 'pen', x: 200, y: 200 }) })
  await settle()
}

/* Stacking: Bring to Front / Send to Back, through the same command event the context menu and the bridge use. */
{
  const { dispatchCanvasCommand } = await import('../../src/canvas/canvasEvents.js')
  const order = () => [...document.querySelectorAll('.canvas-node[data-node-id]')]
    .map((element) => element.getAttribute('data-node-id'))

  // A new card is selected and on top.
  await act(async () => { dispatchCanvasCommand(surface(), 'add-card', {}) })
  await settle()
  const added = order().find((id) => id !== card.id)
  ok('a new card lands on top', order().at(-1) === added)

  await act(async () => { dispatchCanvasCommand(surface(), 'send-to-back', {}) })
  await settle()
  ok('Send to Back puts the selection under everything', order()[0] === added)

  await act(async () => { dispatchCanvasCommand(surface(), 'bring-to-front', {}) })
  await settle()
  ok('Bring to Front puts it back on top', order().at(-1) === added && order()[0] === card.id)
}

/* A file dropped from Finder in WKWebView: an HTML5 drop carrying a File, which Tauri
   never delivers (it swallows the drop and sends paths). */
{
  // jsdom loads no images, so measuring one would wait forever; fail it at once, which
  // is the path a broken image takes and still lands a node.
  globalThis.Image = class { set src(_url) { setTimeout(() => this.onerror?.()) } }
  const before = document.querySelectorAll('.canvas-node').length

  const drop = (type, files, types = ['Files']) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { types, files, dropEffect: 'none' } })
    Object.assign(event, { clientX: 10, clientY: 10 })
    surface().dispatchEvent(event)
    return event
  }

  const over = drop('dragover', [])
  ok('a drag carrying files is accepted, so WebKit does not navigate to the file', over.defaultPrevented)
  ok('a drag carrying anything else is left alone', !drop('dragover', [], ['text/plain']).defaultPrevented)

  const png = new File([new Uint8Array([137, 80, 78, 71])], 'photo.png', { type: 'image/png' })
  const text = new File(['hi'], 'notes.txt', { type: 'text/plain' })
  await act(async () => { drop('drop', [png, text]) })
  await settle()
  ok('a dropped image becomes a node, and a dropped text file does not',
    document.querySelectorAll('.canvas-node').length === before + 1)

  // A note dragged from the native Notes panel carries its URL.
  const { noteDragURL } = await import('../../src/canvas/canvasEvents.js')
  ok('a note URL names its document and note',
    JSON.stringify(noteDragURL('inkblot-note://note?doc=ch%2Fone&id=n1')) === '{"docPath":"ch/one","noteId":"n1"}')
  ok('and anything else is not a note', noteDragURL('https://example.com\nfile:///x.png') === null)

  const urlDrop = (uriList) => {
    const event = new dom.window.Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', {
      value: { types: ['text/uri-list'], files: [], getData: (type) => (type === 'text/uri-list' ? uriList : '') },
    })
    Object.assign(event, { clientX: 20, clientY: 20 })
    surface().dispatchEvent(event)
    return event
  }
  const withNote = document.querySelectorAll('.canvas-node').length
  let event
  await act(async () => { event = urlDrop('inkblot-note://note?doc=ch%2Fone&id=n1') })
  await settle()
  ok('dropping a native note makes a note card',
    event.defaultPrevented && document.querySelectorAll('.canvas-node').length === withNote + 1)
  await act(async () => { event = urlDrop('https://example.com') })
  ok('a plain link dropped on the canvas is left for someone else', !event.defaultPrevented)
}

await act(async () => { root.unmount() })
