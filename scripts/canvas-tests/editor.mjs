/**
 * EditorCanvas — the writing surface, mounted for real.
 *
 * This is the suite the migration handoff asked for before EditorCanvas could be
 * split: nothing else in the harness mounts it, and the things it owns — autosave,
 * version checkpoints, the per-doc editor-state cache, note anchor remapping — fail
 * *silently* and lose the user's writing, possibly days later.
 *
 * Mounted under StrictMode, like main.jsx and like dom.mjs, so double-invoked effect
 * setup/teardown is part of every assertion below. The real FileSystem.js runs
 * against the in-memory stub, so "it saved" means bytes actually landed.
 *
 * It paid for itself on the first run: `useEditorDnd({ editor, ... })` was passing
 * the `editor` binding roughly forty lines before its own `const editor = useEditor()`
 * — a temporal dead zone read that threw on every single mount. Lint, tsc and the
 * production build all passed. Nothing else could have caught it.
 *
 * Flushing: autosave debounces at 800ms and the history checkpoint at 15s, so the
 * suite does not wait them out. Switching documents tears down both effects, and
 * their cleanups flush — which is the same path the app takes when you click another
 * file, and therefore the path worth testing anyway.
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
const { act, StrictMode, useCallback, useState } = await import('react')
const { createRoot } = await import('react-dom/client')
const EditorCanvas = (await import('../../src/components/EditorCanvas.jsx')).default
const { saveDocument, loadDocument, getVersions } = await import('../../src/lib/FileSystem.js')
const { saveCanvasDocument, loadCanvasDocument } = await import('../../src/lib/canvasFileSystem.js')
const { createEmptyCanvas, makeTextNode } = await import('../../src/lib/canvasModel.js')
const { files } = await import('./stub-fs.mjs')
const { shellBridge } = await import('../../src/bridge/index.ts')
const printStore = await import('../../src/print/printLayoutStore.js')
const { readDocPageSetup } = await import('../../src/print/DocPageSetup.js')
const { bookPageSetup } = await import('../../src/print/pageSetup.ts')

const ok = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) process.exitCode = 1 }
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)) })

const P = 'Novel'
const para = (text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })
const doc = (...content) => ({ type: 'doc', content })

await saveDocument(P, 'one', { content: doc(para('the first chapter')), notes: [] })
await saveDocument(P, 'two', { content: doc(para('the second chapter')), notes: [] })

const canvasState = createEmptyCanvas()
const card = makeTextNode({ x: 0, y: 0, text: 'a card' })
canvasState.nodes[card.id] = card
canvasState.nodeOrder.push(card.id)
await saveCanvasDocument(P, 'board.canvas', canvasState, { x: 0, y: 0, zoom: 1 })

/* ---------------- Harness ---------------- */

// EditorCanvas is fully controlled: every doc, note and editor handle it works with
// comes down as a prop. The harness owns that state the way App.jsx does, and
// publishes its setters so a test can drive a document switch.
//
// Every callback prop is stable, and that is load-bearing rather than tidy: the
// document-load effect lists setVersions in its dependencies, so a fresh identity
// each render means load → setVersions → render → load, forever. App.jsx passes
// stable ones; an unstable harness would deadlock the suite instead of testing it.
const control = { versionsByDoc: {} }

function Harness() {
  const [currentDoc, setCurrentDoc] = useState('one')
  const [secondaryDoc, setSecondaryDoc] = useState(null)
  const [splitView, setSplitView] = useState(null)
  const [activeDoc, setActiveDoc] = useState('one')
  const [notesByDoc, setNotesByDoc] = useState({})

  const setNotesForDoc = useCallback((docName, notes) => {
    setNotesByDoc((current) => ({ ...current, [docName]: notes }))
  }, [])

  const setVersions = useCallback((docName, vs) => {
    control.versionsByDoc = { ...control.versionsByDoc, [docName]: vs }
  }, [])

  const setEditor = useCallback((next) => {
    control.editor = typeof next === 'function' ? next(control.editor) : next
  }, [])

  const setSecondaryEditor = useCallback((next) => {
    control.secondaryEditor = typeof next === 'function' ? next(control.secondaryEditor) : next
  }, [])

  const setActiveEditor = useCallback(() => {}, [])

  Object.assign(control, {
    setCurrentDoc,
    setSecondaryDoc,
    setSplitView,
    setActiveDoc,
    setNotesForDoc,
    currentDoc,
    notesByDoc,
  })

  return React.createElement(EditorCanvas, {
    setEditor,
    setSecondaryEditor,
    setActiveEditor,
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
    showWordCountBadge: true,
  })
}

const root = createRoot(document.getElementById('root'))
await act(async () => {
  root.render(React.createElement(StrictMode, null, React.createElement(Harness)))
})
await settle()

const paneText = () => document.querySelector('.primary-pane .editor')?.textContent || ''
const wordCount = () => document.querySelector('.primary-pane .word-count')?.textContent || ''

/* ---------------- It mounts at all ---------------- */

// The regression that motivated this file. If EditorCanvas throws during render,
// every assertion below is unreachable — so this one is the canary.
ok('EditorCanvas mounts under StrictMode', !!document.querySelector('.middle-section'))
ok('the primary pane is present', !!document.querySelector('.primary-pane'))
ok('the loaded document renders', paneText().includes('the first chapter'))
ok('the word-count badge counts the loaded text', wordCount() === '3 words')

/* ---------------- Autosave ---------------- */

// Typing must reach disk. The write is debounced, so this drives it the way the app
// does — edit, then switch documents, which flushes on the way out.
await act(async () => {
  control.editor.commands.insertContentAt(control.editor.state.doc.content.size - 1, ' extended')
})
await settle()
ok('the edit is in the editor', control.editor.getText().includes('extended'))

const onDiskBefore = await loadDocument(P, 'one')
ok('the debounce holds the write back', !JSON.stringify(onDiskBefore.content).includes('extended'))

await act(async () => { control.setCurrentDoc('two') })
await settle()

const onDiskAfter = await loadDocument(P, 'one')
ok('switching documents flushes the autosave to disk',
  JSON.stringify(onDiskAfter.content).includes('extended'))
ok('the new document loaded into the pane', paneText().includes('the second chapter'))

/* ---------------- Version checkpoints ---------------- */

// The checkpoint debounce is 15s; the same teardown flushes it, so a document
// switch after an edit must leave a history entry behind. Losing this means the
// user's history silently stops growing — visible only when they go looking for it.
const versions = await getVersions(P, 'one')
ok('the flush wrote a version checkpoint', versions.length === 1)
ok('the checkpoint stores ProseMirror JSON (for restore)', !!versions[0]?.contentJson)
ok('the checkpoint stores HTML (for diffing)',
  String(versions[0]?.contentHtml || '').includes('extended'))
ok('the checkpoint is marked automatic', versions[0]?.auto !== false)
ok('the sidebar was told about the new version', control.versionsByDoc.one?.length === 1)

/* ---------------- The per-doc editor state cache ---------------- */

// Revisiting a document reinstalls the cached EditorState rather than re-parsing
// content — that is what makes tab switching instant, and it is also why an unsaved
// edit is not lost by switching away and back.
files.set(
  '/appdata/Novel/one.json',
  JSON.stringify({ content: doc(para('REWRITTEN BEHIND ITS BACK')), notes: [], versions }),
)

await act(async () => { control.setCurrentDoc('one') })
await settle()

ok('returning to a document restores the cached state, not the file',
  paneText().includes('the first chapter extended') &&
  !paneText().includes('REWRITTEN BEHIND ITS BACK'))

/* ---------------- Canvas documents stay away from TipTap ---------------- */

// A canvas is a document kind, not a view mode: it occupies the same pane. Feeding
// its JSON to createDocument() throws, and a text-shaped autosave aimed at its path
// would erase it — so the pane must hand it to CanvasPane and leave the editors idle.
await act(async () => { control.setCurrentDoc('board.canvas') })
await settle()

ok('a canvas pane renders the canvas surface, not an editor',
  !!document.querySelector('.primary-pane .canvas-surface') &&
  !document.querySelector('.primary-pane .editor'))

const canvasReloaded = await loadCanvasDocument(P, 'board.canvas')
ok('the canvas file is still spec-shaped after living in the pane',
  canvasReloaded.state.nodeOrder.length === 1 &&
  canvasReloaded.state.nodes[card.id]?.text === 'a card')
ok('no text document was written at the canvas path', !files.has('/appdata/Novel/board.canvas.json.json'))

await act(async () => { control.setCurrentDoc('one') })
await settle()

/* ---------------- Note anchor remapping ---------------- */

// A quote note holds ProseMirror positions, and every edit invalidates them. The
// remap runs on each transaction; if it stops, notes drift onto the wrong words
// with no error anywhere.
//
// Since Phase 4 the shell is holding those positions too, so each remap is also
// published on the bridge. Listening here rather than in bridge.mjs is the point:
// that suite proves the protocol works, this one proves the app is actually wired to
// it — a publish call deleted from useEditorNotes would pass every test there.
const remaps = []
shellBridge.on('notesRemapped', (payload) => remaps.push(payload))
const text = control.editor.getText()
const quoteStart = text.indexOf('first') + 1
await act(async () => {
  control.setNotesForDoc('one', [{
    id: 'q1',
    type: 'quote',
    from: quoteStart,
    to: quoteStart + 5,
    anchor: 'first',
    body: 'why this word',
  }])
})
await settle()

const noteNow = () => control.notesByDoc.one?.[0]
ok('the quote note anchors the word it was made from', noteNow()?.anchor === 'first')

// Insert *before* the note. Its positions must slide, and its anchor text must not.
await act(async () => { control.editor.commands.insertContentAt(1, 'PREFIX ') })
await settle()

ok('an edit before the note shifts its positions', noteNow()?.from === quoteStart + 7)
ok('the note still points at the same word', noteNow()?.anchor === 'first')

// Delete the quoted range itself. A note whose range collapses has nothing left to
// point at and must be dropped, not left aimed at neighbouring text.
await act(async () => {
  control.editor.commands.deleteRange({ from: noteNow().from, to: noteNow().to })
})
await settle()
ok('a note whose range is deleted is dropped', (control.notesByDoc.one || []).length === 0)

// The bridge half of the same two edits.
ok('a remap is published to the shell, not just to React state', remaps.length > 0)
ok('and it names the document it was about',
  remaps.every((remap) => remap.docPath === 'one'))
ok('the shifted note reached the shell with its new positions',
  remaps.some((remap) => remap.notes.some((note) => note.from === quoteStart + 7)))
ok('and a note that lost its text is reported as dropped, not merely absent',
  remaps.some((remap) => remap.droppedNoteIds.includes('q1')))

/* ---------------- Split view ---------------- */

await act(async () => {
  control.setSecondaryDoc('two')
  control.setSplitView('editor')
})
await settle()

ok('the secondary pane opens', !!document.querySelector('.secondary-pane'))
ok('the secondary pane loads its own document',
  (document.querySelector('.secondary-pane .editor')?.textContent || '').includes('the second chapter'))
ok('the two panes hold different documents',
  document.querySelector('.secondary-pane .editor')?.textContent !==
  document.querySelector('.primary-pane .editor')?.textContent)

await act(async () => {
  control.secondaryEditor.commands.insertContentAt(
    control.secondaryEditor.state.doc.content.size - 1,
    ' revised',
  )
})
await settle()

// Closing the split tears the secondary autosave down, which flushes it — the same
// path as clicking the pane's × after typing in it.
await act(async () => {
  control.setSplitView(null)
  control.setSecondaryDoc(null)
})
await settle()

const secondaryOnDisk = await loadDocument(P, 'two')
ok('closing the split flushes the secondary pane\'s autosave',
  JSON.stringify(secondaryOnDisk.content).includes('revised'))

/* ---------------- Print Layout ---------------- */

// jsdom has no layout, so this cannot see where pages break (scripts/print-tests does,
// in WebKit). What it can see is that the real pane mounts as pages, keeps the SAME
// editor — switching views must not recreate it — and that the setup is saved.
const editorBefore = control.editor
const textBefore = paneText()
await act(async () => { printStore.setPrintLayoutEnabled(P, 'one', true) })
await settle()
ok('Print Layout mounts the pane as pages', !!document.querySelector('.primary-pane .print-layout .pl-stage .pl-page'))
ok('…with the live editor inside the page stage', !!document.querySelector('.primary-pane .pl-flow .editor .ProseMirror'))
ok('…the same editor instance, with the same text', control.editor === editorBefore && paneText() === textBefore)
ok('…and a page count in the zoom bar', /Page 1 of \d+/.test(document.querySelector('.primary-pane .pl-status')?.textContent || ''))

await act(async () => {
  control.editor.commands.setPageSetup(bookPageSetup('trade-6x9'))
  control.editor.commands.setTextSelection(3)
  control.editor.commands.insertPageBreak('recto')
})
await settle()
ok('a page break is a node in the document', control.editor.getJSON().content.some((n) => n.type === 'pageBreak' && n.attrs.kind === 'recto'))

await act(async () => { printStore.setPrintLayoutEnabled(P, 'one', false) })
await settle()
ok('turning Print Layout off returns the continuous editor', !document.querySelector('.primary-pane .print-layout') && !!document.querySelector('.primary-pane .editor .ProseMirror'))
ok('…still the same editor', control.editor === editorBefore)

// Switching documents flushes the autosave; the setup must be in what was written.
await act(async () => { control.setCurrentDoc('two') })
await settle()
const withSetup = await loadDocument(P, 'one')
ok('the page setup is saved with the document', withSetup?.content?.attrs?.pageSetup?.presetId === 'trade-6x9')
await act(async () => { control.setCurrentDoc('one') })
await settle()
ok('…and is back when the document is reopened', readDocPageSetup(control.editor.state.doc)?.mirrorMargins === true)

/* ---------------- Unmount ---------------- */

await act(async () => {
  control.editor.commands.insertContentAt(control.editor.state.doc.content.size - 1, ' final')
})
await settle()

await act(async () => { root.unmount() })
await act(async () => { await new Promise((r) => setTimeout(r, 50)) })

const finalOnDisk = await loadDocument(P, 'one')
ok('unmounting flushes the last edit rather than dropping it',
  JSON.stringify(finalOnDisk.content).includes('final'))
