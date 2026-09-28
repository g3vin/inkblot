/**
 * The inspector's layouts: Customize Inspector Layout… mounted, and a layout that
 * follows the window's mode.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'
import { setInvokeHandler } from './stub-core.mjs'
import { ok } from './assert.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent', 'getComputedStyle'])
globalThis.IS_REACT_ACT_ENVIRONMENT = true

setInvokeHandler(async (command) => (command === 'preferences_load' ? { app: {} } : null))
const prefs = await import('../../src/lib/preferences.ts')
if (!prefs.isHydrated()) await prefs.hydratePreferences()

const React = (await import('react')).default
const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const L = await import('../../src/lib/chromeLayout.ts')
const { default: InspectorLayoutEditor } = await import('../../src/components/RightSidebar/InspectorLayoutEditor.jsx')
const { default: useInspectorLayout, readInspectorLayouts } = await import('../../src/components/RightSidebar/useInspectorLayout.js')
const { documentSurface } = await import('../../src/bridge/index.ts')

prefs.removePreference(L.INSPECTOR_LAYOUTS_KEY)
const container = document.getElementById('root')
const root = createRoot(container)

/* ---------------- Customize Inspector Layout… ---------------- */

await act(async () => root.render(React.createElement(InspectorLayoutEditor, { onClose: () => {} })))
const column = (title) => document.querySelector(`[aria-label="${title} panels"]`)
const box = (title, tab) => column(title).querySelector(`input[aria-label="Show ${tab}"]`)
const titles = (title) => [...column(title).querySelectorAll('.inspector-editor-row')].map((row) => row.textContent.trim())
const click = (el) => act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))

ok('both layouts are listed', !!column('Write') && !!column('Typeset'))
ok('Write lists its panels first, then the rest', titles('Write').join() === 'Clipboard,Workbench,Notes,References,History,Stats,Typeset,Print & Export')
ok('shown panels are checked', box('Write', 'Notes').checked && !box('Write', 'Typeset').checked)

await click(box('Write', 'Clipboard'))
ok('unchecking hides the panel', !L.tabsOf(readInspectorLayouts(), 'drafting').includes('clipboard'))
ok('and it moves under the shown ones', titles('Write').indexOf('Clipboard') > titles('Write').indexOf('Stats'))
ok('Typeset is untouched', L.tabsOf(readInspectorLayouts(), 'finishing').join() === 'typeset,output,notes,references,history,stats')

await click(box('Write', 'Print & Export'))
ok('checking shows it, last', L.tabsOf(readInspectorLayouts(), 'drafting').at(-1) === 'output')

for (const tab of ['Workbench', 'Notes', 'References', 'History', 'Stats']) await click(box('Write', tab))
ok('down to one panel', L.tabsOf(readInspectorLayouts(), 'drafting').join() === 'output')
ok('whose box cannot be unchecked', box('Write', 'Print & Export').disabled)
ok('and it is saved', JSON.parse(prefs.getPreference(L.INSPECTOR_LAYOUTS_KEY)).layouts.drafting.join() === 'output')

/* ---------------- a layout follows the mode ---------------- */

prefs.removePreference(L.INSPECTOR_LAYOUTS_KEY)
let seen = null
function Probe({ mode, hasMap = false }) {
  const [tab, setTab] = useState('clipboard')
  const inspector = useInspectorLayout({ mode, hasMap, tab, setTab })
  seen = { ...inspector, tab }
  return null
}
await act(async () => root.render(React.createElement(Probe, { mode: 'write' })))
ok('writing shows Write’s panels', seen.layout === 'drafting' && seen.tabs.join() === L.DEFAULT_INSPECTOR_TABS.drafting.join())

await act(async () => root.render(React.createElement(Probe, { mode: 'typeset' })))
ok('typesetting brings Typeset’s', seen.layout === 'finishing' && seen.tabs[0] === 'typeset')
ok('on its first panel, having none to go back to', seen.tab === 'typeset')

await act(async () => root.render(React.createElement(Probe, { mode: 'write' })))
ok('going back to writing returns to the panel Write was left on', seen.tab === 'clipboard')

await act(async () => root.render(React.createElement(Probe, { mode: 'write', hasMap: true })))
ok('a map puts its panel first', seen.tabs[0] === 'map')

const modes = []
const off = documentSurface.onCommand('setEditorMode', ({ mode }) => modes.push(mode))
await act(async () => seen.chooseLayout('finishing'))
ok('choosing a layout switches the mode', modes.at(-1) === 'typeset')
off()

await act(async () => root.unmount())
