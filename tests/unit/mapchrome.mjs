/**
 * mapchrome — a map's toolbar and inspector, drawn from what it publishes.
 *
 * The map draws neither itself: it publishes them as `mapChromeChanged` while it is
 * active and withdraws them when it goes, and takes every click back by id — a tool
 * chosen, a place picked from the list, a name typed, the way back, a tab, undo — over
 * the in-process wire the toolbar and the inspector's Map tab use.
 *
 * It also pins down the form builder's commit rules, which both inspectors rely on.
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
const rect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 })
dom.window.Element.prototype.getBoundingClientRect = rect
dom.window.HTMLElement.prototype.focus = function () {}

const React = (await import('react')).default
const { act, StrictMode } = await import('react')
const { createRoot } = await import('react-dom/client')
const MapPane = (await import('../../src/map/MapPane.jsx')).default
const { documentSurface, shellBridge } = await import('../../src/bridge/index.ts')
const { mapDelegates } = await import('../../src/bridge/mapDelegates.ts')
const { createEmptyMap, makePin, serializeMap } = await import('../../src/lib/map/mapModel.js')
const { createPanelBuilder, runPanelCommand } = await import('../../src/map/inspector/panelBuilder.js')
const { files } = await import('./stub-fs.mjs')

const ok = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) process.exitCode = 1 }
const settle = (ms = 60) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

documentSurface.setDelegates(mapDelegates)
const heard = []
const stopListening = shellBridge.on('mapChromeChanged', (payload) => heard.push(payload))
/** Every `mapChromeChanged` payload so far, oldest first. */
const chromes = () => heard
const latest = () => chromes().at(-1)?.state

const P = 'Maps'
const path = (rel) => `/appdata/${P}/${rel}.json`

const seeded = createEmptyMap('blank')
const rivendell = makePin({ at: [1000, 1000], name: 'Rivendell' })
seeded.pins = [rivendell, makePin({ at: [3000, 2000], name: 'Mordor' })]
files.set(path('World.map'), JSON.stringify(serializeMap(seeded, { x: 0, y: 0, zoom: 1 })))

const root = createRoot(document.getElementById('root'))
const render = (isActive, chromeWhileInactive = false) => act(async () => {
  root.render(React.createElement(StrictMode, null,
    React.createElement(MapPane, { projectName: P, docPath: 'World.map', onActivate: () => {}, onOpenDoc: () => {}, isActive, chromeWhileInactive })))
})
await render(true)
await settle()

const sectionIds = () => latest()?.panel.sections.map((section) => section.id) || []
const fieldById = (id) => {
  const walk = (fields) => {
    for (const field of fields) {
      if (field.payload?.id === id) return field
      if (field.type === 'group') {
        const found = walk(field.payload.fields)
        if (found) return found
      }
    }
    return null
  }
  for (const section of latest()?.panel.sections || []) {
    const found = walk(section.fields)
    if (found) return found
  }
  return null
}
const command = async (name, detail) => {
  const surfaceId = latest().surfaceId
  await act(async () => { shellBridge.send('mapCommand', { surfaceId, command: name, detail }) })
  await settle()
}

/* ---------------- the page draws neither ---------------- */

ok('the map mounts', !!document.querySelector('.map-surface:not(.is-loading)'))
ok('the page draws no tool bar', !document.querySelector('[role="toolbar"][aria-label="Map tools"]'))

/* ---------------- it publishes them ---------------- */

ok('the active map publishes its chrome', !!latest() && latest().active === true)
ok('with the tool in hand', latest()?.tool === 'select')
ok('and the zoom as the page writes it', /%|×/.test(latest()?.zoomLabel || ''))
ok('the settings come in four tabs', latest()?.panel.tabs.map((tab) => tab.id).join() === 'map,journeys,travel,style')
ok('the Map tab lists the places', sectionIds().includes('places') && !!fieldById(`places.${rivendell.id}`))
// A map never viewed opens by fitting itself, a frame after it mounts: a real change.
await settle(120)
const before = chromes().length
await settle(120)
ok('nothing is sent again while nothing changed', chromes().length === before)

/* ---------------- and takes clicks back ---------------- */

await command('tool', { tool: 'pin' })
ok('a tool chosen in the toolbar is the tool in hand', latest()?.tool === 'pin')
await command('tool', { tool: 'teleport' })
ok('a tool the map does not have is ignored', latest()?.tool === 'pin')

const reveals = latest().revealPanel
await command('panel-action', { id: `places.${rivendell.id}` })
ok('picking a place from the list edits it', latest()?.panel.title === 'Place' && latest()?.panel.canGoBack)
ok('and asks for the inspector to be shown', latest()?.revealPanel > reveals)
ok('there are no tabs while one thing is edited', latest()?.panel.tabs.length === 0)
ok('its name is in the form', fieldById('pin.name')?.payload.value === 'Rivendell')

await command('panel-field', { id: 'pin.name', value: 'Imladris' })
ok('a name typed natively renames it', fieldById('pin.name')?.payload.value === 'Imladris')
ok('and the toolbar can undo it', latest()?.canUndo === true)

await command('undo')
ok('Undo from the toolbar takes it back', fieldById('pin.name')?.payload.value === 'Rivendell')

await command('panel-back')
ok('Back returns to the map’s settings', latest()?.panel.tabs.length === 4 && !latest()?.panel.canGoBack)

await command('panel-tab', { id: 'style' })
ok('a tab chosen natively is shown', latest()?.panel.tab === 'style' && sectionIds().includes('compass'))
await command('panel-field', { id: 'compass.size', value: 9999 })
ok('a number is clamped as the page would', fieldById('compass.size')?.payload.value === 240)

/* ---------------- and withdraws them ---------------- */

await render(false)
await settle()
ok('an inactive map withdraws its chrome', chromes().at(-1) && !chromes().at(-1).state)
await render(true)
await settle()
ok('and publishes it again when it is active', !!latest())

// Beside a document in a split, the map keeps its inspector while the document is
// worked in; only the toolbar goes back to the document's.
await render(false, true)
await settle()
ok('a map beside the active document keeps publishing, marked not active',
  !!latest() && latest().active === false)
await render(true, true)
await settle()
ok('and is marked active again when it is', latest()?.active === true)
await act(async () => { root.unmount() })
await settle()
ok('a closed map leaves no chrome behind', !chromes().at(-1).state)

/* ---------------- the builder's commit rules ---------------- */

{
  const ui = createPanelBuilder()
  const got = []
  ui.number('n', 'N', 5, (value) => got.push(value), { min: 0, max: 10 })
  ui.number('e', 'E', 3, (value) => got.push(['e', value]), { allowEmpty: true })
  ui.number('f', 'F', 3, (value) => got.push(['f', value]))
  ui.text('t', 'T', 'same', (value) => got.push(['t', value]))
  runPanelCommand(ui.handlers, 'panel-field', { id: 'n', value: 50 })
  runPanelCommand(ui.handlers, 'panel-field', { id: 'n', value: 5 })
  runPanelCommand(ui.handlers, 'panel-field', { id: 'e', value: null })
  runPanelCommand(ui.handlers, 'panel-field', { id: 'f', value: null })
  runPanelCommand(ui.handlers, 'panel-field', { id: 't', value: 'same' })
  ok('a number past its max commits the max', got[0] === 10)
  ok('an unchanged number commits nothing', got.length === 2 && got[1][0] === 'e')
  ok('only an allowEmpty number can be cleared', got[1][1] === null && !got.some((entry) => entry[0] === 'f'))
  ok('unchanged text commits nothing', !got.some((entry) => entry[0] === 't'))
  ok('an id the panel no longer has is not an error', runPanelCommand(ui.handlers, 'panel-action', { id: 'gone' }) === false)
  const field = ui.choice('c', 'C', 'b', [{ value: 'a', label: 'A', group: 'G' }], () => {})
  ok('a field is type and payload, as the wire has it', field.type === 'choice' && field.payload.options[0].group === 'G')
}

stopListening()
