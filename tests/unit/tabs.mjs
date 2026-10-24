/**
 * Document tabs and split view: the tab operations, and the tabs as the tab bar reads them.
 *
 * A tab owns its split. The operations are pure (`editorSession.ts`) and checked
 * directly, because what selecting or closing a tab leaves in each pane is invisible
 * when subtly wrong until the wrong document is being written in. Then the real
 * `useTabs` and `useTabsPublisher` are mounted and driven through the app's bridge
 * (`shellBridge` → `documentSurface`), so every command and the published state cross
 * the JSON-copying transport the tab bar is on.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true,
})
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent', 'Event'])
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const {
  closeTabIn, ensureTabsForOpenDocs, normalizeSavedSplits, normalizeTabs, openAloneIn, orderTabsIn, placeDocIn,
  recordSavedSplit, recordSplitIn, selectTabIn, showSplitIn,
} = await import('../../src/lib/editorSession.ts')
const { useTabs } = await import('../../src/hooks/useTabs.js')
const { useTabsPublisher } = await import('../../src/hooks/useTabsPublisher.js')
const { shellBridge } = await import('../../src/bridge/index.ts')

import { ok } from './assert.mjs'

const tab = (id, docPath, split) => ({
  id, docPath, ephemeral: false,
  secondaryDoc: split?.[0] ?? null,
  ...(split ? { splitOrientation: split[1] } : {}),
})
const ws = (over = {}) => ({
  tabs: [tab('a', 'A'), tab('b', 'B', ['N', 'rows']), tab('c', 'C')],
  activeTabId: 'a',
  currentDoc: 'A',
  secondaryDoc: null,
  activeDoc: 'A',
  splitView: null,
  splitOrientation: 'columns',
  ...over,
})

/* ---------------- selecting ---------------- */

let next = selectTabIn(ws(), 'c')
ok('a tab goes to the primary pane', next.currentDoc === 'C' && next.activeTabId === 'c' && next.activeDoc === 'C')
const unchanged = ws()
ok('an unknown tab changes nothing', selectTabIn(unchanged, 'zz') === unchanged && closeTabIn(unchanged, 'zz') === unchanged)

next = selectTabIn(ws(), 'b')
ok('a tab brings back its split',
  next.currentDoc === 'B' && next.secondaryDoc === 'N' && next.splitView === 'editor' && next.splitOrientation === 'rows')

next = selectTabIn(ws({ activeTabId: 'b', currentDoc: 'B', secondaryDoc: 'N', splitView: 'editor', splitOrientation: 'rows' }), 'a')
ok('a tab with no split closes the one on screen', next.currentDoc === 'A' && next.splitView === null && next.secondaryDoc === null)

next = selectTabIn(ws({ tabs: [tab('a', 'A'), tab('s', 'S', ['S', 'columns'])] }), 's')
ok('a split of a document against itself is no split', next.splitView === null)

next = selectTabIn(ws({ tabs: [tab('a', 'A'), tab('d', null)] }), 'd')
ok('a draft empties the primary pane', next.currentDoc === '' && next.activeTabId === 'd')

/* ---------------- closing ---------------- */

next = closeTabIn(ws(), 'c')
ok('closing a tab not shown leaves the panes alone', next.tabs.length === 2 && next.currentDoc === 'A')

next = closeTabIn(ws(), 'a')
ok('closing the shown tab moves to its right-hand neighbour, with its split',
  next.currentDoc === 'B' && next.activeTabId === 'b' && next.secondaryDoc === 'N' && next.splitView === 'editor')

next = closeTabIn(ws({ activeTabId: 'c', currentDoc: 'C', activeDoc: 'C' }), 'c')
ok('the last tab falls back to its left-hand neighbour', next.currentDoc === 'B' && next.activeTabId === 'b')

next = closeTabIn(ws({ tabs: [tab('a', 'A')], secondaryDoc: 'X', splitView: 'editor' }), 'a')
ok('closing the only tab empties the window, split and all',
  next.currentDoc === '' && next.activeTabId === null && next.tabs.length === 0 && next.splitView === null)

next = closeTabIn(ws({ tabs: [tab('a', 'A'), tab('d', null)], activeTabId: 'd', currentDoc: '', activeDoc: '' }), 'd')
ok('closing a draft shows a document again', next.currentDoc === 'A' && next.activeTabId === 'a')

/* ---------------- recording a split ---------------- */

const tabs = ws().tabs
let recorded = recordSplitIn(tabs, 'a', { secondaryDoc: 'Z', splitOrientation: 'rows' })
ok('what the panes show is written into the active tab',
  recorded[0].secondaryDoc === 'Z' && recorded[0].splitOrientation === 'rows' && recorded[1] === tabs[1])
ok('writing what the tab already says changes nothing', recordSplitIn(tabs, 'b', { secondaryDoc: 'N', splitOrientation: 'rows' }) === tabs)
recorded = recordSplitIn(tabs, 'b', null)
ok('closing the split is recorded too, keeping how it was laid out',
  recorded[1].secondaryDoc === null && recorded[1].splitOrientation === 'rows')
ok('no tab, nothing recorded', recordSplitIn(tabs, null, { secondaryDoc: 'Z', splitOrientation: 'rows' }) === tabs)

/* ---------------- a document dropped on a side ---------------- */

next = placeDocIn(ws(), 'X', 'end')
ok('dropped on the right, it opens beside the document showing',
  next.currentDoc === 'A' && next.secondaryDoc === 'X' && next.splitView === 'editor' && next.activeDoc === 'X'
  && next.activeTabId === 'a' && next.tabs[0].docPath === 'A')
next = placeDocIn(ws(), 'X', 'start')
ok('dropped on the left, it takes the tab and the document showing goes beside it',
  next.currentDoc === 'X' && next.secondaryDoc === 'A' && next.activeTabId === 'a'
  && next.tabs[0].docPath === 'X' && next.tabs[0].secondaryDoc === 'A' && next.splitOrientation === 'columns')
next = placeDocIn(ws(), 'C', 'start')
ok('a document with a tab of its own is shown in that tab, not in a second one',
  next.activeTabId === 'c' && next.currentDoc === 'C' && next.secondaryDoc === 'A'
  && next.tabs.filter(t => t.docPath === 'C').length === 1 && next.tabs[0].docPath === 'A')
const alone = ws()
ok('a document never splits against itself',
  placeDocIn(alone, 'A', 'end') === alone && placeDocIn(alone, 'A', 'start') === alone)

const splitWs = ws({ secondaryDoc: 'N', splitView: 'editor', splitOrientation: 'rows' })
next = placeDocIn(splitWs, 'X', 'end')
ok('in a split it takes the pane it is dropped on, keeping the layout',
  next.currentDoc === 'A' && next.secondaryDoc === 'X' && next.splitOrientation === 'rows')
next = placeDocIn(splitWs, 'X', 'start')
ok('dropped on the first pane, it replaces that document', next.currentDoc === 'X' && next.secondaryDoc === 'N')
next = placeDocIn(splitWs, 'N', 'start')
ok('dropped on the other pane, the two trade places', next.currentDoc === 'N' && next.secondaryDoc === 'A')
ok('dropped where it already is, nothing changes', placeDocIn(splitWs, 'N', 'end') === splitWs)

/* ---------------- kept splits ---------------- */

const liveAB = { primaryDoc: 'A', secondaryDoc: 'B', splitOrientation: 'columns', splitRatio: 0.5 }
let kept = recordSavedSplit([], null, liveAB)
ok('a split made is kept, and is the one showing', kept.splits.length === 1 && kept.activeId === kept.splits[0].id && kept.splits[0].secondaryDoc === 'B')
const firstId = kept.activeId
let again = recordSavedSplit(kept.splits, kept.activeId, liveAB)
ok('recording what is already kept changes nothing', again.splits === kept.splits && again.activeId === firstId)
again = recordSavedSplit(kept.splits, kept.activeId, { ...liveAB, secondaryDoc: 'C', splitRatio: 0.3 })
ok('the one showing follows its panes', again.splits.length === 1 && again.splits[0].secondaryDoc === 'C' && again.splits[0].splitRatio === 0.3)
again = recordSavedSplit(kept.splits, kept.activeId, null)
ok('leaving the split keeps it, showing none', again.splits === kept.splits && again.activeId === null)
again = recordSavedSplit(kept.splits, null, liveAB)
ok('making the same split again finds the one kept', again.splits.length === 1 && again.activeId === firstId)
again = recordSavedSplit(kept.splits, null, { ...liveAB, secondaryDoc: 'C' })
ok('a different split is kept beside it', again.splits.length === 2 && again.activeId !== firstId)
ok('malformed splits, and one naming a document twice, are dropped',
  normalizeSavedSplits([kept.splits[0], { id: 'x', primaryDoc: 'A', secondaryDoc: 'A' }, { id: 'y' }, null]).length === 1
  && normalizeSavedSplits('nope').length === 0)

next = showSplitIn(ws(), { id: 's', primaryDoc: 'X', secondaryDoc: 'A', splitOrientation: 'rows', splitRatio: 0.4 })
ok('a kept split shows its two documents as it was laid out',
  next.currentDoc === 'X' && next.secondaryDoc === 'A' && next.splitView === 'editor' && next.splitOrientation === 'rows'
  && next.tabs[0].docPath === 'X')
next = openAloneIn(ws({ secondaryDoc: 'N', splitView: 'editor' }), 'C')
ok('choosing a document shows it alone, on the tab it has', next.currentDoc === 'C' && next.secondaryDoc === null
  && next.splitView === null && next.activeTabId === 'c' && next.activeDoc === 'C')
next = openAloneIn(ws({ secondaryDoc: 'N', splitView: 'editor' }), 'A')
ok('…even one of the split\'s own', next.currentDoc === 'A' && next.splitView === null)

/* ---------------- order ---------------- */

const order = (list) => list.map((t) => t.id).join('')
ok('the tab bar\'s order is taken', order(orderTabsIn(tabs, ['c', 'a', 'b'])) === 'cab')
ok('tabs it does not name keep their order after', order(orderTabsIn(tabs, ['c'])) === 'cab')
ok('ids of tabs that are gone are ignored', order(orderTabsIn(tabs, ['zz', 'b'])) === 'bac')
ok('the same order returns the same list', orderTabsIn(tabs, ['a', 'b', 'c']) === tabs)

/* ---------------- older sessions ---------------- */

const restored = normalizeTabs([
  { id: 'o', docPath: 'Old', ephemeral: false },
  { id: 'n', docPath: 'New', ephemeral: false, secondaryDoc: 'Beside', splitOrientation: 'rows' },
  { id: 'x', docPath: 'Bare', secondaryDoc: null, splitOrientation: 'sideways' },
])
ok('a tab saved before tabs had splits has none on record', !('secondaryDoc' in restored[0]))
ok('a tab\'s split survives a save', restored[1].secondaryDoc === 'Beside' && restored[1].splitOrientation === 'rows')
ok('a bad orientation is dropped', restored[2].secondaryDoc === null && !('splitOrientation' in restored[2]))

ok('the split\'s document gets no tab of its own',
  ensureTabsForOpenDocs([tab('a', 'A')], { currentDoc: 'A', secondaryDoc: 'N', activeTabId: 'a' }).length === 1)

/* ---------------- the tabs, over the bridge ---------------- */

const heard = []
shellBridge.on('tabsChanged', (payload) => heard.push(payload))
const last = () => heard[heard.length - 1]
const byDoc = (docPath) => last().tabs.find((t) => t.docPath === docPath)
const frame = () => act(async () => {
  await new Promise((resolve) => dom.window.requestAnimationFrame(() => resolve()))
  await new Promise((resolve) => setTimeout(resolve, 10))
})
const send = async (type, payload = {}) => {
  await act(async () => { shellBridge.send(type, payload) })
  await frame()
}

const panes = {}
function Harness() {
  const [tabs, setTabs] = useState([tab('t1', 'One'), tab('t2', 'Two'), tab('t3', 'Three')])
  const [activeTabId, setActiveTabId] = useState('t1')
  const [currentDoc, setCurrentDoc] = useState('One')
  const [secondaryDoc, setSecondaryDoc] = useState(null)
  const [activeDoc, setActiveDoc] = useState('One')
  const [splitView, setSplitView] = useState(null)
  const [splitOrientation, setSplitOrientation] = useState('columns')
  const [splitRatio, setSplitRatioState] = useState(0.5)
  const [splits, setSplits] = useState([])
  const [activeSplitId, setActiveSplitId] = useState(null)
  Object.assign(panes, { currentDoc, secondaryDoc, splitView, splitOrientation, setCurrentDoc, splits, activeSplitId })

  const actions = useTabs({
    activeDoc, activeTabId, currentDoc, secondaryDoc, splitView, splitOrientation,
    setActiveDoc, setActiveTabId, setCurrentDoc, setSecondaryDoc,
    setSplitOrientation, setSplitRatioState, setSplitView, setTabs, tabs,
    splitRatio, splits, setSplits, activeSplitId, setActiveSplitId,
  })
  panes.actions = actions
  useTabsPublisher({ projectName: 'P', tabs, activeTabId, actions: { ...actions } })
  return null
}

const root = createRoot(document.getElementById('root'))
await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(Harness))) })
await frame()

ok('the tabs are published', last()?.tabs.map((t) => t.docPath).join() === 'One,Two,Three' && last().activeTabId === 't1')
ok('a tab without a split carries none', byDoc('One').split === undefined && byDoc('One').secondaryDoc === undefined)

await send('openInSplit', { orientation: 'rows' })
ok('openInSplit with no document takes the next tab\'s', panes.secondaryDoc === 'Two' && panes.splitOrientation === 'rows')
ok('and the split is the active tab\'s', byDoc('One').secondaryDoc === 'Two' && byDoc('One').split === 'rows')
ok('its document gets no tab of its own', last().tabs.length === 3)

await send('selectTab', { tabId: 't3' })
ok('another tab shows without the split', panes.currentDoc === 'Three' && panes.splitView === null)
ok('and the first tab keeps it', byDoc('One').secondaryDoc === 'Two')

await send('selectTab', { tabId: 't1' })
ok('selecting it again brings the split back',
  panes.currentDoc === 'One' && panes.secondaryDoc === 'Two' && panes.splitView === 'editor' && panes.splitOrientation === 'rows')

await act(async () => { panes.setCurrentDoc('Three') })
await frame()
ok('opening a document that has a tab lands on that tab, with its own split',
  last().activeTabId === 't3' && panes.splitView === null)

await send('selectTab', { tabId: 't1' })
const showingSplit = () => panes.splits.find((split) => split.id === panes.activeSplitId)
ok('a split showing is kept for the file tree', showingSplit()?.primaryDoc === 'One' && showingSplit()?.secondaryDoc === 'Two')
const keptId = panes.activeSplitId
const keptCount = panes.splits.length
await act(async () => { panes.actions.openDocAlone('Three') })
await frame()
ok('choosing another document leaves the split but keeps it', panes.splitView === null && panes.currentDoc === 'Three'
  && panes.splits.length === keptCount && panes.activeSplitId === null)
await act(async () => { panes.actions.openSavedSplit(keptId) })
await frame()
ok('choosing the kept split shows it again', panes.currentDoc === 'One' && panes.secondaryDoc === 'Two'
  && panes.splitView === 'editor' && panes.activeSplitId === keptId)
await act(async () => { panes.actions.forgetSplit(keptId) })
await frame()
ok('its × closes it for good, leaving its first document open',
  !panes.splits.some((split) => split.id === keptId) && panes.splitView === null && panes.currentDoc === 'One')

await send('openInSplit', { orientation: 'rows' })
const closingId = panes.activeSplitId
await send('closeSplit')
ok('closeSplit is recorded in the tab', panes.splitView === null && byDoc('One').secondaryDoc === undefined)
ok('and takes the split out of the tree', Boolean(closingId) && !panes.splits.some((split) => split.id === closingId))

await send('setTabOrder', { tabIds: ['t3', 't1'] })
ok('setTabOrder reorders', last().tabs.map((t) => t.id).join() === 't3,t1,t2')

await send('newTab')
const draft = last().tabs[3]
ok('newTab opens a draft and shows it', last().tabs.length === 4 && !draft.docPath && last().activeTabId === draft.id)

await send('openDocInTab', { docPath: 'Four' })
ok('openDocInTab opens a document in a tab of its own, with no split',
  panes.currentDoc === 'Four' && byDoc('Four') && byDoc('Four').secondaryDoc === undefined && panes.splitView === null)

await send('openDocInTab', { docPath: 'Two' })
ok('and shows the tab a document already has', last().tabs.filter((t) => t.docPath === 'Two').length === 1 && panes.currentDoc === 'Two')

await send('closeTab', { tabId: byDoc('Two').id })
ok('closeTab closes it', !byDoc('Two') && panes.currentDoc !== 'Two')

await send('selectTab', { tabId: 'gone' })
ok('a command for a tab that has gone does nothing', last().tabs.length === 4)

await act(async () => { root.unmount() })
