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
const { applyToolbarDrop, applyPageDrop, moveToPage, removePage, fitPage, pushedAside, inToolbar } = await import('../../src/components/toolbar/toolbarEdits.js')
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
ok('with no live editor an item is disabled, not gone', container.querySelector('.tb-menu-button')?.disabled === true)
await act(async () => root.render(React.createElement(ToolbarItem, { id: 'inkblot.format.text-style', ctx: { ...empty, display: 'iconAndLabel' } })))
ok('Icon and Text puts the label under the item', container.querySelector('.tb-item-label')?.textContent === 'Text style')
await act(async () => root.render(React.createElement(ToolbarItem, { id: 'inkblot.insert.table', ctx: { ...empty, display: 'label' } })))
ok('Text Only draws the label instead of the icon', container.querySelector('button')?.textContent === 'Insert table' && !container.querySelector('svg'))

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
const timeline = { surfaceId: 'timeline-surface-3', scale: 'time', canUndo: false, canRedo: false, hasSelection: false, lensOn: false, inspectorOpen: true, active: true }
await act(async () => root.render(React.createElement(ToolbarItem, { id: 'inkblot.timeline.show-as', ctx: { ...live, timeline } })))
await act(async () => container.querySelector('[data-value="sequence"]').dispatchEvent(new MouseEvent('click', { bubbles: true })))
ok('a timeline item sends a timeline command by surface id', sent[0]?.type === 'timelineCommand' && sent[0].payload.surfaceId === 'timeline-surface-3' && sent[0].payload.command === 'scale' && sent[0].payload.detail?.value === 'sequence')
await act(async () => root.render(React.createElement(ToolbarItem, { id: 'inkblot.timeline.inspector', ctx: { ...live, timeline } })))
ok('and its inspector button is lit while the inspector shows', container.querySelector('button').getAttribute('aria-pressed') === 'true')

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
ok('nor page breaks', !inToolbar(['a', 'page', 'b'], 'page'))

/* ---------------- a drag on one page ---------------- */

const paged = ['a', 'b', 'page', 'c', 'd']
ok('a drag reorders within its page', applyPageDrop(paged, 1, { source: { kind: 'toolbar', index: 1 }, inside: true, index: 0 }).join() === 'a,b,page,d,c')
ok('a drag off the page removes it from the page', applyPageDrop(paged, 0, { source: { kind: 'toolbar', index: 0 }, inside: false }).join() === 'b,page,c,d')
ok('an item from the palette that is on another page moves to this one', applyPageDrop(paged, 1, { source: { kind: 'palette', id: 'a' }, inside: true, index: 0 }).join() === 'b,page,a,c,d')
ok('a page break dropped in splits the page', applyPageDrop(paged, 0, { source: { kind: 'palette', id: 'page' }, inside: true, index: 1 }).join() === 'a,page,b,page,c,d')
ok('a drop on a page being made adds it', applyPageDrop(paged, 2, { source: { kind: 'palette', id: 'x' }, inside: true, index: 0 }).join() === 'a,b,page,c,d,page,x')
ok('the default set replaces every page', applyPageDrop(paged, 1, { source: { kind: 'defaults', items: ['z'] }, inside: true, index: 0 }).join() === 'z')
ok('dropped on a dot, an item moves to the end of that page', moveToPage(paged, 0, 0, 1).join() === 'b,page,c,d,a')
ok('removing a page joins it to the one before', removePage(paged, 1).join() === 'a,b,space,c,d')
ok('removing the first joins it to the next', removePage(paged, 0).join() === 'a,b,space,c,d')
ok('the only page cannot be removed', removePage(['a'], 0).join() === 'a')

/* ---------------- the host ---------------- */

prefs.removePreference(L.toolbarLayoutKey('document'))
await act(async () => root.render(React.createElement(ToolbarHost, { context: 'document', hasProject: true })))
const rendered = () => [...container.querySelectorAll('.tb-row [data-item]')].map((el) => el.dataset.item)
ok('the host draws the default set', rendered().join() === L.DEFAULT_TOOLBARS.document.filter((id) => !L.isSpacer(id) && id !== L.PAGE).join())

const pageOf = (item) => {
  const el = container.querySelector(`[data-item="${item}"]`)?.closest('.tb-page')
  return el && { inert: el.hasAttribute('inert') }
}
const dots = () => [...container.querySelectorAll('.tb-page-dot')]
ok('the default set has two pages, with a dot each', dots().length === 2)
ok('the first page shows, the second waits', !pageOf('inkblot.view.page-view').inert && pageOf('inkblot.insert.note').inert)

await act(async () => { writeToolbarItems('document', ['inkblot.format.font', 'page', 'inkblot.format.highlight']) })
ok('a page break puts what follows it on the next page', pageOf('inkblot.format.highlight').inert && !pageOf('inkblot.format.font').inert)
await act(async () => dots()[1].dispatchEvent(new MouseEvent('click', { bubbles: true })))
ok('a dot turns to its page', !pageOf('inkblot.format.highlight').inert && pageOf('inkblot.format.font').inert && dots()[1].getAttribute('aria-current') === 'true')
await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
ok('and Escape turns back to the first', !pageOf('inkblot.format.font').inert)
await act(async () => container.querySelector('.tb-row').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true })))
ok('⌃→ turns to the next page', !pageOf('inkblot.format.highlight').inert)
await act(async () => container.querySelector('.tb-row').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true, bubbles: true })))

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
ok('the right-click menu offers the three display modes', menu.slice(0, 3).map((item) => item.text).join() === 'Icon and text,Icon only,Text only')
ok('with the current one checked', menu[1].checked === true && menu[0].checked === false)
ok('and both Customize items', menu.some((item) => item.text === 'Customize toolbar…') && menu.some((item) => item.text === 'Customize inspector layout…'))
await act(async () => menu[0].action())
ok('choosing a display mode saves it', readDisplayMode() === 'iconAndLabel' && prefs.getPreference(L.TOOLBAR_DISPLAY_MODE_KEY) === 'iconAndLabel')
ok('and the toolbar redraws in it', container.querySelector('.tb-row')?.dataset.display === 'iconAndLabel')
await act(async () => menu[1].action())

await act(async () => root.unmount())

/* ---------------- fitting a page to the row ---------------- */
{
  const { fittingCount } = await import('../../src/components/toolbar/toolbarEdits.js')
  ok('fitting: everything fits', fittingCount([40, 40, 40], 200, 4) === 3)
  ok('fitting: as many as fit, from the front', fittingCount([40, 40, 40, 40], 88, 4) === 2 && fittingCount([40, 40, 40, 40], 83, 4) === 1)
  ok('fitting: a flexible space takes no room', fittingCount([40, 0, 40], 90, 4) === 3)
  ok('a page too wide carries on in runs that fit', JSON.stringify(fitPage([40, 40, 40, 40, 40], 90, 4)) === '[[0,2],[2,4],[4,5]]')
  ok('a slot wider than the row still gets a run', JSON.stringify(fitPage([200, 40], 90, 4)) === '[[0,1],[1,2]]')
  ok('a page that fits is one run', JSON.stringify(fitPage([40, 40], 90, 4)) === '[[0,2]]')
  ok('an open choice that fits sets nothing aside', pushedAside([40, 40, 40], 1, 20, 200, 4).size === 0)
  ok('it sets aside what follows it first, from the end', [...pushedAside([40, 40, 40, 40], 1, 60, 200, 4)].join() === '3')
  ok('then what comes before it', [...pushedAside([40, 40, 40], 1, 120, 170, 4)].sort().join() === '0,2')
  ok('never itself', !pushedAside([40, 40], 0, 500, 100, 4).has(0))
}
