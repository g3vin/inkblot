/**
 * mapdom — the real MapPane, mounted in jsdom under StrictMode (as main.jsx does).
 *
 * The risks a map document adds are about the file, not the pixels: a map that went
 * through the text autosave would be wiped, a text document that happens to be named
 * `Something.map` must never be written over, and an edit has to reach the disk as a
 * map. Around those it checks the things a first session exercises: the pins show,
 * the tool bar places a pin, undo takes it back, and a new map asks what it is.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true,
})
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node',
  'SVGElement', 'DOMParser', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle',
  'CustomEvent', 'Event', 'MouseEvent', 'KeyboardEvent', 'ResizeObserver'])
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
// jsdom does no layout: give the surface a size so fitting and pointer maths have one.
const rect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 })
dom.window.Element.prototype.getBoundingClientRect = rect
dom.window.HTMLElement.prototype.focus = function () {}

const React = (await import('react')).default
const { act, StrictMode } = await import('react')
const { createRoot } = await import('react-dom/client')
const MapPane = (await import('../../src/map/MapPane.jsx')).default
const ToolbarHost = (await import('../../src/components/toolbar/ToolbarHost.jsx')).default
const { documentSurface } = await import('../../src/bridge/index.ts')
const { mapDelegates } = await import('../../src/bridge/mapDelegates.ts')
// As EditorCanvas installs them: a map command finds its map by surface id.
documentSurface.setDelegates({ ...mapDelegates })
const { createEmptyMap, makePin, serializeMap } = await import('../../src/lib/map/mapModel.js')
const { files } = await import('./stub-fs.mjs')

const ok = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) process.exitCode = 1 }
const settle = (ms = 60) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

const P = 'Maps'
const path = (rel) => `/appdata/${P}/${rel}.json`

const mount = async (docPath) => {
  const root = createRoot(document.getElementById('root'))
  await act(async () => {
    // The map's tools are the titlebar toolbar's, drawn from what the map publishes.
    root.render(React.createElement(StrictMode, null,
      React.createElement(ToolbarHost, { context: 'map', hasProject: true }),
      React.createElement(MapPane, { projectName: P, docPath, onActivate: () => {}, onOpenDoc: () => {} })))
  })
  await settle()
  return root
}

const pins = () => document.querySelectorAll('[data-map-kind="pin"]')
const button = (label) => [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label)
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
const pointer = (type, target, x, y) => {
  const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 })
  target.dispatchEvent(event)
}

/* ---------------- a map with two places ---------------- */

const seeded = createEmptyMap('blank')
seeded.pins = [makePin({ at: [1000, 1000], name: 'Rivendell' }), makePin({ at: [3000, 2000], name: 'Mordor' })]
files.set(path('World.map'), JSON.stringify(serializeMap(seeded, { x: 0, y: 0, zoom: 1 })))

let root = await mount('World.map')
const surface = () => document.querySelector('.map-surface')
ok('the surface mounts', !!surface() && !surface().classList.contains('is-loading'))
ok('the svg is there', !!document.querySelector('svg.map-svg'))
ok('both places render', pins().length === 2)
ok('the tool bar renders', !!document.querySelector('[role="toolbar"][data-context="map"]'))
ok('a finished map does not ask what it is', !document.querySelector('.map-setup'))

/* ---- place a pin with the tool bar ---- */

await act(async () => { click(button('Place')) })
await settle()
ok('the Place tool is pressed', button('Place')?.getAttribute('aria-pressed') === 'true')

await act(async () => {
  pointer('pointerdown', surface(), 400, 300)
  pointer('pointerup', dom.window, 400, 300)
})
await settle()
ok('a click with Place adds a pin', pins().length === 3)

/* ---- it reaches the disk, as a map ---- */

await settle(1000)
const saved = JSON.parse(files.get(path('World.map')) || 'null')
ok('the edit is saved after the debounce', saved?.pins?.length === 3)
ok('it is saved as a map, not a text document', saved?.type === 'map' && !('content' in saved))
ok('the names come through the save', saved.pins.some((pin) => pin.name === 'Rivendell'))

/* ---- undo ---- */

await act(async () => {
  surface().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }))
})
await settle()
ok('⌘Z takes the pin back', pins().length === 2)
await act(async () => { click(button('Redo')) })
await settle()
ok('Redo puts it back', pins().length === 3)

// Unmounting flushes the pending save: nothing is lost by closing straight away.
await act(async () => { click(button('Undo')) })
await act(async () => { root.unmount() })
await settle()
ok('closing flushes the last edit', JSON.parse(files.get(path('World.map'))).pins.length === 2)

/* ---------------- a text document that is only named like a map ---------------- */

const chapter = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'X marks the spot.' }] }] })
files.set(path('Treasure.map'), chapter)
root = await mount('Treasure.map')
ok('a text document named .map is recognised as not a map', !!document.querySelector('.map-foreign'))
ok('no map surface is mounted over it', !document.querySelector('.map-surface'))
await act(async () => { root.unmount() })
await settle(1000)
ok('and it is never written over', files.get(path('Treasure.map')) === chapter)

/* ---------------- a new map asks what it is ---------------- */

const fresh = createEmptyMap('blank', { setupPending: true })
files.set(path('New.map'), JSON.stringify(serializeMap(fresh, { x: 0, y: 0, zoom: 1 })))
root = await mount('New.map')
ok('a new map opens on the setup chooser', !!document.querySelector('.map-setup'))
await act(async () => { root.unmount() })
await settle()
