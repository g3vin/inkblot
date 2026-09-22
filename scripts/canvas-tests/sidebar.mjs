/**
 * The right sidebar, drawn by the shell: what the page publishes, and what it does
 * with the shell's edits.
 *
 * Driven through the app's real bridge (`shellBridge` → `documentSurface`), so every
 * message crosses the JSON-copying transport — a payload the shell could not receive,
 * or a command the page would silently ignore, fails here. The state is the page's own
 * (notes, clipboard, tiles, versions on disk through the stubbed filesystem), and each
 * edit is checked against what the React panel would have done with it.
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
const { useNativeSidebar } = await import('../../src/components/useNativeSidebar.js')
const { shellBridge } = await import('../../src/bridge/index.ts')
const drag = await import('../../src/bridge/recentSelectionDrag.ts')
const { saveDocument, getVersions } = await import('../../src/lib/FileSystem.js')
const { appendVersionEntry, buildTextVersionEntry } = await import('../../src/lib/FileSystem.js')

const ok = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) process.exitCode = 1 }
const frame = () => act(async () => {
  await new Promise((resolve) => dom.window.requestAnimationFrame(() => resolve()))
  await new Promise((resolve) => setTimeout(resolve, 10))
})

/* ---------------- the ended-drag memory (pure) ---------------- */

drag.rememberEndedSelectionDrag({ text: 'she hesitated', from: 3, to: 16 }, 1000)
ok('a drop of the same text claims the drag that just ended',
  drag.claimEndedSelectionDrag('she hesitated', 1500)?.from === 3)
ok('once — a second drop is an ordinary add', drag.claimEndedSelectionDrag('she hesitated', 1600) === null)
drag.rememberEndedSelectionDrag({ text: 'she hesitated', from: 3, to: 16 }, 1000)
ok('different text does not claim it', drag.claimEndedSelectionDrag('something else', 1100) === null)
drag.rememberEndedSelectionDrag({ text: 'she hesitated', from: 3, to: 16 }, 1000)
ok('and a stale one is let go', drag.claimEndedSelectionDrag('she hesitated', 9000) === null)

/* ---------------- harness ---------------- */

const P = 'Sidebar'
const control = { drops: [], searchTargets: [], compares: [] }
const heard = { notesChanged: [], clipboardChanged: [], tilesChanged: [], versionsChanged: [] }
for (const type of Object.keys(heard)) shellBridge.on(type, (payload) => heard[type].push(payload))

const initialNotes = [
  { id: 'n1', type: 'quote', anchor: 'the door', content: 'root', color: '#007aff', pinned: false,
    parentNoteId: null, collapsedChildren: false, images: [], audio: [], createdAt: 'a', updatedAt: 'a',
    timestamp: 't', futureKey: 'kept' },
  { id: 'n2', type: 'note', anchor: '', content: 'reply', color: '#007aff', pinned: false,
    parentNoteId: 'n1', collapsedChildren: false, images: [], audio: [], createdAt: 'a', updatedAt: 'a',
    timestamp: 't' },
  { id: 'n3', type: 'note', anchor: '', content: 'other', color: '#007aff', pinned: false,
    parentNoteId: null, collapsedChildren: false, images: [], audio: [], createdAt: 'a', updatedAt: 'a',
    timestamp: 't' },
]

function Harness() {
  const [notesByDoc, setNotesByDoc] = useState({ one: initialNotes })
  const [clipboardHistory, setClipboardHistory] = useState([
    { id: 'c1', text: 'copied once', docName: 'one', timestamp: '2026-09-22T12:00:00.000Z' },
    { id: 'c2', text: 'copied twice', docName: 'one', timestamp: '2026-09-22T12:01:00.000Z' },
  ])
  const [tiles, setTiles] = useState([
    { id: 1758556800000, type: 'synonym', text: 'hesitated', doc: 'one' },
    { id: 1758556800001, text: 'She hesitated at the door.', doc: 'one' },
  ])

  const setNotesForDoc = useCallback((docName, updater) => {
    setNotesByDoc((prev) => {
      const current = prev[docName] || []
      return { ...prev, [docName]: typeof updater === 'function' ? updater(current) : updater }
    })
  }, [])

  Object.assign(control, { notesByDoc, clipboardHistory, tiles })

  useNativeSidebar({
    enabled: true,
    projectName: P,
    activeDoc: 'one',
    currentDoc: 'one',
    secondaryDoc: null,
    editor: null,
    secondaryEditor: null,
    notesByDoc,
    setNotesForDoc,
    clipboardHistory,
    clearClipboardHistory: () => setClipboardHistory([]),
    onDropToClipboard: (payload) => control.drops.push(payload),
    onMoveClipboardEntryToEditor: (id) => setClipboardHistory((prev) => prev.filter((e) => e.id !== id)),
    tiles,
    setTiles,
    openCompare: (...args) => control.compares.push(args),
    refreshFiles: async () => {},
    onOpenDocInTab: () => {},
    openSearchTarget: (target) => control.searchTargets.push(target),
  })
  return null
}

const root = createRoot(document.getElementById('root'))
await act(async () => { root.render(React.createElement(Harness)) })
await frame()

/* ---------------- publishing ---------------- */

ok('the active document\'s notes are published', heard.notesChanged.at(-1)?.notes.length === 3)
ok('the clipboard history is published', heard.clipboardChanged.at(-1)?.entries[1].text === 'copied twice')
const wireTiles = heard.tilesChanged.at(-1)?.tiles || []
ok('tiles are published with string ids — the page\'s are timestamps',
  wireTiles[0]?.id === '1758556800000' && typeof wireTiles[0]?.id === 'string')
ok('and an untyped tile is the POS tile it has always rendered as', wireTiles[1]?.type === 'pos')

/* ---------------- notes ---------------- */

await act(async () => {
  shellBridge.send('updateNote', { docPath: 'one', noteId: 'n1', patch: { content: 'edited natively', pinned: true } })
})
await frame()
const edited = control.notesByDoc.one.find((note) => note.id === 'n1')
ok('a patch edits the note', edited.content === 'edited natively' && edited.pinned === true)
ok('and touches its timestamp, as the React panel does', edited.updatedAt !== 'a')
ok('without losing a key the shell cannot see', edited.futureKey === 'kept')
ok('and the change is published back', heard.notesChanged.at(-1)?.notes.find((n) => n.id === 'n1')?.content === 'edited natively')

const before = control.notesByDoc.one.find((note) => note.id === 'n3').updatedAt
await act(async () => {
  shellBridge.send('updateNote', { docPath: 'one', noteId: 'n3', patch: { collapsedChildren: true } })
})
const folded = control.notesByDoc.one.find((note) => note.id === 'n3')
ok('folding a branch is a view change — no new timestamp', folded.collapsedChildren && folded.updatedAt === before)

await act(async () => { shellBridge.send('removeNote', { docPath: 'one', noteId: 'n1' }) })
ok('removing a note takes its replies with it',
  control.notesByDoc.one.map((note) => note.id).join() === 'n3')

await act(async () => { shellBridge.send('jumpToNote', { docPath: 'one', noteId: 'n3' }) })
ok('jumping to a note goes through the page\'s own search-target path',
  control.searchTargets.at(-1)?.note?.id === 'n3' && control.searchTargets.at(-1)?.docName === 'one')

/* ---------------- clipboard ---------------- */

drag.rememberEndedSelectionDrag({ text: 'dragged out', from: 5, to: 16, source: 'primary' })
await act(async () => { shellBridge.send('clipboardDrop', { text: 'dragged out' }) })
ok('a native drop of the selection being dragged is a move',
  control.drops.at(-1)?.fromEditorSelection === true && control.drops.at(-1)?.selection?.from === 5)
await act(async () => { shellBridge.send('clipboardDrop', { text: 'from another app' }) })
ok('a drop of anything else is an ordinary add', control.drops.at(-1)?.fromEditorSelection === false)

await act(async () => { shellBridge.send('removeClipboardEntries', { ids: ['c1'] }) })
ok('removing one entry leaves the rest', control.clipboardHistory.map((e) => e.id).join() === 'c2')
await act(async () => { shellBridge.send('removeClipboardEntries', {}) })
ok('no ids clears the history', control.clipboardHistory.length === 0)

/* ---------------- workbench ---------------- */

await act(async () => { shellBridge.send('removeTiles', { ids: ['1758556800000'] }) })
ok('a tile is removed by its string id', control.tiles.length === 1 && control.tiles[0].id === 1758556800001)
await act(async () => { shellBridge.send('removeTiles', {}) })
ok('no ids clears the workbench', control.tiles.length === 0)

/* ---------------- history ---------------- */

await saveDocument(P, 'one', { content: { type: 'doc', content: [] } })
const stored = await appendVersionEntry(P, 'one', buildTextVersionEntry({
  contentHtml: '<p>draft</p>', contentJson: null, auto: true,
}))
await frame()
ok('a history write is announced to the shell', heard.versionsChanged.some((e) => e.docPath === 'one'))

await act(async () => {
  shellBridge.send('renameVersion', { docPath: 'one', versionId: String(stored.id), name: 'First Draft' })
  await new Promise((resolve) => setTimeout(resolve, 20))
})
const renamed = (await getVersions(P, 'one')).find((entry) => String(entry.id) === String(stored.id))
ok('renameVersion names it on disk, through the page\'s own version store', renamed?.name === 'First Draft')

await act(async () => {
  shellBridge.send('versionAction', { docPath: 'one', action: 'compare', versionId: String(stored.id) })
})
ok('compare opens the page\'s comparison against the current state',
  control.compares.at(-1)?.join() === `one,${stored.id},current`)

await act(async () => {
  shellBridge.send('versionAction', { docPath: 'one', action: 'delete', versionId: String(stored.id) })
  await new Promise((resolve) => setTimeout(resolve, 20))
})
ok('delete removes it', !(await getVersions(P, 'one')).some((entry) => String(entry.id) === String(stored.id)))

/* ---------------- search ---------------- */

await act(async () => {
  shellBridge.send('revealSearchResult', { docPath: 'two', anchor: { from: 4, to: 13, text: 'hesitated' } })
})
const target = control.searchTargets.at(-1)
ok('a search result opens through the page\'s search-target path, anchored by its text',
  target.docName === 'two' && target.anchor === 'hesitated' && target.from === 4)
await act(async () => {
  shellBridge.send('revealSearchResult', { docPath: 'board.canvas', nodeId: 'card-1' })
})
ok('a canvas match names the node', control.searchTargets.at(-1)?.nodeId === 'card-1')

await act(async () => { root.unmount() })
