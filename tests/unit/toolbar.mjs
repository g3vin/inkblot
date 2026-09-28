/**
 * The toolbars drawn from their layouts (src/components/toolbar).
 *
 *   - every item id has a component, and every component renders with nothing to
 *     show — disabled, never absent, in each display mode;
 *   - what a drag in Customize Toolbar… does to a layout;
 *   - the palette opens from the right-click menu's event, a display mode chosen
 *     there is saved, and a layout saved in one window shows in the toolbar.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'
import { setInvokeHandler } from './stub-core.mjs'
import { ok } from './assert.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent', 'getComputedStyle'])
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.CSS ??= { escape: (s) => String(s) }

setInvokeHandler(async (command) => (command === 'preferences_load' ? { app: {} } : null))
const prefs = await import('../../src/lib/preferences.ts')
if (!prefs.isHydrated()) await prefs.hydratePreferences()

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const L = await import('../../src/lib/chromeLayout.ts')
const { TOOLBAR_COMPONENTS } = await import('../../src/components/toolbar/registry.jsx')
const { default: ToolbarItem } = await import('../../src/components/toolbar/ToolbarItem.jsx')
const { default: ToolbarHost } = await import('../../src/components/toolbar/ToolbarHost.jsx')
const { applyToolbarDrop, inToolbar } = await import('../../src/components/toolbar/toolbarEdits.js')
const { toolbarMenuItems } = await import('../../src/hooks/contextMenu/toolbarMenu.js')
const { CUSTOMIZE_TOOLBAR_EVENT } = await import('../../src/components/toolbar/toolbarContext.js')
const { writeToolbarItems, readDisplayMode } = await import('../../src/components/toolbar/useToolbarLayout.js')

/* ---------------- the registry ---------------- */

const ids = L.TOOLBAR_ITEMS.map((item) => item.id)
ok('every item id has a component', ids.every((id) => typeof TOOLBAR_COMPONENTS[id] === 'function'))
ok('and no component is for an id the layouts do not know', Object.keys(TOOLBAR_COMPONENTS).every((id) => ids.includes(id)))

/* ---------------- every item renders with nothing to show ---------------- */

const empty = {
  toolbar: { target: undefined, color: '#000000', highlight: '#ffff00', font: 'Georgia', fontSize: '18px', alignment: 'left', activeMarks: {}, canUndo: false, canRedo: false },
  canvas: null, map: null, layout: null, view: { focusMode: false, wordCountVisible: true },
  send: () => {}, editor: null, activeDoc: null, hasProject: false, panel: null, split: null, timer: null,
}
const container = document.getElementById('root')
const root = createRoot(container)
for (const display of L.TOOLBAR_DISPLAY_MODES) {
  const failures = []
  for (const id of ids) {
    try {
      await act(async () => root.render(React.createElement(ToolbarItem, { id, ctx: { ...empty, display } })))
      if (!container.querySelector(`[data-item="${id}"]`)) failures.push(`${id}: nothing rendered`)
    } catch (error) {
      failures.push(`${id}: ${error.message}`)
    }
  }
  for (const failure of failures) console.log(`      ${failure}`)
  ok(`every item renders with no state, as ${display}`, failures.length === 0)
}

await act(async () => root.render(React.createElement(ToolbarItem, { id: 'inkblot.format.font', ctx: { ...empty, display: 'icon' } })))
ok('with no live editor an item is disabled, not gone', container.querySelector('select')?.disabled === true)
await act(async () => root.render(React.createElement(ToolbarItem, { id: 'inkblot.format.text-style', ctx: { ...empty, display: 'iconAndLabel' } })))
ok('Icon and Text puts the label under the item', container.querySelector('.tb-item-label')?.textContent === 'Text Style')
await act(async () => root.render(React.createElement(ToolbarItem, { id: 'inkblot.insert.table', ctx: { ...empty, display: 'label' } })))
ok('Text Only draws the label instead of the icon', container.querySelector('button')?.textContent === 'Insert Table' && !container.querySelector('svg'))

const sent = []
const live = { ...empty, display: 'icon', toolbar: { ...empty.toolbar, target: 'primary' }, send: (type, payload) => sent.push({ type, payload }) }
await act(async () => root.render(React.createElement(ToolbarItem, { id: 'inkblot.format.text-style', ctx: live })))
await act(async () => container.querySelector('[aria-label="Bold"]').dispatchEvent(new MouseEvent('click', { bubbles: true })))
ok('a click sends a command naming the editor', sent[0]?.type === 'applyMark' && sent[0].payload.target === 'primary' && sent[0].payload.mark === 'bold')

sent.length = 0
await act(async () => root.render(React.createElement(ToolbarItem, { id: 'inkblot.canvas.add-card', ctx: { ...live, canvas: { surfaceId: 'canvas-surface-9', locked: false } } })))
await act(async () => container.querySelector('button').dispatchEvent(new MouseEvent('click', { bubbles: true })))
ok('a canvas item sends a canvas command by surface id', sent[0]?.type === 'canvasCommand' && sent[0].payload.surfaceId === 'canvas-surface-9' && sent[0].payload.command === 'add-card')

sent.length = 0
const toggled = []
await act(async () => root.render(React.createElement(ToolbarItem, { id: 'inkblot.panel.notes', ctx: { ...live, panel: { tab: 'notes', open: true, toggle: (tab) => toggled.push(tab) } } })))
ok('a panel item is lit while its panel shows', container.querySelector('button').getAttribute('aria-pressed') === 'true')
await act(async () => container.querySelector('button').dispatchEvent(new MouseEvent('click', { bubbles: true })))
ok('and toggles it', toggled[0] === 'notes')

/* ---------------- a drag in Customize Toolbar… ---------------- */

const base = ['a', 'space', 'b', 'c']
ok('toolbar → toolbar reorders', applyToolbarDrop(base, { source: { kind: 'toolbar', index: 0 }, inside: true, index: 3 }).join() === 'space,b,c,a')
ok('toolbar → outside removes', applyToolbarDrop(base, { source: { kind: 'toolbar', index: 2 }, inside: false }).join() === 'a,space,c')
ok('palette → toolbar inserts at the caret', applyToolbarDrop(base, { source: { kind: 'palette', id: 'x' }, inside: true, index: 1 }).join() === 'a,x,space,b,c')
ok('palette → outside changes nothing', applyToolbarDrop(base, { source: { kind: 'palette', id: 'x' }, inside: false }) === base)
ok('a spacer can go in again', applyToolbarDrop(base, { source: { kind: 'palette', id: 'space' }, inside: true, index: 4 }).filter((id) => id === 'space').length === 2)
ok('an item already there moves rather than doubles', applyToolbarDrop(base, { source: { kind: 'palette', id: 'c' }, inside: true, index: 0 }).join() === 'c,a,space,b')
ok('the default set replaces the layout', applyToolbarDrop(base, { source: { kind: 'defaults', items: ['z'] }, inside: true, index: 2 }).join() === 'z')
ok('the palette dims what is in the toolbar, not spacers', inToolbar(base, 'a') && !inToolbar(base, 'space') && !inToolbar(base, 'x'))

/* ---------------- the host ---------------- */

prefs.removePreference(L.toolbarLayoutKey('document'))
await act(async () => root.render(React.createElement(ToolbarHost, { context: 'document', hasProject: true })))
const rendered = () => [...container.querySelectorAll('.tb-row [data-item]')].map((el) => el.dataset.item)
ok('the host draws the default set', rendered().join() === L.DEFAULT_TOOLBARS.document.filter((id) => !L.isSpacer(id)).join())

await act(async () => { writeToolbarItems('document', ['inkblot.format.font', 'inkblot.edit.undo-redo']) })
ok('a saved layout shows straight away', rendered().join() === 'inkblot.format.font,inkblot.edit.undo-redo')
ok('and is saved normalized', JSON.parse(prefs.getPreference(L.toolbarLayoutKey('document'))).items.length === 2)

await act(async () => window.dispatchEvent(new CustomEvent(CUSTOMIZE_TOOLBAR_EVENT)))
ok('Customize Toolbar… opens the palette', !!document.querySelector('.tb-palette[role="dialog"]'))
ok('the toolbar turns to tokens', !!container.querySelector('.tb-row.is-customizing'))
const used = [...document.querySelectorAll('.tb-palette-item.is-used .tb-palette-label')].map((el) => el.textContent)
ok('items in the toolbar are dimmed in the palette', used.includes('Font') && used.includes('Undo/Redo'))
await act(async () => document.querySelector('.tb-palette .ui-button[data-variant="filled"]').dispatchEvent(new MouseEvent('click', { bubbles: true })))
ok('Done closes it', !document.querySelector('.tb-palette'))

const menu = toolbarMenuItems('icon')
ok('the right-click menu offers the three display modes', menu.slice(0, 3).map((item) => item.text).join() === 'Icon and Text,Icon Only,Text Only')
ok('with the current one checked', menu[1].checked === true && menu[0].checked === false)
ok('and both Customize items', menu.some((item) => item.text === 'Customize Toolbar…') && menu.some((item) => item.text === 'Customize Inspector Layout…'))
await act(async () => menu[0].action())
ok('choosing a display mode saves it', readDisplayMode() === 'iconAndLabel' && prefs.getPreference(L.TOOLBAR_DISPLAY_MODE_KEY) === 'iconAndLabel')
ok('and the toolbar redraws in it', container.querySelector('.tb-row')?.dataset.display === 'iconAndLabel')
await act(async () => menu[1].action())

await act(async () => root.unmount())

/* ---------------- overflow ---------------- */
{
  const { fittingCount } = await import('../../src/components/toolbar/toolbarEdits.js')
  ok('overflow: everything fits', fittingCount([40, 40, 40], 200, 4) === 3)
  ok('overflow: what does not fit goes behind », with room for it', fittingCount([40, 40, 40, 40], 120, 4) === 2 && fittingCount([40, 40, 40, 40], 119, 4) === 1)
  ok('overflow: a flexible space takes no room', fittingCount([40, 0, 40], 90, 4) === 3)
}
