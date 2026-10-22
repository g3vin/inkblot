/**
 * The web tab bar (components/tabs): drawn from `tabsChanged`, changing the tabs only
 * by command, with the shortcuts (commands, answered by the app's key handler) and the
 * rules for names that clash.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'
import { ok } from './assert.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'DOMParser',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent', 'getComputedStyle'])
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.CSS ??= { escape: (value) => value }

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { documentSurface } = await import('../../src/bridge/index.ts')
const T = await import('../../src/components/tabs/tabBarState.js')
const { default: DocumentTabBar } = await import('../../src/components/tabs/DocumentTabBar.jsx')
const { default: useTabShortcuts } = await import('../../src/components/tabs/useTabShortcuts.js')
const { isMacPlatform, useKeybindings } = await import('../../src/lib/keybindings.ts')

/* ---------------- names ---------------- */

ok('a canvas is named without its suffix', T.tabName('Boards/Plot.canvas') === 'Plot')
ok('a draft is a new tab', T.tabName(null) === 'New tab')
const clash = [{ id: 'a', docPath: 'Part One/Notes' }, { id: 'b', docPath: 'Part Two/Notes' }, { id: 'c', docPath: 'Chapter' }]
ok('two tabs of one name show their folders', T.tabTitle(clash[0], clash) === 'Notes — Part One' && T.tabTitle(clash[2], clash) === 'Chapter')
ok('one tab needs no bar', !T.needsTabBar([{ id: 'a' }]) && T.needsTabBar([{ id: 'a', split: 'columns' }]) && T.needsTabBar(clash))
ok('⌘9 is the last tab', T.tabForNumber(clash, 9).id === 'c' && T.tabForNumber(clash, 2).id === 'b' && T.tabForNumber(clash, 5) === null)
ok('⌃Tab goes round the ends', T.adjacentTab(clash, 'c', 1).id === 'a' && T.adjacentTab(clash, 'a', -1).id === 'c')

/* ---------------- the bar ---------------- */

const commands = []
for (const type of ['selectTab', 'closeTab', 'newTab', 'setTabOrder']) {
  documentSurface.onCommand(type, (payload) => commands.push({ type, payload }))
}
function Harness() {
  useKeybindings()
  useTabShortcuts()
  return React.createElement(DocumentTabBar, { activeDoc: 'Chapter 1' })
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const publish = (payload) => act(async () => { documentSurface.publishTabsChanged(payload); await wait(40) })
await publish({ tabs: [] })
const root = createRoot(document.getElementById('root'))
await act(async () => { root.render(React.createElement(Harness)) })
ok('no tabs, no bar', !document.querySelector('.document-tab-bar'))

await publish({ tabs: [{ id: 't1', docPath: 'Chapter 1', secondaryDoc: 'Map.map', split: 'columns' }, { id: 't2', docPath: 'Chapter 2' }], activeTabId: 't1' })
const tabs = [...document.querySelectorAll('.document-tab')]
ok('a tab per open tab', tabs.length === 2)
ok('the active tab is selected', tabs[0].getAttribute('aria-selected') === 'true' && tabs[1].getAttribute('aria-selected') === 'false')
ok('a split tab names both documents', tabs[0].textContent.includes('Chapter 1') && tabs[0].textContent.includes('Map') && tabs[0].getAttribute('aria-label') === 'Chapter 1 beside Map')

await act(async () => { tabs[1].click() })
ok('a click selects by command', commands.at(-1)?.type === 'selectTab' && commands.at(-1).payload.tabId === 't2')
await act(async () => { tabs[1].querySelector('.document-tab-close').click() })
ok('the ✕ closes by command', commands.at(-1)?.type === 'closeTab' && commands.at(-1).payload.tabId === 't2')
await act(async () => { document.querySelector('.document-tab-new').click() })
ok('+ opens a new tab', commands.at(-1)?.type === 'newTab')

const key = (init) => act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })) })
// ⌘ on a Mac, Ctrl elsewhere.
const mod = isMacPlatform() ? { metaKey: true } : { ctrlKey: true }
await key({ key: '2', code: 'Digit2', ...mod })
ok('⌘2 picks the second tab', commands.at(-1)?.type === 'selectTab' && commands.at(-1).payload.tabId === 't2')
await key({ key: 'Tab', code: 'Tab', ctrlKey: true })
ok('⌃Tab moves on', commands.at(-1)?.payload.tabId === 't2')
await key({ key: 'w', code: 'KeyW', ...mod })
ok('⌘W closes the active tab', commands.at(-1)?.type === 'closeTab' && commands.at(-1).payload.tabId === 't1')
await key({ key: 't', code: 'KeyT', ...mod })
ok('⌘T opens a new tab', commands.at(-1)?.type === 'newTab')

await act(async () => { T.setShowsTabBar(false) })
ok('View ▸ Hide Tab Bar hides it', !document.querySelector('.document-tab-bar'))
await act(async () => { T.setShowsTabBar(true) })
ok('…and Show brings it back', Boolean(document.querySelector('.document-tab-bar')))

await act(async () => { root.unmount() })
