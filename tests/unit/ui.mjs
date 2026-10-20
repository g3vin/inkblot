/**
 * The shared controls (src/ui): the reorder and placement math, the native-menu
 * builder, and the controls mounted — a Segmented moved with the keyboard, a Section
 * that remembers being closed, a Dialog that Escape closes.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'
import { setInvokeHandler } from './stub-core.mjs'
import { ok } from './assert.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent', 'CSS'])
if (!globalThis.CSS) globalThis.CSS = { escape: (s) => String(s).replace(/"/g, '\\"') }
if (!globalThis.CSS.escape) globalThis.CSS.escape = (s) => String(s).replace(/"/g, '\\"')
globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} })

setInvokeHandler(async (command) => (command === 'preferences_load' ? { app: {} } : null))
const prefs = await import('../../src/lib/preferences.ts')
if (!prefs.isHydrated()) await prefs.hydratePreferences()

const React = (await import('react')).default
const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const { insertionIndex, moveTo } = await import('../../src/ui/usePointerReorder.js')
const { placePopover } = await import('../../src/ui/placePopover.js')
const { buildNativeMenu } = await import('../../src/ui/useNativeMenu.js')
const { default: Segmented } = await import('../../src/ui/Segmented.jsx')
const { default: Section } = await import('../../src/ui/Section.jsx')
const { SECTIONS_KEY } = await import('../../src/ui/sectionState.js')
const { default: Dialog } = await import('../../src/ui/Dialog.jsx')
const { default: Button } = await import('../../src/ui/Button.jsx')
const { Stepper } = await import('../../src/ui/FormRow.jsx')

/* ---------------- reorder math ---------------- */

const rects = [0, 50, 100].map((left) => ({ left, top: 0, width: 40, height: 20, right: left + 40, bottom: 20 }))
ok('before the first midpoint inserts first', insertionIndex({ x: 5, y: 5 }, rects) === 0)
ok('between two midpoints inserts between', insertionIndex({ x: 60, y: 5 }, rects) === 1)
ok('past the last midpoint inserts at the end', insertionIndex({ x: 130, y: 5 }, rects) === 3)
ok('the y axis reads tops', insertionIndex({ x: 999, y: 5 }, rects.map((r, i) => ({ ...r, top: i * 30, height: 20 })), 'y') === 0)

ok('moving forward accounts for the gap it leaves', moveTo(['a', 'b', 'c', 'd'], 'a', 3).join('') === 'bcad')
ok('moving back', moveTo(['a', 'b', 'c', 'd'], 'd', 1).join('') === 'adbc')
ok('moving to the end', moveTo(['a', 'b', 'c'], 'a', 3).join('') === 'bca')
ok('a new id is inserted', moveTo(['a', 'b'], 'x', 1).join('') === 'axb')

/* ---------------- popover placement ---------------- */

const viewport = { width: 800, height: 600 }
let at = placePopover({ left: 100, right: 140, top: 10, bottom: 30, width: 40 }, { width: 200, height: 100 }, viewport)
ok('a popover opens under its anchor', at.top === 36 && at.left === 100)
at = placePopover({ left: 700, right: 740, top: 10, bottom: 30, width: 40 }, { width: 200, height: 100 }, viewport)
ok('and is kept on screen', at.left === 592)
at = placePopover({ left: 100, right: 140, top: 560, bottom: 580, width: 40 }, { width: 200, height: 100 }, viewport)
ok('and flips above when there is no room under it', at.top === 454)

/* ---------------- native menus ---------------- */

const made = []
const fake = (kind) => ({ new: async (opts) => { made.push({ kind, ...opts }); return { kind, ...opts } } })
const api = { Menu: fake('Menu'), MenuItem: fake('MenuItem'), CheckMenuItem: fake('CheckMenuItem'), PredefinedMenuItem: fake('Predefined'), Submenu: fake('Submenu') }
const menu = await buildNativeMenu([
  { text: 'Icon only', checked: true, action: () => {} },
  { separator: true },
  null,
  { text: 'More', items: [{ text: 'Inner', enabled: false }] },
], api)
ok('a checked item is a check item', menu.items[0].kind === 'CheckMenuItem' && menu.items[0].checked === true)
ok('a separator is predefined', menu.items[1].kind === 'Predefined')
ok('a null item is skipped', menu.items.length === 3)
ok('a submenu carries its items', menu.items[2].kind === 'Submenu' && menu.items[2].items[0].enabled === false)

/* ---------------- mounted ---------------- */

const container = document.getElementById('root')
const root = createRoot(container)

let chosen = null
function Choice() {
  const [value, setValue] = useState('a')
  chosen = value
  return React.createElement(Segmented, {
    value, onChange: setValue, label: 'Pick',
    options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B', disabled: true }, { value: 'c', label: 'C' }],
  })
}
await act(async () => root.render(React.createElement(Choice)))
const group = container.querySelector('[role="radiogroup"]')
ok('a segmented control is a radio group', group && group.querySelectorAll('[role="radio"]').length === 3)
await act(async () => group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
ok('→ skips a disabled segment', chosen === 'c')
await act(async () => group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
ok('and wraps round', chosen === 'a')
await act(async () => container.querySelector('[data-value="c"]').dispatchEvent(new MouseEvent('click', { bubbles: true })))
ok('a click chooses', chosen === 'c' && container.querySelector('[data-value="c"]').getAttribute('aria-checked') === 'true')

prefs.removePreference(SECTIONS_KEY)
await act(async () => root.render(React.createElement(Section, { id: 'test.margins', title: 'Margins' }, React.createElement('p', null, 'body'))))
ok('a section is open by default', container.textContent.includes('body'))
await act(async () => container.querySelector('.ui-section-header').dispatchEvent(new MouseEvent('click', { bubbles: true })))
ok('a click closes it', !container.textContent.includes('body'))
ok('and that is remembered', JSON.parse(prefs.getPreference(SECTIONS_KEY))['test.margins'] === false)
await act(async () => root.render(React.createElement('div')))
await act(async () => root.render(React.createElement(Section, { id: 'test.margins', title: 'Margins' }, React.createElement('p', null, 'body'))))
ok('it reopens closed', !container.textContent.includes('body'))

let stepped = null
await act(async () => root.render(React.createElement(Stepper, { value: 1, step: 0.25, min: 0, max: 2, label: 'Margin', onChange: (v) => { stepped = v } })))
await act(async () => container.querySelector('[aria-label="Increase Margin"]').dispatchEvent(new MouseEvent('click', { bubbles: true })))
ok('a stepper steps', stepped === 1.25)

let closed = 0
await act(async () => root.render(React.createElement(Dialog, { title: 'Customize', onClose: () => { closed += 1 } }, React.createElement('button', null, 'Inside'))))
ok('a dialog is a modal dialog in the body', document.body.querySelector('[role="dialog"][aria-modal="true"]') !== null)
ok('and focuses its first control, not the ×', document.activeElement?.textContent === 'Inside')
ok('with no footer, it shows a ×', document.body.querySelector('.ib-dialog-close') !== null)
ok('and the app behind is inert', !document.getElementById('root') || document.getElementById('root').hasAttribute('inert'))
await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
ok('Escape closes it', closed === 1)

const footer = React.createElement(React.Fragment, null, React.createElement(Button, null, 'Cancel'), React.createElement(Button, { variant: 'filled' }, 'Rename'))
await act(async () => root.render(React.createElement(Dialog, { title: 'Rename', size: 'small', footer, onClose: () => {} }, 'body')))
ok('a footer that closes it means no ×', document.body.querySelector('.ib-dialog-close') === null)
ok('a small dialog with two footer buttons is the shared-width kind', document.body.querySelector('.ib-dialog--small .ib-dialog-footer')?.children.length === 2)
ok('sizes are named', document.body.querySelector('.ib-dialog--small') !== null)
await act(async () => root.render(React.createElement(Dialog, { title: 'Export', footer, footerCloses: false, onClose: () => {} }, 'body')))
ok('a footer that does not close it keeps the ×', document.body.querySelector('.ib-dialog-close') !== null)

await act(async () => root.unmount())
