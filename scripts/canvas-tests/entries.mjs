/**
 * Renaming, moving and deleting the document you are writing in.
 *
 * The hazard: a pane that lets go of a document flushes its pending autosave to the
 * path it had. Rename the file first and that flush recreates it under the old name —
 * a ghost copy of the document, and, if it was deleted, a deletion that did not stick.
 * That was the React tree's behaviour for as long as it has existed; the native tree's
 * rename/delete commands are what made it urgent.
 *
 * So this mounts the real EditorCanvas (whose teardown flush is the thing that
 * writes), types without waiting out the 800ms debounce, and then performs the entry
 * operation — first the bare disk operation, to show the hazard is real in this
 * harness, then through useEntryOperations, which must not have it.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true,
})
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node',
  'DOMParser', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle',
  'CustomEvent', 'Event', 'MouseEvent', 'KeyboardEvent'])
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act, useCallback, useRef, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const EditorCanvas = (await import('../../src/components/EditorCanvas.jsx')).default
const { useEntryOperations } = await import('../../src/hooks/useEntryOperations.js')
const entryOps = await import('../../src/lib/entryOperations.ts')
const { saveDocument, loadDocument } = await import('../../src/lib/FileSystem.js')
const { files, dirs } = await import('./stub-fs.mjs')
const { shellBridge } = await import('../../src/bridge/index.ts')

const ok = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) process.exitCode = 1 }
const settle = (ms = 50) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

const P = 'Entries'
const path = (rel) => `/appdata/${P}/${rel}.json`
const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const doc = (...content) => ({ type: 'doc', content })

/* ---------------- pure path arithmetic ---------------- */

ok('a file rename moves exactly that path', entryOps.remapPath('a/b', 'a/b', 'a/c', 'file') === 'a/c')
ok('and leaves a sibling alone', entryOps.remapPath('a/bb', 'a/b', 'a/c', 'file') === undefined)
ok('a folder rename carries what is inside it',
  entryOps.remapPath('Part/ch 1', 'Part', 'Act', 'folder') === 'Act/ch 1')
ok('but not a folder that merely shares the prefix',
  entryOps.remapPath('Partial/ch 1', 'Part', 'Act', 'folder') === undefined)
ok('a delete drops what it touched', entryOps.remapPath('Part/ch', 'Part', null, 'folder') === null)
const keyed = { 'Part/a': 1, other: 2 }
ok('keyed state moves with its documents',
  JSON.stringify(entryOps.remapKeys(keyed, 'Part', 'Act', 'folder')) === '{"Act/a":1,"other":2}')
ok('and is left identical when nothing moved', entryOps.remapKeys(keyed, 'Nope', 'X', 'folder') === keyed)

/* ---------------- harness ---------------- */

const control = {}

function Harness() {
  const [currentDoc, setCurrentDoc] = useState('')
  const [secondaryDoc, setSecondaryDoc] = useState(null)
  const [splitView, setSplitView] = useState(null)
  const [activeDoc, setActiveDoc] = useState('')
  const [notesByDoc, setNotesByDoc] = useState({})
  const [tabs, setTabs] = useState([])
  const [versions, setVersionsState] = useState({})
  const refreshFilesRef = useRef(null)

  const setNotesForDoc = useCallback((docName, notes) => {
    setNotesByDoc((current) => ({ ...current, [docName]: notes }))
  }, [])
  const setVersions = useCallback((docName, vs) => {
    setVersionsState((current) => ({ ...current, [docName]: vs }))
  }, [])
  const setEditor = useCallback((next) => {
    control.editor = typeof next === 'function' ? next(control.editor) : next
  }, [])
  const noop = useCallback(() => {}, [])
  const openDocInTab = useCallback((docPath) => {
    setTabs((prev) => (prev.some((t) => t.docPath === docPath) ? prev : [...prev, { id: docPath, docPath }]))
    setCurrentDoc(docPath)
    setActiveDoc(docPath)
  }, [])

  useEntryOperations({
    projectName: P,
    currentDoc,
    secondaryDoc,
    setActiveDoc,
    setCurrentDoc,
    setNotesByDoc,
    setSecondaryDoc,
    setSplitView,
    setTabs,
    setVersionsState,
    refreshFilesRef,
    openDocInTab,
  })

  Object.assign(control, { currentDoc, tabs, versions, openDocInTab, setCurrentDoc, setActiveDoc })

  return React.createElement(EditorCanvas, {
    setEditor,
    setSecondaryEditor: noop,
    setActiveEditor: noop,
    projectName: P,
    currentDoc,
    setCurrentDoc,
    splitView,
    setSplitView,
    secondaryDoc,
    setSecondaryDoc,
    notesByDoc,
    setNotesForDoc,
    activeDoc,
    setActiveDoc,
    setVersions,
    showWordCountBadge: false,
  })
}

const root = createRoot(document.getElementById('root'))
await act(async () => { root.render(React.createElement(Harness)) })

const open = async (docPath) => {
  await act(async () => { control.openDocInTab(docPath) })
  await settle()
}

/** Type at the end, and do NOT wait for the 800ms autosave. */
const typeUnsaved = async (text) => {
  await act(async () => {
    control.editor.commands.insertContentAt(control.editor.state.doc.content.size - 1, text)
  })
}

/* ---------------- the hazard, without the fix ---------------- */

await saveDocument(P, 'ghost', { content: doc(para('boo')) })
await open('ghost')
await typeUnsaved(' unsaved')
await entryOps.entryOperationsOnDisk.renameEntry(P, 'ghost', 'ghost renamed', 'file')
// The pane lets go of the document the way it would on any switch.
await act(async () => { control.setCurrentDoc(''); control.setActiveDoc('') })
await settle()
ok('(control) renaming on disk under an open document lets its final save recreate the old name',
  files.has(path('ghost')) && files.has(path('ghost renamed')))

/* ---------------- rename, through the page ---------------- */

await saveDocument(P, 'draft', { content: doc(para('the opening')) })
await open('draft')
await typeUnsaved(' with a last-second edit')
await act(async () => { await entryOps.renameEntry(P, 'draft', 'Opening', 'file') })
await settle()

ok('renaming the open document leaves nothing at the old name', !files.has(path('draft')))
const renamed = await loadDocument(P, 'Opening')
ok('and the last-second edit is in the renamed file',
  JSON.stringify(renamed?.content).includes('last-second edit'))
ok('the pane follows the document to its new name', control.currentDoc === 'Opening')
ok('and so does its tab', control.tabs.some((t) => t.docPath === 'Opening') &&
  !control.tabs.some((t) => t.docPath === 'draft'))

/* ---------------- a folder, with the open document inside ---------------- */

dirs.add(`/appdata/${P}/Part`)
await saveDocument(P, 'Part/Chapter', { content: doc(para('inside a folder')) })
await open('Part/Chapter')
await typeUnsaved(' and more')
await act(async () => { await entryOps.renameEntry(P, 'Part', 'Act I', 'folder') })
await settle()

ok('renaming a folder does not resurrect the document inside it', !files.has(path('Part/Chapter')))
ok('the open document moved with its folder',
  control.currentDoc === 'Act I/Chapter' &&
  JSON.stringify((await loadDocument(P, 'Act I/Chapter'))?.content).includes('and more'))

/* ---------------- delete ---------------- */

await saveDocument(P, 'doomed', { content: doc(para('short-lived')) })
await open('doomed')
await typeUnsaved(' typing right up to the end')
await act(async () => { await entryOps.deleteEntry(P, 'doomed', 'file') })
await settle()

ok('deleting the open document sticks — its final save does not bring it back', !files.has(path('doomed')))
ok('the pane is left empty rather than pointing at nothing', control.currentDoc === '')
ok('and the tab goes with it', !control.tabs.some((t) => t.docPath === 'doomed'))

/* ---------------- the native shell's commands ---------------- */

await saveDocument(P, 'native', { content: doc(para('from swift')) })
await open('native')
await act(async () => {
  shellBridge.send('renameEntry', { path: 'native', isFolder: false, newName: 'renamed natively' })
})
await settle(100)
ok('renameEntry over the bridge takes the same safe path',
  !files.has(path('native')) && control.currentDoc === 'renamed natively')

await act(async () => {
  shellBridge.send('createEntry', { parentFolder: '', name: 'Board.canvas', kind: 'canvas' })
})
await settle(100)
ok('createEntry makes a canvas, and the suffix follows the kind', files.has(path('Board.canvas')))
ok('and opens it', control.currentDoc === 'Board.canvas')

await act(async () => {
  shellBridge.send('createEntry', { parentFolder: '', name: 'notes.canvas', kind: 'document' })
})
await settle(100)
ok('a document named like a canvas is still a document', files.has(path('notes')) && !files.has(path('notes.canvas')))

await act(async () => { root.unmount() })
