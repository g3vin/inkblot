/**
 * The tab dock, the new-tab chooser and the Analytic Bubble, drawn by the shell: what
 * the page publishes, and what it does with the shell's clicks.
 *
 * Driven through the app's real bridge, as `sidebar.mjs` is, so every message crosses
 * the JSON-copying transport. Tabs are the page's `useTabs` state; a draft becomes a
 * document on the stubbed filesystem through the same checks `DraftTabPane` runs.
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
const { act, useState, useCallback } = await import('react')
const { createRoot } = await import('react-dom/client')
const { useNativeTabDock } = await import('../../src/hooks/useNativeTabDock.js')
const NativeDraftPane = (await import('../../src/components/NativeDraftPane.jsx')).default
const { parseSentence } = await import('../../src/lib/sentenceParse.js')
const { shellBridge } = await import('../../src/bridge/index.ts')
const { saveDocument, documentExists } = await import('../../src/lib/FileSystem.js')

import { ok } from './assert.mjs'
const frame = () => act(async () => {
  await new Promise((resolve) => dom.window.requestAnimationFrame(() => resolve()))
  await new Promise((resolve) => setTimeout(resolve, 10))
})

const heard = { tabsChanged: [], draftPaneChanged: [] }
for (const type of Object.keys(heard)) shellBridge.on(type, (payload) => heard[type].push(payload))

/* ---------------- the tab dock ---------------- */
{
  const calls = []
  const control = {}

  function Harness() {
    // Ids are timestamps, as useTabs makes them — numbers here, strings on the wire.
    const [tabs, setTabs] = useState([
      { id: 1758556800000, docPath: 'ch/one' },
      { id: 1758556800001, docPath: 'board.canvas', ephemeral: true },
    ])
    const [activeTabId, setActiveTabId] = useState(1758556800000)
    control.setTabs = setTabs
    useNativeTabDock({
      enabled: true,
      tabs,
      activeTabId,
      currentDoc: 'ch/one',
      secondaryDoc: 'board.canvas',
      splitView: 'editor',
      onSelectTab: useCallback((id) => { calls.push(['select', id]); setActiveTabId(id) }, []),
      onCloseTab: useCallback((id) => { calls.push(['close', id]) }, []),
      onNewTab: useCallback(() => {
        calls.push(['new'])
        setTabs((prev) => [...prev, { id: 1758556800002, docPath: null }])
      }, []),
      onOpenDocInTab: useCallback((path) => { calls.push(['open', path]) }, []),
    })
    return null
  }

  const root = createRoot(document.getElementById('root'))
  await act(async () => { root.render(React.createElement(Harness)) })
  await frame()

  const first = heard.tabsChanged.at(-1)
  ok('the tabs are published', first?.tabs.length === 2)
  ok('with ids as strings', first.tabs[0].id === '1758556800000' && first.activeTabId === '1758556800000')
  ok('and what the panes show, split included',
    first.currentDoc === 'ch/one' && first.secondaryDoc === 'board.canvas' && first.split === true)
  ok('an ephemeral tab says so', first.tabs[1].ephemeral === true)

  await act(async () => { shellBridge.send('selectTab', { tabId: '1758556800001' }) })
  await frame()
  ok('selecting by wire id reaches the page with its own id',
    JSON.stringify(calls.at(-1)) === JSON.stringify(['select', 1758556800001]))
  ok('and the new active tab is published', heard.tabsChanged.at(-1).activeTabId === '1758556800001')

  await act(async () => { shellBridge.send('closeTab', { tabId: 'no-such-tab' }) })
  ok('a tab that is gone is not closed by accident', !calls.some(([kind]) => kind === 'close'))

  await act(async () => { shellBridge.send('newTab', {}) })
  await frame()
  const drafted = heard.tabsChanged.at(-1)
  ok('a new tab is a draft, with no path', calls.at(-1)[0] === 'new'
    && drafted.tabs.length === 3 && drafted.tabs[2].docPath === undefined)

  await act(async () => { shellBridge.send('openDocInTab', { docPath: 'ch/two' }) })
  ok('a document dropped on the dock opens in a tab',
    JSON.stringify(calls.at(-1)) === JSON.stringify(['open', 'ch/two']))

  await act(async () => { root.unmount() })
}

/* ---------------- the new-tab chooser ---------------- */
{
  const P = 'Drafts'
  await saveDocument(P, 'Taken', { content: [] })
  const created = []

  const root = createRoot(document.getElementById('root'))
  await act(async () => {
    root.render(React.createElement(NativeDraftPane, {
      tabId: 1758556800002,
      projectName: P,
      onCreated: (path) => created.push(path),
      refreshFiles: async () => {},
    }))
  })
  await frame()

  const shown = heard.draftPaneChanged.at(-1)
  ok('the chooser is shown for its tab', shown?.tabId === '1758556800002' && shown.creating === false)
  ok('with the pane\'s rectangle', typeof shown.rect?.width === 'number')

  await act(async () => { shellBridge.send('createFromDraft', { tabId: '1758556800002', name: 'Taken', kind: 'doc' }) })
  await frame()
  ok('a name that is taken is refused, and the chooser says why',
    heard.draftPaneChanged.at(-1).status === 'A document with that name already exists.' && created.length === 0)

  await act(async () => { shellBridge.send('createFromDraft', { tabId: 'another-tab', name: 'Act One', kind: 'canvas' }) })
  await frame()
  ok('a command for another draft is ignored', created.length === 0)

  await act(async () => { shellBridge.send('createFromDraft', { tabId: '1758556800002', name: 'Act One', kind: 'canvas' }) })
  await frame()
  ok('a canvas is made with its suffix, and the tab adopts it', created[0] === 'Act One.canvas')
  ok('and it is on disk', await documentExists(P, 'Act One.canvas'))

  await act(async () => { root.unmount() })
  await frame()
  ok('closing the chooser says so', heard.draftPaneChanged.at(-1).tabId === undefined)
}

/* ---------------- the Analytic Bubble's trees ---------------- */
{
  const parses = parseSentence('The cat sat on the mat.')
  ok('a sentence parses into the protocol\'s shape',
    parses.length > 0 && typeof parses[0].score === 'number' && parses[0].tree.label === 'S')
  const leaves = []
  const walk = (node) => (node.children.length ? node.children.forEach(walk) : leaves.push(node.label))
  walk(parses[0].tree)
  ok('every leaf is a label with no children', leaves.length > 0 && leaves.every((leaf) => typeof leaf === 'string'))
  // The tagger reaches the grammar: a determiner is a determiner, not the N/V guess
  // every word got while the tags were read from the wrong place.
  const labels = []
  const all = (node) => { labels.push(node.label); node.children.forEach(all) }
  all(parses[0].tree)
  ok('compromise\'s tags reach the parse', labels.includes('Det'))
  ok('and the parse crosses as JSON unchanged',
    JSON.stringify(JSON.parse(JSON.stringify(parses))) === JSON.stringify(parses))
}
