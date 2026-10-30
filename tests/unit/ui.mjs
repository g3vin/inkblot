/**
 * The shared controls (src/ui): the reorder and placement math, the native-menu
 * builder, and the controls mounted — a Segmented moved with the keyboard, a Section
 * that remembers being closed, a Dialog that Escape closes, a Popover that takes focus.
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
const { buildNativeMenu, popUpMenu } = await import('../../src/ui/useNativeMenu.js')
const { default: Segmented } = await import('../../src/ui/Segmented.jsx')
const { default: Section } = await import('../../src/ui/Section.jsx')
const { SECTIONS_KEY } = await import('../../src/ui/sectionState.js')
const { default: Dialog } = await import('../../src/ui/Dialog.jsx')
const { default: Popover } = await import('../../src/ui/Popover.jsx')
const { ToolbarDockContext } = await import('../../src/ui/layer.js')
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

// A Popover: the one surface, an eyebrow, focus inside, Escape.
const anchor = document.createElement('button')
document.body.append(anchor)
const anchorRef = { current: anchor }
let popClosed = 0
let escaped = 0
await act(async () => root.render(React.createElement(Popover, { open: true, anchorRef, eyebrow: 'Cell fill', onClose: () => { popClosed += 1 } }, React.createElement('button', null, 'Blue'))))
await act(async () => new Promise((resolve) => requestAnimationFrame(resolve)))
const pop = document.body.querySelector('.ib-popover')
ok('a popover is the one pop-up surface', pop !== null && !document.body.querySelector('.ui-popover'))
ok('with its eyebrow', pop?.querySelector('.ib-popover-eyebrow')?.textContent === 'Cell fill')
ok('and focus moves into it', pop?.contains(document.activeElement))
await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
ok('Escape closes it', popClosed === 1)
await act(async () => root.render(React.createElement(Popover, { open: false, anchorRef, onClose: () => {} })))
ok('closed, it is gone (only its leaving copy stays a moment)', document.body.querySelector('.ib-popover:not(.is-leaving)') === null)
ok('and that copy is inert', document.body.querySelector('.ib-popover.is-leaving')?.inert !== false)
ok('and focus is back on the opener', document.activeElement === anchor)
await act(async () => root.render(React.createElement(Popover, { open: true, anchorRect: { left: 10, right: 10, top: 10, bottom: 10, width: 0, height: 0 }, onClose: () => { popClosed += 1 }, onEscape: () => { escaped += 1 } }, 'note')))
await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
ok('onEscape replaces closing on Escape', escaped === 1 && popClosed === 1)
// Opened inside a dialog, a popover is in the dialog's layer, and Escape closes it first.
let dialogClosed = 0
function InDialog() {
  const ref = React.useRef(null)
  const [open, setOpen] = useState(false)
  return React.createElement(Dialog, { title: 'Page setup', onClose: () => { dialogClosed += 1 } },
    React.createElement('button', { ref, onClick: () => setOpen(true) }, 'Units'),
    React.createElement(Popover, { open, anchorRef: ref, onClose: () => setOpen(false) }, React.createElement('button', null, 'Inches')))
}
await act(async () => root.render(React.createElement(InDialog)))
await act(async () => [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Units').dispatchEvent(new MouseEvent('click', { bubbles: true })))
const inner = document.body.querySelector('.ib-popover:not(.is-leaving)')
ok('a popover opened in a dialog renders in its layer', inner?.parentElement?.classList.contains('ib-dialog-scrim'))
inner?.focus()
await act(async () => inner.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
ok('and Escape closes the popover, not the dialog', dialogClosed === 0 && !document.body.querySelector('.ib-popover:not(.is-leaving)'))
// Opened from a toolbar's row, a Popover opens in the toolbar (DESIGN.md §6): in place
// beside its button, with no heading, or across the whole toolbar when it asks to.
const whole = document.createElement('div')
const besideItem = document.createElement('div')
document.body.append(whole, besideItem)
let pushedOut = null
const toolbarDock = {
  whole,
  owns: () => true,
  inlineFor: () => besideItem,
  watch: (_anchor, onOut) => { pushedOut = onOut; return () => { pushedOut = null } },
}
function InToolbar({ form }) {
  const ref = React.useRef(null)
  const [open, setOpen] = useState(false)
  return React.createElement(ToolbarDockContext.Provider, { value: toolbarDock },
    React.createElement('button', { ref, onClick: () => setOpen((was) => !was) }, 'Colour'),
    React.createElement(Popover, { open, anchorRef: ref, onClose: () => setOpen(false), eyebrow: 'Card colour', dock: form ? 'whole' : undefined },
      form ? React.createElement('input', { 'aria-label': 'Voice' }) : React.createElement('button', null, 'Red')))
}
const colour = () => [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Colour')
await act(async () => root.render(React.createElement(InToolbar, { form: false })))
await act(async () => colour().dispatchEvent(new MouseEvent('click', { bubbles: true })))
ok('a choice opens in place, beside its button', besideItem.querySelector('.ib-dock[data-mode="inline"]') !== null && !document.body.querySelector('.ib-popover:not(.is-leaving)'))
ok('and its button stays pressed', colour().hasAttribute('data-opener'))
ok('in the toolbar it carries no heading', !besideItem.querySelector('.ib-eyebrow') && besideItem.querySelector('.ib-dock')?.getAttribute('aria-label') === 'Card colour')
await act(async () => colour().dispatchEvent(new MouseEvent('click', { bubbles: true })))
ok('pressing its button again closes it', !besideItem.querySelector('.ib-dock') && !colour().hasAttribute('data-opener'))
await act(async () => colour().dispatchEvent(new MouseEvent('click', { bubbles: true })))
await act(async () => pushedOut?.())
ok('its page turned away, it closes', !besideItem.querySelector('.ib-dock') && !whole.querySelector('.ib-dock'))
await act(async () => root.render(React.createElement(InToolbar, { form: true, key: 'form' })))
await act(async () => colour().dispatchEvent(new MouseEvent('click', { bubbles: true })))
const formDock = whole.querySelector('.ib-dock[data-mode="whole"]')
ok('asked to, it takes the whole toolbar, with a close button', formDock !== null && [...formDock.querySelectorAll('button')].some((b) => b.getAttribute('aria-label') === 'Close'))
await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
ok('and Escape puts it away', !whole.querySelector('.ib-dock'))
whole.remove()
besideItem.remove()

await act(async () => root.render(React.createElement('div')))
anchor.remove()

// A menu a button opens is drawn in the page; a right-click's is the OS's.
const opener = document.createElement('button')
opener.setAttribute('aria-label', 'Alignment')
document.body.append(opener)
let picked = null
await act(async () => { await popUpMenu({ type: 'click', currentTarget: opener }, [{ text: 'Align left', checked: true, action: () => {} }, { separator: true }, { text: 'Align right', action: () => { picked = 'right' } }]) })
const inPage = document.body.querySelector('.ib-menu[aria-label="Alignment"]')
ok('a button opens an in-page menu', inPage?.getAttribute('aria-label') === 'Alignment' && inPage.querySelectorAll('[role^="menuitem"]').length === 2)
await act(async () => [...inPage.querySelectorAll('[role^="menuitem"]')].find((b) => b.textContent.includes('Align right')).dispatchEvent(new MouseEvent('click', { bubbles: true })))
ok('and its items run', picked === 'right' && !document.body.querySelector('.ib-menu:not(.is-leaving)'))
const warn = console.warn
console.warn = () => {}
await act(async () => { await popUpMenu({ type: 'contextmenu', target: opener }, [{ text: 'Copy' }]) })
console.warn = warn
ok('a right-click does not draw one', !document.body.querySelector('.ib-menu:not(.is-leaving)'))
opener.remove()

await act(async () => root.unmount())
