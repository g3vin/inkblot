/**
 * The Finishing tabs' page half: formats, which setup a document and a book print in,
 * what the controller publishes and when, and the print queue.
 *
 * The controller is mounted and driven through the app's real bridge (`shellBridge` →
 * `documentSurface`), so every state and command crosses the JSON-copying transport the
 * Swift shell uses.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true,
})
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'DOMParser',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent', 'Event'])
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { Editor } = await import('@tiptap/core')
const { StarterKit } = await import('@tiptap/starter-kit')
const { buildEditorExtensions } = await import('../../src/lib/editorExtensions.js')
const { shellBridge } = await import('../../src/bridge/index.ts')
const { setInvokeHandler } = await import('./stub-core.mjs')
const formats = await import('../../src/print/formats.ts')
const { bookPageSetup, normalizePageSetup, resolvePageSetup, DEFAULT_PAGE_SETUP } = await import('../../src/print/pageSetup.ts')
const store = await import('../../src/print/printLayoutStore.js')
const { default: usePrintLayoutController, buildPageLayoutState } = await import('../../src/print/usePrintLayoutController.js')
const { printFigure } = await import('../../src/print/printJob.js')
const { describeJob } = await import('../../src/print/usePrintJobStatus.js')

import { ok } from './assert.mjs'

// Preference writes reach "disk" here, quietly; the print queue installs its own below.
setInvokeHandler(async () => null)

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const wait = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms))

/* ---------------- formats ---------------- */

ok('format ids are unique', new Set(formats.FORMAT_PRESETS.map((f) => f.id)).size === formats.FORMAT_PRESETS.length)
ok('every format builds a setup that normalizes to itself',
  formats.FORMAT_PRESETS.every((f) => same(normalizePageSetup(f.build()), normalizePageSetup(normalizePageSetup(f.build())))))
ok('every format reads back as itself, unmodified',
  formats.FORMAT_PRESETS.every((f) => {
    const { formatId, modified } = formats.formatOf(formats.applyFormat(f.id))
    return formatId === f.id && !modified
  }))
ok('Trade Paperback 6 × 9 is the book setup the tests have always used',
  same({ ...formats.applyFormat('trade-6x9'), formatId: undefined }, normalizePageSetup(bookPageSetup('trade-6x9'))))
const applied = formats.applyFormat('trade-6x9')
ok('an applied format remembers where it came from', applied.formatId === 'trade-6x9')
const changed = { ...applied, margins: { ...applied.margins, topMm: 30 } }
ok('changing a margin makes it "modified", still named', same(formats.formatOf(changed), { formatId: 'trade-6x9', modified: true }))
ok('a hand-made plain Letter page is recognised as US Letter',
  same(formats.formatOf(normalizePageSetup(DEFAULT_PAGE_SETUP)), { formatId: 'letter', modified: false }))
ok('a setup like no format is none', formats.formatOf({ ...DEFAULT_PAGE_SETUP, columns: 3 }).formatId === null)
ok('an unknown format applies nothing', formats.applyFormat('no-such-format') === null)
ok('the catalog carries no builders across the bridge', formats.FORMAT_OPTIONS.every((f) => !('build' in f)))
ok('formatId survives normalizing, and junk is dropped',
  normalizePageSetup({ formatId: 'a4' }).formatId === 'a4' && normalizePageSetup({ formatId: 7 }).formatId === undefined)

/* ---------------- which setup ---------------- */

const own = formats.applyFormat('a4')
const bookSetup = formats.applyFormat('trade-6x9')
const pick = (args) => resolvePageSetup(args)
ok('a document shows its own setup, even in a book with one', pick({ docSetup: own, bookSetup }).setup.presetId === 'a4' && pick({ docSetup: own, bookSetup }).source === 'document')
ok('a document with none shows its book\'s', pick({ bookSetup }).setup.presetId === 'trade-6x9' && pick({ bookSetup }).source === 'book')
ok('with neither, the default', pick({}).source === 'default' && pick({}).setup.presetId === 'letter')
ok('a book with a setup prints every chapter in it — the bug that ignored it',
  pick({ docSetup: own, bookSetup, scope: 'folder' }).setup.presetId === 'trade-6x9' &&
  pick({ docSetup: own, bookSetup, scope: 'project' }).source === 'book')
ok('a book without one prints in its first chapter\'s', pick({ docSetup: own, scope: 'folder' }).setup.presetId === 'a4')

/* ---------------- the store ---------------- */

ok('binding is off until asked for', store.DEFAULT_BINDING.binding === 'none')
ok('a book that was set to bind keeps it', (() => {
  store.setBookSettings('P', 'Kept', { ...store.getBookSettings('P', 'Kept'), binding: { binding: 'saddle' } })
  return store.getBookSettings('P', 'Kept').binding.binding === 'saddle'
})())
ok('scope defaults to the document, and holds per project', (() => {
  const before = store.getPrintScope('P')
  store.setPrintScope('P', 'project')
  store.setPrintScope('P', 'nonsense')
  const after = store.getPrintScope('P')
  store.setPrintScope('P', 'document')
  return before === 'document' && after === 'project' && store.getPrintScope('Q') === 'document'
})())
ok('under the project scope a document belongs to the project\'s book', (() => {
  store.setPrintScope('P', 'project')
  const folder = store.bookFolderForScope('P', 'Novel/One')
  store.setPrintScope('P', 'document')
  return folder === '' && store.bookFolderForScope('P', 'Novel/One') === 'Novel'
})())
let pageHeard = 0
const unsubscribePage = store.subscribeCurrentPrintPage(() => { pageHeard += 1 })
store.setCurrentPrintPage('Novel/One', 4)
store.setCurrentPrintPage('Novel/One', 4)
unsubscribePage()
ok('the page in view is told once per change', pageHeard === 1 && store.getCurrentPrintPage('Novel/One') === 4)

/* ---------------- the published state (pure) ---------------- */

store.setBookSettings('P', 'Novel', { ...store.getBookSettings('P', 'Novel'), pageSetup: bookSetup })
const noEditor = buildPageLayoutState({ projectName: 'P', docPath: 'Novel/One', editor: null })
ok('before the editor is there the state says so', noEditor.ready === false)
ok('a chapter with no setup of its own shows its book\'s', noEditor.setupSource === 'book' && noEditor.setup.presetId === 'trade-6x9' && noEditor.bookSetupActive)
ok('and names its format', noEditor.formatId === 'trade-6x9' && noEditor.formatModified === false)
ok('the page in view is clamped to the pages there are', noEditor.currentPage === 1)
ok('the state carries no catalog lists', !('presets' in noEditor) && !('signatureAdvice' in noEditor))

/* ---------------- the controller, over the bridge ---------------- */

const makeEditor = (setup = null) => new Editor({
  element: document.createElement('div'),
  extensions: buildEditorExtensions(StarterKit),
  content: { type: 'doc', attrs: setup ? { pageSetup: setup } : {}, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Once.' }] }] },
})

const heard = { pageLayoutState: [], pageLayoutCatalog: [], printJobStatus: [] }
for (const type of Object.keys(heard)) shellBridge.on(type, (payload) => heard[type].push(payload))

let setProps = null
function Harness(initial) {
  const [props, set] = React.useState(initial)
  setProps = set
  usePrintLayoutController(props)
  return null
}

const root = createRoot(document.getElementById('root'))
const base = { projectName: 'P', activeDoc: 'Novel/Two', currentDoc: 'Novel/Two', secondaryDoc: null, editor: null, secondaryEditor: null }
await act(async () => { root.render(React.createElement(Harness, base)) })
await act(async () => { await wait(30) })

ok('the catalog is sent once, with sizes, formats, advice and tokens',
  heard.pageLayoutCatalog.length === 1 &&
  heard.pageLayoutCatalog[0].presets.length > 20 &&
  heard.pageLayoutCatalog[0].formats.some((f) => f.id === 'trade-6x9') &&
  heard.pageLayoutCatalog[0].signatureAdvice.length > 0 &&
  heard.pageLayoutCatalog[0].tokens.some((t) => t.token === '{chapter}'))
const lastState = () => heard.pageLayoutState[heard.pageLayoutState.length - 1]
ok('a state goes out, not yet ready', heard.pageLayoutState.length > 0 && lastState().ready === false)

// An edit that arrives before the editor does is kept, not dropped.
await act(async () => { shellBridge.send('applyFormat', { formatId: 'a4', target: 'document' }) })
const editor = makeEditor()
await act(async () => { setProps({ ...base, editor }) })
// Past the typing debounce: the setup applied is a transaction like any other.
await act(async () => { await wait(200) })
ok('a setup sent before the editor was there is applied once it is', editor.state.doc.attrs.pageSetup?.presetId === 'a4')
ok('and the state says the document has its own now', lastState().ready && lastState().hasOwnSetup && lastState().setupSource === 'document' && lastState().formatId === 'a4')

// Nothing changes: nothing is sent.
const before = heard.pageLayoutState.length
await act(async () => { store.setPrintZoom(store.getPrintZoom()) })
await act(async () => { await wait(160) })
ok('a state identical to the last is not sent again', heard.pageLayoutState.length === before)

// Typing is debounced into one publish.
const typedBefore = heard.pageLayoutState.length
await act(async () => {
  for (const ch of 'abcdef') editor.commands.insertContent(ch)
})
await act(async () => { await wait(200) })
ok('six keystrokes publish at most once', heard.pageLayoutState.length - typedBefore <= 1)

// An edit to the book goes to the book, not the document.
await act(async () => {
  shellBridge.send('setPageSetup', { setup: { ...formats.applyFormat('b-format') }, target: 'book' })
})
await act(async () => { await wait(30) })
ok('a book edit changes the book\'s setup', store.getBookSettings('P', 'Novel').pageSetup?.presetId === 'b-format')
ok('and leaves the document\'s alone', editor.state.doc.attrs.pageSetup?.presetId === 'a4')

await act(async () => { shellBridge.send('clearBookSetup', {}) })
await act(async () => { await wait(30) })
ok('clearing the book\'s setup removes it', !store.getBookSettings('P', 'Novel').pageSetup && lastState().bookSetupActive === false)

await act(async () => { shellBridge.send('useSetupForBook', {}) })
await act(async () => { await wait(30) })
ok('"Use for whole book" gives the book the document\'s setup', store.getBookSettings('P', 'Novel').pageSetup?.presetId === 'a4')

await act(async () => { shellBridge.send('setPrintScope', { scope: 'project' }) })
await act(async () => { await wait(30) })
ok('the scope crosses the bridge and switches the book to the project\'s', lastState().scope === 'project' && lastState().book.folder === '')
await act(async () => { shellBridge.send('setPrintScope', { scope: 'document' }) })

await act(async () => { root.unmount() })
editor.destroy()

/* ---------------- the print queue ---------------- */

const statuses = []
window.addEventListener('inkblot:print-job', (event) => statuses.push(event.detail))
const printed = []
let failNext = false
setInvokeHandler(async (command, args) => {
  if (command !== 'print_webview') return null
  await wait(20)
  if (failNext) {
    failNext = false
    throw new Error('the printer is on fire')
  }
  printed.push(args.jobName)
  return null
})

const figure = (jobName) => printFigure({ markup: '<svg></svg>', widthPx: 100, heightPx: 100, jobName })
const [first, second] = await Promise.all([figure('first'), figure('second')])
ok('a job asked for while another runs is run after it, not dropped', first && second && same(printed, ['first', 'second']))
const phasesOf = (id) => statuses.filter((s) => s.jobId === id).map((s) => s.phase)
const ids = [...new Set(statuses.map((s) => s.jobId))]
ok('each job reports preparing, writing and done under its own id',
  ids.length === 2 && ids.every((id) => same(phasesOf(id), ['preparing', 'writing', 'done'])))

failNext = true
let rejected = null
await figure('burning').catch((error) => { rejected = error })
const failed = statuses[statuses.length - 1]
ok('a failed job says why, and still rejects', failed.phase === 'failed' && failed.message === 'the printer is on fire' && rejected)
ok('the queue carries on after a failure', await figure('after') && printed[printed.length - 1] === 'after')
setInvokeHandler(null)

/* ---------------- the status line ---------------- */

ok('an export in progress says so, by chapter',
  describeJob({ kind: 'export', format: 'pdf', phase: 'laying', done: 1, total: 14 }) === 'Exporting PDF: laying out chapter 2 of 14…')
ok('a saved export names the file', describeJob({ kind: 'export', format: 'epub', phase: 'done', path: '/Users/me/Book.epub' }) === 'Saved Book.epub')
ok('a failure says what went wrong', describeJob({ kind: 'print', phase: 'failed', message: 'No printer.' }) === 'Could not print: No printer.')
ok('a cancelled job says nothing', describeJob({ kind: 'print', phase: 'cancelled' }) === '')
