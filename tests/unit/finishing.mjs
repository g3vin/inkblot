/**
 * The Finishing tabs' page half: formats, which setup a document and a book print in,
 * what the controller publishes and when, and the print queue.
 *
 * The controller is mounted and driven through the app's real bridge (`shellBridge` →
 * `documentSurface`), so every state and command crosses the JSON-copying transport the
 * chrome uses.
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
const typo = await import('../../src/print/typography.ts')
const setupFns = await import('../../src/print/pageSetup.ts')
const titles = await import('../../src/print/titlePage.js')
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
ok('Trade Paperback 6 × 9 is the book setup the tests have always used, set as a book',
  same({ ...formats.applyFormat('trade-6x9'), formatId: undefined, typography: undefined, titlePage: undefined }, normalizePageSetup(bookPageSetup('trade-6x9'))) &&
  formats.applyFormat('trade-6x9').typography?.alignment === 'justify')
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

// Each document has its own zoom: a split's two sides zoom apart.
const zoomBefore = lastState().zoom
await act(async () => { shellBridge.send('setPrintZoom', { zoom: 2.5, docPath: 'Novel/Other' }) })
await act(async () => { await wait(160) })
ok('a zoom naming another document is that document\'s',
  store.getPrintZoom('P', 'Novel/Other') === 2.5 && lastState().zoom === zoomBefore)
await act(async () => { store.setPrintZoom(0.5, 'P', 'Novel/Left') })
ok('and leaves the one it did not name as it was', store.getPrintZoom('P', 'Novel/Other') === 2.5 && store.getPrintZoom('P', 'Novel/Left') === 0.5)
ok('one never zoomed is not moved by either', store.getPrintZoom('P', 'Novel/Unzoomed') === store.getPrintZoom())
await act(async () => { shellBridge.send('setEditorMode', { mode: 'typeset' }) })
await act(async () => { await wait(30) })
ok('Typeset mode shows every document as pages, the active one and the rest',
  store.isPrintLayoutEnabled('P', 'Novel/Other') && store.isPrintLayoutEnabled('P', 'Novel/Two'))
ok('and the state says so', lastState().mode === 'typeset' && lastState().enabled)
ok('the mode is the project\'s: another project is still writing', store.getEditorMode('Q') === 'write')
await act(async () => { shellBridge.send('setEditorMode', { mode: 'nonsense' }) })
ok('a mode that is not one changes nothing', store.getEditorMode('P') === 'typeset')
await act(async () => { shellBridge.send('setPrintLayout', { enabled: false, docPath: 'Novel/Other' }) })
ok('the old Print Layout switch turns Typeset off, for every document', store.getEditorMode('P') === 'write' && !store.isPrintLayoutEnabled('P', 'Novel/Two'))
await act(async () => { store.setPrintZoom(zoomBefore, 'P', 'Novel/Two') })
await act(async () => { await wait(160) })

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
await act(async () => { await wait(60) })

/* ---------------- the Typeset and Print & Export tabs, drawn from it ---------------- */
{
  installGlobals(dom.window, ['KeyboardEvent', 'MouseEvent', 'getComputedStyle'])
  const { TypesetPanel, OutputPanel } = await import('../../src/components/RightSidebar/finishing/FinishingPanels.jsx')
  const panelHost = document.body.appendChild(document.createElement('div'))
  const panelRoot = createRoot(panelHost)
  let showedOutput = false
  await act(async () => { panelRoot.render(React.createElement(TypesetPanel, { onShowOutput: () => { showedOutput = true } })) })
  const titles = () => [...panelHost.querySelectorAll('.ui-section-title')].map((node) => node.textContent)
  ok('the Typeset tab draws its sections from the published state',
    ['Book', 'Editions', 'Style', 'Format', 'Page', 'Body Text', 'Proof', 'Chapter Openings', 'Header & Footer', 'Title Page'].every((t) => titles().includes(t)))
  ok('with no Print and Export in its header', !panelHost.querySelector('.fin-header .ui-button[data-variant="filled"]'))
  const toggle = (label) => panelHost.querySelector(`[role="switch"][aria-label="${label}"]`)
  await act(async () => { toggle('Set Type for Print').click() })
  await act(async () => { await wait(220) })
  ok('Set Type for Print sets the document’s type', Boolean(editor.state.doc.attrs.pageSetup?.typography))
  ok('and the section offers the type’s controls', !!panelHost.querySelector('[aria-label="Line Spacing"]'))
  const format = panelHost.querySelector('select[aria-label="Format"]')
  await act(async () => {
    format.value = 'trade-6x9'
    format.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await act(async () => { await wait(220) })
  ok('choosing a format applies it to the document', editor.state.doc.attrs.pageSetup?.presetId === 'trade-6x9')
  await act(async () => { [...panelHost.querySelectorAll('button')].find((b) => b.textContent.startsWith('Next: Print')).click() })
  ok('Next goes on to Print & Export', showedOutput)

  await act(async () => { panelRoot.render(React.createElement(OutputPanel)) })
  ok('Print & Export has Publishing, Cover and Hand Binding',
    ['Publishing', 'Cover', 'Hand Binding'].every((t) => titles().includes(t)))
  ok('and Print and Export in its header', !!panelHost.querySelector('.fin-header .ui-button[data-variant="filled"]'))
  await act(async () => { toggle('Print for Hand Binding').click() })
  await act(async () => { await wait(60) })
  ok('Print for Hand Binding turns binding on for the book', store.getBookSettings('P', 'Novel').binding.binding === 'signatures')
  ok('and the binding’s options appear', !!panelHost.querySelector('select[aria-label="Signature"]'))
  await act(async () => { panelRoot.unmount() })
  panelHost.remove()
}

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

/* ---------------- typography ---------------- */

const manuscript = formats.applyFormat('manuscript')
ok('the manuscript is Courier 12, double-spaced, ragged right, one-inch margins',
  manuscript.typography.fontFamily.includes('Courier') && manuscript.typography.fontSizePt === 12 &&
  manuscript.typography.lineSpacing === 'double' && manuscript.typography.alignment === 'left' &&
  manuscript.margins.topMm === 25.4 && manuscript.margins.insideMm === 25.4)
ok('double-spaced 12 pt leads 27.6 pt, about 23 lines to a Letter page',
  Math.abs(typo.leadingPt(manuscript.typography) - 27.6) < 1e-9 && Math.floor(9 * 72 / typo.leadingPt(manuscript.typography)) === 23)
ok('exact leading is taken as given', typo.leadingPt({ ...manuscript.typography, lineSpacing: 'exact', lineValue: 12 }) === 12)
ok('the manuscript\'s head is surname / title / page', manuscript.header.right === '{surname} / {title} / {page}')
ok('and it has a manuscript title page with contact details and word count',
  manuscript.titlePage.style === 'manuscript' && manuscript.titlePage.showContact && manuscript.titlePage.showWordCount)
ok('a plain page prints in the editor\'s font', formats.applyFormat('letter').typography === undefined)

const junk = typo.normalizeTypography({ fontFamily: '', fontSizePt: 900, lineSpacing: 'triple', sceneBreak: 'a\nb' })
ok('junk typography normalizes to type that sets',
  junk.fontFamily === typo.BOOK_TYPOGRAPHY.fontFamily && junk.fontSizePt === 72 && junk.lineSpacing === typo.BOOK_TYPOGRAPHY.lineSpacing && junk.sceneBreak === 'a b')
ok('no typography stays none', typo.normalizeTypography(null) === undefined && normalizePageSetup({}).typography === undefined)
const vars = typo.typographyVars(manuscript.typography)
ok('the variables carry the size, leading and a quoted scene break',
  vars['--pt-size'] === '12pt' && vars['--pt-leading'] === '27.6pt' && vars['--pt-break'] === '"#"')
ok('a quote in a scene break is escaped for CSS', typo.typographyVars({ ...manuscript.typography, sceneBreak: 'say "hi"' })['--pt-break'] === '"say \\"hi\\""')
ok('the book\'s classes switch on drop caps, small caps, flush openings and its composition',
  same(typo.typographyClasses(typo.BOOK_TYPOGRAPHY), ['has-print-type', 'pt-drop-cap', 'pt-small-caps', 'pt-flush-after-break', 'pt-balance', 'pt-hang']))
ok('the editor\'s font has no classes', typo.typographyClasses(undefined).length === 0)
ok('the primary family is unquoted', typo.primaryFamily('"Courier Prime", Courier') === 'Courier Prime')

/* ---------------- tokens and word counts ---------------- */

const ctx = { page: 7, pages: 212, title: 'The Book', chapter: 'One', author: 'Ursula Le Guin', words: 'about 71,000 words', date: '1 May 2026' }
ok('{surname} is the last word of the author', setupFns.resolveRunningTemplate('{surname} / {title} / {page}', ctx, 'arabic') === 'Guin / The Book / 7')
ok('{words} and {date} resolve', setupFns.resolveRunningTemplate('{words}, {date}', ctx, 'arabic') === 'about 71,000 words, 1 May 2026')
ok('word counts round as a title page gives them',
  setupFns.roundWordCount(4_372) === 4_400 && setupFns.roundWordCount(71_449) === 71_000 && setupFns.roundWordCount(17_600) === 18_000 && setupFns.roundWordCount(47) === 50)
ok('a setup knows whether it shows a token', setupFns.setupUsesToken(manuscript, 'surname') && !setupFns.setupUsesToken(manuscript, 'words'))

/* ---------------- the title page ---------------- */

const profile = { byline: 'A. Writer', legalName: 'Alice Writer', address: '1 Main St\nSpringfield', email: 'a@example.com', phone: '', agent: 'Big Agency' }
const [titlePage, ...afterTitle] = titles.buildTitlePages({ setup: manuscript, title: 'The Book', profile, author: 'A. Writer', words: 71_449 })
ok('a manuscript\'s title page gives the contact block, one line each', titlePage.querySelector('.tp-contact').textContent === 'Alice Writer\n1 Main St\nSpringfield\na@example.com\nRepresented by Big Agency')
ok('the rounded word count', titlePage.querySelector('.tp-words').textContent === 'about 71,000 words')
ok('the title and the byline', titlePage.querySelector('.tp-title').textContent === 'The Book' && titlePage.querySelector('.tp-byline').textContent === 'by A. Writer')
ok('the page is set in the manuscript\'s type', titlePage.classList.contains('has-print-type') && titlePage.style.getPropertyValue('--pt-size') === '12pt')
ok('an unmirrored setup adds no blank page after it', afterTitle.length === 0)
const bookTitle = titles.buildTitlePages({ setup: formats.applyFormat('trade-6x9'), title: 'The Book', profile, author: 'A. Writer' })
ok('a book\'s title page is followed by a blank verso, so the text opens on a recto', bookTitle.length === 2 && bookTitle[1].classList.contains('is-blank'))
ok('no title page asked for, none given', titles.buildTitlePages({ setup: normalizePageSetup(null), title: 'x' }).length === 0)
ok('a document\'s text is counted across its blocks',
  titles.textOfContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one two' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'three' }] }] }).trim().split(/\s+/).length === 3)

/* ---------------- compiling a book ---------------- */

const matter = await import('../../src/print/bookMatter.ts')
const front = await import('../../src/print/frontMatter.js')
const bookStore = await import('../../src/print/bookStore.js')
const { files: fsFiles } = await import('./stub-fs.mjs')
const { getProjectRoot } = await import('../../src/lib/projectPaths.ts')
const { buildEpub } = await import('../../src/print/export/epub.ts')
const { buildHtmlDocument } = await import('../../src/print/export/html.ts')

ok('numbers are spelled as chapter headings spell them',
  matter.numberToWords(1) === 'One' && matter.numberToWords(42) === 'Forty-Two' && matter.numberToWords(105) === 'One Hundred Five' &&
  matter.numberToWords(2024) === 'Two Thousand Twenty-Four')
ok('a label in words, numerals or roman, with or without a prefix',
  matter.chapterLabel(7, { style: 'words', prefix: 'Chapter' }) === 'Chapter Seven' &&
  matter.chapterLabel(7, { style: 'numerals', prefix: '' }) === '7' &&
  matter.chapterLabel(4, { style: 'roman', prefix: 'Part' }) === 'Part IV' &&
  matter.chapterLabel(4, { style: 'none', prefix: 'Chapter' }) === null)

const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const h1 = (text) => ({ type: 'heading', attrs: { level: 1, textAlign: 'center' }, content: [{ type: 'text', text }] })
const titled = { type: 'doc', content: [h1('The Storm'), para('Rain.')] }
const bare = { type: 'doc', content: [para('Rain.')] }
const numbered = matter.headChapter(titled, 'doc', 3, { style: 'words', prefix: 'Chapter', includeTitle: true })
ok('a numbered chapter\'s opening heading becomes its number over its title',
  numbered.content.length === 2 && numbered.content[0].attrs.textAlign === 'center' &&
  same(numbered.content[0].content.map((n) => n.text || n.type), ['Chapter Three', 'hardBreak', 'The Storm']))
ok('without its title, the number alone',
  same(matter.headChapter(titled, 'doc', 3, { style: 'numerals', prefix: 'Chapter', includeTitle: false }).content[0].content, [{ type: 'text', text: 'Chapter 3' }]))
ok('a chapter with no heading is titled by its document',
  matter.headChapter(bare, 'Rainfall', 1, { style: 'words', prefix: '', includeTitle: true }).content[0].content.at(-1).text === 'Rainfall')
ok('numbering off leaves a chapter alone, unless an export wants it titled',
  matter.headChapter(bare, 'Rainfall', 1, null) === bare &&
  matter.headChapter(bare, 'Rainfall', 1, null, { insertTitle: true }).content[0].content[0].text === 'Rainfall' &&
  matter.headChapter(titled, 'x', 1, null, { insertTitle: true }) === titled)
ok('a numbered title reads with a colon in contents', matter.chapterTitleOf(numbered, 'x') === 'Chapter Three: The Storm')

const compiledBook = matter.compileBook(
  [{ path: 'B/one', name: 'one', content: titled }, { path: 'B/two', name: 'two', content: bare }],
  { chapterNumbering: { style: 'numerals', prefix: 'Chapter', includeTitle: false }, backMatter: { aboutTheAuthor: 'Lives by the sea.\n\nWrites.', alsoBy: 'First Book\nSecond Book', acknowledgements: ' ' } },
  { author: 'A. Writer' }
)
ok('a book compiles to its numbered chapters, then its back matter',
  same(compiledBook.map((c) => c.name), ['one', 'two', 'About the Author', 'Also by A. Writer']) &&
  compiledBook[1].content.content[0].content[0].text === 'Chapter 2' && compiledBook[2].matter === 'back')
ok('back matter paragraphs split on blank lines; "also by" one title a line',
  compiledBook[2].content.content.length === 3 && compiledBook[3].content.content.length === 3)

const trade = formats.applyFormat('trade-6x9')
const fullFront = { frontMatter: { halfTitle: true, copyright: 'Copyright © 2026', dedication: 'For M.', epigraph: 'All we have to decide…', epigraphSource: 'Gandalf', contents: true } }
const titleOnly = titles.buildTitlePages({ setup: trade, title: 'The Book', author: 'A. Writer' })
const contentsList = Array.from({ length: 3 }, (_, i) => ({ title: `Chapter ${i + 1}`, folio: String(1 + i * 20) }))
const fm = front.buildFrontMatterPages({ setup: trade, book: fullFront, title: 'The Book', titlePages: titleOnly, contents: contentsList })
const kinds = fm.map((p) => ['fm-half-title', 'print-title-page', 'fm-copyright', 'fm-dedication', 'fm-epigraph', 'fm-contents', 'is-blank'].find((c) => p.classList.contains(c)))
ok('front matter runs half-title, title, copyright on its back, dedication, epigraph, contents — each opening on a recto',
  same(kinds, ['fm-half-title', 'is-blank', 'print-title-page', 'fm-copyright', 'fm-dedication', 'is-blank', 'fm-epigraph', 'is-blank', 'fm-contents', 'is-blank']))
ok('and runs to an even count, so the first chapter is a recto', fm.length % 2 === 0)
ok('the contents list each chapter with its folio',
  same(Array.from(fm[8].querySelectorAll('.fm-contents-row')).map((r) => r.lastChild.textContent), ['1', '21', '41']))
const { first: rowsFirst, rest: rowsRest } = front.contentsRowsPerPage(trade)
const longContents = Array.from({ length: rowsFirst + rowsRest + 1 }, (_, i) => ({ title: `C${i}`, folio: String(i) }))
const longFm = front.buildFrontMatterPages({ setup: trade, book: { frontMatter: { contents: true } }, title: 'T', contents: longContents })
ok('a long contents runs on over as many pages as it takes', longFm.filter((p) => p.classList.contains('fm-contents')).length === 3)
const flatFm = front.buildFrontMatterPages({ setup: normalizePageSetup(null), book: { frontMatter: { dedication: 'For M.' } }, title: 'T', titlePages: [] })
ok('without facing pages, no blanks are added', flatFm.length === 1)

/* ---------------- the book file ---------------- */

bookStore.resetBookStore()
const bookRoot = await getProjectRoot('Shelf')
fsFiles.set(`${bookRoot}/.inkblot-books.json`, JSON.stringify({ version: 1, books: { Novel: { title: 'Kept in the Project', excluded: ['Novel/Notes'] } } }))
store.getBookSettings('Shelf', 'Novel')
await bookStore.booksSettled('Shelf')
const shelved = store.getBookSettings('Shelf', 'Novel')
ok('a book is read from the project\'s file, with every default filled in',
  shelved.title === 'Kept in the Project' && same(shelved.excluded, ['Novel/Notes']) &&
  shelved.chapterNumbering.style === 'none' && shelved.frontMatter.contents === false && shelved.binding.binding === 'none')
await store.setBookSettings('Shelf', 'Stories', { ...store.getBookSettings('Shelf', 'Stories'), title: 'Short Ones' })
const onDisk = JSON.parse(fsFiles.get(`${bookRoot}/.inkblot-books.json`))
ok('a change is written to the file, beside the books already there',
  onDisk.books.Stories.title === 'Short Ones' && onDisk.books.Novel.title === 'Kept in the Project')
await bookStore.relocateBooks('Shelf', 'Novel', 'Books/Novel', { folder: true })
ok('a folder\'s book moves with it, and its left-out chapters with them',
  store.getBookSettings('Shelf', 'Books/Novel').title === 'Kept in the Project' &&
  same(store.getBookSettings('Shelf', 'Books/Novel').excluded, ['Books/Novel/Notes']) &&
  !JSON.parse(fsFiles.get(`${bookRoot}/.inkblot-books.json`)).books.Novel)

/* ---------------- exports carry the book ---------------- */

const sections = matter.frontMatterSections(fullFront, { title: 'The Book', author: 'A. Writer', titlePage: true })
ok('an export\'s front matter is the half-title, title page, copyright, dedication and epigraph',
  same(sections.map((s) => s.kind), ['halfTitle', 'titlePage', 'copyright', 'dedication', 'epigraph']))
const htmlBook = buildHtmlDocument({ title: 'The Book', chapters: [{ title: 'Chapter One', content: titled }], front: sections, contents: true })
ok('the HTML carries the front matter and a linked contents',
  htmlBook.includes('class="fm-dedication">For M.</p>') && htmlBook.includes('<a href="#chapter-1">Chapter One</a>') && htmlBook.includes('— Gandalf'))
const { inflateRawSync } = await import('node:zlib')
const { listZip } = await import('../../src/print/export/zip.ts')
const readZipEntry = (bytes, name) => {
  const e = listZip(bytes).find((entry) => entry.name === name)
  if (!e) return ''
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  const start = e.offset + 30 + view.getUint16(e.offset + 26, true) + e.extraLength
  const size = view.getUint32(e.offset + 18, true)
  const raw = bytes.subarray(start, start + size)
  return (e.method === 8 ? inflateRawSync(raw) : Buffer.from(raw)).toString('utf8')
}
globalThis.XMLSerializer ??= dom.window.XMLSerializer
globalThis.DOMParser ??= dom.window.DOMParser
const epubBook = await buildEpub({ title: 'The Book', chapters: [{ title: 'Chapter One', content: titled }], resolveImage: async () => null, front: sections, contents: true, identifier: 'urn:x', modified: new Date(0) })
const opfBook = readZipEntry(epubBook, 'OEBPS/content.opf')
ok('the EPUB reads front matter, contents, then chapters',
  opfBook.indexOf('idref="front-01"') > 0 &&
  opfBook.indexOf('idref="front-01"') < opfBook.indexOf('idref="contents"') && opfBook.indexOf('idref="contents"') < opfBook.indexOf('idref="chapter-001"') &&
  readZipEntry(epubBook, 'OEBPS/text/front-04.xhtml').includes('epub:type="dedication"'))

const fontBytes = new Uint8Array([0, 1, 0, 0, 0, 0])
const epubStyled = await buildEpub({
  title: 'The Book', chapters: [{ title: 'Chapter One', content: titled }], resolveImage: async () => null,
  css: 'body { font-family: "EB Garamond"; }',
  fonts: [{ family: 'EB Garamond', weight: 400, style: 'normal', format: 'opentype', mime: 'font/otf', file: 'EB Garamond.otf', bytes: fontBytes }],
  identifier: 'urn:x', modified: new Date(0),
})
const styles = readZipEntry(epubStyled, 'OEBPS/styles.css')
ok('an EPUB carries the book’s stylesheet, and the font it is set in, declared and listed',
  styles.startsWith('@font-face { font-family: "EB Garamond"; src: url("fonts/EB_Garamond.otf") format("opentype");') &&
  styles.includes('body { font-family: "EB Garamond"; }') &&
  readZipEntry(epubStyled, 'OEBPS/content.opf').includes('<item id="font-1" href="fonts/EB_Garamond.otf" media-type="font/otf"/>') &&
  listZip(epubStyled).some((e) => e.name === 'OEBPS/fonts/EB_Garamond.otf'))

/* ---------------- Word ---------------- */

const { buildDocx, twips, hexColor } = await import('../../src/print/export/docx.ts')
const { toPlainText, wrapText } = await import('../../src/print/export/text.ts')
const { parsePageRanges, recipientPath } = await import('../../src/print/printJob.js')

// A 1×1 PNG, the smallest picture there is.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='
const { decodeDataUri, imageSize } = await import('../../src/print/export/images.ts')
ok('an image\'s size is read from its header', same(imageSize(decodeDataUri(PNG)), { width: 1, height: 1 }))

const richChapter = {
  type: 'doc',
  content: [
    h1('The Storm'),
    { type: 'paragraph', attrs: { textAlign: 'justify' }, content: [
      { type: 'text', text: 'Bold & ', marks: [{ type: 'bold' }] },
      { type: 'text', text: 'red', marks: [{ type: 'textStyle', attrs: { color: 'rgb(255, 0, 0)', fontSize: '18px' } }] },
      { type: 'text', text: ' link', marks: [{ type: 'link', attrs: { href: 'https://example.com/?a=1&b=2' } }] },
    ] },
    { type: 'horizontalRule' },
    { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [para('three'), { type: 'bulletList', content: [{ type: 'listItem', content: [para('inner')] }] }] }] },
    { type: 'table', content: [
      { type: 'tableRow', content: [{ type: 'tableHeader', attrs: { colspan: 1, rowspan: 2 }, content: [para('A')] }, { type: 'tableHeader', content: [para('B')] }] },
      { type: 'tableRow', content: [{ type: 'tableCell', content: [para('b2')] }] },
    ] },
    { type: 'image', attrs: { src: PNG, width: 5000 } },
    { type: 'pageBreak', attrs: { kind: 'recto' } },
    para('After the break.'),
  ],
}
const wordSetup = { ...formats.applyFormat('manuscript'), differentFirstPage: true, versoHeader: { left: '{page}', center: '', right: '' } }
const docx = await buildDocx({
  title: 'The Book', author: 'Ann Writer', setup: wordSetup, chapters: [{ title: 'One', content: richChapter }, { title: 'Two', content: bare }],
  front: [{ kind: 'titlePage', title: 'The Book', author: 'Ann Writer' }, { kind: 'dedication', text: 'For M.' }], contents: true,
  profile, words: 71_449, resolveImage: async (src) => decodeDataUri(src), modified: new Date(0),
})
const wordNames = listZip(docx).map((e) => e.name)
ok('a Word file has its parts, headers, footers and the picture',
  ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/settings.xml', 'word/numbering.xml',
    'word/_rels/document.xml.rels', 'docProps/core.xml', 'word/header1.xml', 'word/footer1.xml', 'word/media/image1.png'].every((n) => wordNames.includes(n)))
const xmlOk = (name) => {
  const text = readZipEntry(docx, name)
  return text && !new dom.window.DOMParser().parseFromString(text, 'application/xml').querySelector('parsererror')
}
ok('every part is well-formed XML', wordNames.filter((n) => /\.(xml|rels)$/.test(n)).every(xmlOk))
const wordDoc = readZipEntry(docx, 'word/document.xml')
const styledDocx = await buildDocx({
  title: 'Letters', setup: wordSetup, chapters: [{ title: 'One', content: { type: 'doc', content: [{ type: 'paragraph', attrs: { styleName: 'letter' }, content: [{ type: 'text', text: 'Dear M,' }] }] } }],
  textStyles: [{ id: 'letter', name: 'Letter', size: 1, italic: true, smallCaps: false, align: 'inherit', indentEm: 2, flush: true, spaceLines: 1, boxed: false }],
  resolveImage: async () => null, modified: new Date(0),
})
const notedDocx = await buildDocx({
  title: 'Notes', setup: wordSetup, chapters: [{ title: 'One', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'It rained.' }, { type: 'footnote', attrs: { id: 'n1', text: 'Or so they said.', mark: '1' } }] }] } }],
  resolveImage: async () => null, modified: new Date(0),
})
ok('a note at its mark is a Word footnote: referenced in the text, written in the footnotes part, which the package lists',
  readZipEntry(notedDocx, 'word/document.xml').includes('<w:footnoteReference w:id="1"/>') &&
  readZipEntry(notedDocx, 'word/footnotes.xml').includes('<w:footnote w:id="1"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/>') &&
  readZipEntry(notedDocx, 'word/footnotes.xml').includes('Or so they said.') &&
  readZipEntry(notedDocx, '[Content_Types].xml').includes('/word/footnotes.xml') &&
  readZipEntry(notedDocx, 'word/_rels/document.xml.rels').includes('Target="footnotes.xml"') &&
  readZipEntry(notedDocx, 'word/settings.xml').includes('<w:footnotePr>'))
const epubNoted = await buildEpub({ title: 'Notes', chapters: [{ title: 'One', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'It rained.' }, { type: 'footnote', attrs: { id: 'n1', text: 'Or so they said.', mark: '1' } }] }] } }], resolveImage: async () => null, identifier: 'urn:x', modified: new Date(0) })
const notedXhtml = readZipEntry(epubNoted, 'OEBPS/text/chapter-001.xhtml')
ok('an EPUB chapter carries its notes as pop-up notes, in well-formed XHTML',
  notedXhtml.includes('epub:type="noteref"') && notedXhtml.includes('<aside epub:type="footnote"') &&
  !new DOMParser().parseFromString(notedXhtml, 'application/xhtml+xml').querySelector('parsererror'), notedXhtml)
ok('a named text style is a Word paragraph style of the same name, and the paragraph is in it',
  readZipEntry(styledDocx, 'word/styles.xml').includes('<w:style w:type="paragraph" w:customStyle="1" w:styleId="Textletter"><w:name w:val="Letter"/>') &&
  readZipEntry(styledDocx, 'word/styles.xml').includes('<w:i/>') &&
  readZipEntry(styledDocx, 'word/document.xml').includes('<w:pStyle w:val="Textletter"/>'))
const wordRels = readZipEntry(docx, 'word/_rels/document.xml.rels')
ok('the page is Letter in twips, one-inch margins', wordDoc.includes('<w:pgSz w:w="12240" w:h="15840"/>') && wordDoc.includes('w:top="1440"') && twips(25.4) === 1440)
ok('front matter, then a section per chapter, the break to a right-hand page starting one of its own',
  (wordDoc.match(/<w:sectPr>/g) || []).length === 4 && (wordDoc.match(/w:val="oddPage"/g) || []).length === 1)
ok('numbering starts with the first chapter, which has no running head on its first page',
  (wordDoc.match(/w:start="1"/g) || []).length === 1 && wordDoc.includes('<w:titlePg/>'))
ok('the manuscript title page carries the contact block and the rounded word count', wordDoc.includes('Alice Writer') && wordDoc.includes('about 71,000 words'))
ok('the contents are a Word TOC field, updated on opening',
  wordDoc.includes('TOC \\o &quot;1-1&quot;') && readZipEntry(docx, 'word/settings.xml').includes('<w:updateFields w:val="true"/>'))
ok('text is escaped, and the link is a relationship with its ampersand escaped',
  wordDoc.includes('Bold &amp; ') && wordRels.includes('Target="https://example.com/?a=1&amp;b=2" TargetMode="External"'))
ok('a colour and a size become run properties', wordDoc.includes('<w:color w:val="FF0000"/><w:sz w:val="27"/>') && hexColor('#abc') === 'AABBCC')
ok('a scene break is the manuscript\'s glyph, centred', wordDoc.includes('<w:pStyle w:val="SceneBreak"/></w:pPr><w:r><w:t xml:space="preserve">#</w:t>'))
ok('an ordered list restarts at its own start; a nested list is a level deeper',
  readZipEntry(docx, 'word/numbering.xml').includes('<w:startOverride w:val="3"/>') && wordDoc.includes('<w:ilvl w:val="1"/>'))
ok('a row-spanning cell continues into the row below', wordDoc.includes('<w:vMerge w:val="restart"/>') && wordDoc.includes('<w:vMerge/>'))
ok('a picture is capped at the text\'s width', (() => {
  const cx = Number(/<wp:extent cx="(\d+)"/.exec(wordDoc)?.[1])
  return cx > 0 && cx <= Math.round((215.9 - 50.8) * (96 / 25.4) * 9525) + 1
})())
const wordHeader = readZipEntry(docx, 'word/header1.xml')
ok('the running head is surname / title / page, the page a live field',
  wordHeader.replace(/<[^>]+>/g, '').trim() === 'Writer / The Book / 1' && wordHeader.includes('w:instr=" PAGE "'))
ok('left-hand heads differ, so the settings say so', readZipEntry(docx, 'word/settings.xml').includes('<w:evenAndOddHeaders/>'))
ok('the manuscript\'s type is the Normal style: Courier, 12 pt, double, half-inch indent',
  readZipEntry(docx, 'word/styles.xml').includes('w:ascii="Courier Prime"') && readZipEntry(docx, 'word/styles.xml').includes('<w:sz w:val="24"/>') &&
  readZipEntry(docx, 'word/styles.xml').includes('w:line="480"') && readZipEntry(docx, 'word/styles.xml').includes('<w:ind w:firstLine="720"/>'))

/* ---------------- plain text ---------------- */

ok('plain text: headings, lists, a scene break, and no trailing space',
  toPlainText(richChapter, { sceneBreak: '#' }).startsWith('The Storm\n\nBold & red link\n\n') &&
  toPlainText(richChapter, { sceneBreak: '#' }).includes('3. three\n\n   - inner') && !/ \n/.test(toPlainText(richChapter)))
ok('wrapping at 72 breaks between words and indents what follows a marker',
  wrapText('word '.repeat(30).trim(), 20, '- ').split('\n').every((l) => l.length <= 20) && wrapText('a b', 20, '- ') === '- a b')

/* ---------------- print options ---------------- */

ok('page ranges read as typed', same([...parsePageRanges('3-5, 9; 7–6')].sort((a, b) => a - b), [3, 4, 5, 6, 7, 9]) && parsePageRanges('  ') === null && parsePageRanges('abc') === null)
ok('a copy for each reader is a file of its own', recipientPath('/Users/a/Book.pdf', 'Sam: Reader') === '/Users/a/Book – Sam- Reader.pdf')

/* ---------------- publishing ---------------- */

const pre = await import('../../src/print/preflight.ts')
ok('a 300-page cream book\'s spine is 0.75 in', Math.abs(pre.spineWidthMm({ pageCount: 300, paper: 'cream', service: 'kdp' }) - 0.75 * 25.4) < 1e-9)
ok('reading time at 250 words a minute', pre.readingMinutes(71_400) === 286)
const tradeBook = formats.applyFormat('trade-6x9')
const clean = pre.preflight({ setup: { ...tradeBook, margins: { ...tradeBook.margins, gutterMm: 10 } }, target: { service: 'kdp', paper: 'cream' }, pageCount: 212 })
ok('a trade paperback with room at the spine passes KDP', clean.length === 0)
const letterIssues = pre.preflight({ setup: formats.applyFormat('letter'), target: { service: 'kdp', paper: 'cream' }, pageCount: 17 })
const issueIds = letterIssues.map((i) => i.id)
ok('a Letter manuscript is caught for facing pages, too few pages and an odd count — Letter itself KDP prints',
  ['mirror', 'pages-min', 'odd'].every((id) => issueIds.includes(id)) && !issueIds.includes('trim') && !issueIds.includes('gutter'))
const a5 = formats.applyFormat('a5-novel')
const a5Trim = pre.preflight({ setup: a5, target: { service: 'kdp', paper: 'cream' }, pageCount: 0 }).find((i) => i.id === 'trim')
ok('A5 is not a KDP trim; the fix is the listed size nearest it, 5.5 × 8.5 in',
  a5Trim && Math.abs(a5Trim.fixedSetup.widthMm - 5.5 * 25.4) < 0.01 && Math.abs(a5Trim.fixedSetup.heightMm - 8.5 * 25.4) < 0.01 &&
  a5Trim.fixedSetup.formatId === a5.formatId)
ok('IngramSpark prints A5', !pre.preflight({ setup: a5, target: { service: 'ingramSpark', paper: 'cream' }, pageCount: 0 }).some((i) => i.id === 'trim'))
const thinGutter = pre.preflight({ setup: { ...tradeBook, margins: { ...tradeBook.margins, insideMm: 10, gutterMm: 0 } }, target: { service: 'ingramSpark', paper: 'white' }, pageCount: 420 })
const gutterFix = thinGutter.find((i) => i.id === 'gutter')
ok('a thick book with a thin gutter is widened to what its length needs',
  gutterFix && Math.abs(gutterFix.fixedSetup.margins.insideMm + gutterFix.fixedSetup.margins.gutterMm - 0.625 * 25.4) < 0.01)
const edgeIssue = pre.preflight({ setup: { ...tradeBook, margins: { ...tradeBook.margins, outsideMm: 3 } }, target: { service: 'kdp', paper: 'cream' }, pageCount: 0 }).find((i) => i.id === 'edges')
ok('an outside margin under a quarter inch is widened to it', edgeIssue && edgeIssue.fixedSetup.margins.outsideMm === 6.35)
ok('a picture printed at 150 dpi is flagged', pre.preflight({ setup: tradeBook, target: { service: 'kdp', paper: 'cream' }, pageCount: 0, images: [{ pixelsWide: 600, printedInches: 4 }] }).some((i) => i.id === 'dpi'))
ok('no service, no checks', pre.preflight({ setup: formats.applyFormat('letter'), target: { service: 'none', paper: 'cream' }, pageCount: 3 }).length === 0)

/* ---------------- scripts ---------------- */

const scriptEls = await import('../../src/script/elements.ts')
const { readBlockType, readWritingFormat } = await import('../../src/bridge/readState.ts')
const { suggestionFor } = await import('../../src/script/ScriptElement.ts')

ok('Enter after a character is dialogue; after dialogue, action; on an empty action line, the next speaker',
  scriptEls.nextOnEnter('character', 'MARY').next === 'dialogue' && scriptEls.nextOnEnter('dialogue', 'Hi.').next === 'action' &&
  scriptEls.nextOnEnter('action', '').change === 'character')
ok('Tab runs action, character, transition, action; dialogue and parenthetical swap',
  scriptEls.nextOnTab('action') === 'character' && scriptEls.nextOnTab('character') === 'transition' &&
  scriptEls.nextOnTab('transition') === 'action' && scriptEls.nextOnTab('dialogue') === 'parenthetical' && scriptEls.nextOnTab('parenthetical') === 'dialogue')
ok('a character\'s extension is not part of their name', scriptEls.characterName('Mary (V.O.)') === 'MARY')
ok('a scene heading\'s location', scriptEls.sceneLocation('INT. KITCHEN - NIGHT') === 'KITCHEN')

globalThis.KeyboardEvent ??= dom.window.KeyboardEvent
const scriptEditor = (content) => new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions(StarterKit.configure({})), content })
const line = (element, text = '') => ({ type: 'scriptElement', attrs: { element }, content: text ? [{ type: 'text', text }] : [] })
const elementsOf = (ed) => { const out = []; ed.state.doc.forEach((n) => out.push(n.type.name === 'scriptElement' ? n.attrs.element : n.type.name)); return out }
const textsOf = (ed) => { const out = []; ed.state.doc.forEach((n) => out.push(n.textContent)); return out }
const endOf = (ed, index) => { let pos = 0; ed.state.doc.forEach((n, p, i) => { if (i === index) pos = p + n.nodeSize - 1 }); return pos }

const prose = scriptEditor({ type: 'doc', content: [h1('Kitchen'), para('She waits.')] })
prose.commands.setWritingFormat('screenplay')
ok('written as a screenplay, a heading is a scene heading and a paragraph is action',
  readWritingFormat(prose) === 'screenplay' && same(elementsOf(prose), ['sceneHeading', 'action']) && prose.view.dom.classList.contains('is-screenplay'))
prose.commands.setWritingFormat('stageplay')
ok('as a play, the action becomes stage directions', same(elementsOf(prose), ['sceneHeading', 'stageDirection']))
prose.commands.setWritingFormat('prose')
ok('and back to prose, nothing lost', same(elementsOf(prose), ['heading', 'paragraph']) && same(textsOf(prose), ['Kitchen', 'She waits.']) && !prose.view.dom.classList.contains('is-script'))
prose.destroy()

const script = scriptEditor({ type: 'doc', attrs: { writingFormat: 'screenplay' }, content: [line('character', 'MARGARET'), line('dialogue', 'Hello.'), line('action', 'She sits.')] })
script.commands.setTextSelection(endOf(script, 0))
script.commands.keyboardShortcut('Enter')
ok('Enter at the end of a character makes a dialogue line', same(elementsOf(script), ['character', 'dialogue', 'dialogue', 'action']))
ok('which the menu reads as dialogue', readBlockType(script) === 'dialogue')
script.commands.keyboardShortcut('Enter')
ok('Enter on the empty dialogue line makes it action instead', same(elementsOf(script), ['character', 'action', 'dialogue', 'action']))
script.commands.keyboardShortcut('Enter')
ok('and Enter again makes it the next speaker', elementsOf(script)[1] === 'character')
script.commands.insertContent('MA')
ok('a name used before is offered', suggestionFor(script.state.doc, 'character', 'MA') === 'MARGARET')
script.commands.keyboardShortcut('Tab')
ok('and Tab takes it', textsOf(script)[1] === 'MARGARET')
script.commands.keyboardShortcut('Enter')
script.commands.insertContent('(')
ok('"(" opening a speech makes a parenthetical, closed', elementsOf(script)[2] === 'parenthetical' && textsOf(script)[2] === '()')
script.destroy()

const typing = scriptEditor({ type: 'doc', attrs: { writingFormat: 'screenplay' }, content: [line('action')] })
typing.commands.setTextSelection(1)
typing.commands.insertContent('INT. ')
ok('"INT. " typed into action makes a scene heading', elementsOf(typing)[0] === 'sceneHeading')
typing.commands.keyboardShortcut('Enter')
typing.commands.insertContent('CUT TO:')
typing.commands.keyboardShortcut('Enter')
ok('a capitalised line ending "TO:" is a transition, and a scene heading follows', same(elementsOf(typing), ['sceneHeading', 'transition', 'sceneHeading']))
// ⌥⌘1–8 choose by the menu's order; which key "Mod" is depends on the platform.
typing.commands.setScriptElement(scriptEls.elementsFor('screenplay')[1].id)
ok('⌥⌘2 is action', elementsOf(typing)[2] === 'action')
typing.destroy()

/* ---------------- a script across pages ---------------- */

const { paginate } = await import('../../src/print/paginate.ts')
const pgFrame = { slotHeight: 100, stride: 100, columns: 1, minLines: 2 }
// A line is 10 px; units are laid end to end from `top`, positions 10 apart per line.
const textUnit = (pos, top, count, extra = {}) => ({
  kind: 'text', pos, top, bottom: top + count * 10,
  lines: Array.from({ length: count }, (_, i) => ({ top: top + i * 10, bottom: top + i * 10 + 10, pos: pos + 1 + i * 10 })),
  ...extra,
})
const sentencesAt = (...indexes) => ({ split: 'sentences', canBreakBefore: (k) => indexes.includes(k), continuation: { cue: 'MARY' } })

const speech = paginate([textUnit(0, 0, 6), textUnit(100, 60, 7, sentencesAt(3, 5))], pgFrame)
ok('a speech breaks at a sentence, leaving room for (MORE), and the next page opens a line down for the name',
  speech.pushes.length === 1 && speech.pushes[0].kind === 'line' && speech.pushes[0].pos === 131 && speech.pushes[0].height === 20 &&
  same(speech.continuations, [{ pos: 131, cue: 'MARY' }]))

const noSentence = paginate([textUnit(0, 0, 6), textUnit(100, 60, 7, sentencesAt())], pgFrame)
ok('a speech with no sentence ending where it could break goes over whole', noSentence.pushes[0].kind === 'block' && noSentence.continuations.length === 0)

const speaker = paginate([textUnit(0, 0, 8), textUnit(100, 80, 1, { keepWithNext: true }), textUnit(200, 90, 4, sentencesAt())], pgFrame)
ok('and takes its speaker with it', speaker.pushes[0].kind === 'block' && speaker.pushes[0].pos === 100 && speaker.pushes[0].height === 20)

const paren = paginate([textUnit(0, 0, 9), textUnit(100, 90, 2, { split: 'never' })], pgFrame)
ok('a parenthetical never splits', paren.pushes.length === 1 && paren.pushes[0].kind === 'block')

const transition = paginate([textUnit(0, 0, 7), textUnit(100, 70, 1, { keepWithNext: true }), textUnit(200, 80, 2), textUnit(300, 100, 1, { keepWithPrevious: true })], pgFrame)
ok('a transition never opens a page: the speech and speaker before it come over with it',
  transition.pushes.length === 1 && transition.pushes[0].pos === 100 && transition.pushes[0].height === 30 && transition.pageCount === 2)

const prosePages = paginate([textUnit(0, 0, 6), textUnit(100, 60, 7)], pgFrame)
ok('prose is split between lines as before, with no continuations', prosePages.slotStarts[1] === 141 && prosePages.continuations.length === 0)

const { sceneNumbers } = await import('../../src/script/DocWritingFormat.js')
const sceneEditor = scriptEditor({ type: 'doc', attrs: { writingFormat: 'screenplay' }, content: [line('sceneHeading', 'INT. A'), line('action', 'x'), line('sceneHeading', 'EXT. B')] })
const labels = (ed) => [...sceneNumbers(ed.state.doc).values()]
ok('scenes are unnumbered until asked', labels(sceneEditor).length === 0)
sceneEditor.commands.setSceneNumbers('on')
ok('then numbered in order', same(labels(sceneEditor), ['1', '2']) && sceneEditor.view.dom.querySelector('[data-scene-number="2"]'))
sceneEditor.commands.setSceneNumbers('locked')
sceneEditor.commands.setTextSelection(endOf(sceneEditor, 1))
sceneEditor.commands.keyboardShortcut('Enter')
sceneEditor.commands.setScriptElement('sceneHeading')
sceneEditor.commands.insertContent('INT. C')
ok('locked, a scene added between 1 and 2 is 1A', same(labels(sceneEditor), ['1', '1A', '2']))
sceneEditor.commands.setSceneNumbers('on')
ok('unlocked, they number in order again', same(labels(sceneEditor), ['1', '2', '3']))
sceneEditor.destroy()

ok('the Screenplay format is Courier on exact 12-point lines, 1½-inch left margin, no number on page one',
  (() => { const f = formats.applyFormat('screenplay'); return f.typography.lineSpacing === 'exact' && f.typography.lineValue === 12 && f.margins.insideMm === 38.1 && f.differentFirstPage && f.header.right === '{page}.' })())
ok('and makes a document a screenplay', formats.writingFormatOf('screenplay') === 'screenplay' && formats.writingFormatOf('stageplay') === 'stageplay' && formats.writingFormatOf('letter') === null)

/* ---------------- Fountain and Final Draft ---------------- */

const { parseFountain, serializeFountain } = await import('../../src/script/fountain.ts')
const { buildFdx } = await import('../../src/print/export/fdx.ts')

const FOUNTAIN = `Title: Brick & Steel
Credit: Written by
Author: Stu Maschwitz
Draft date: 1/20/2012
Contact:
    Next Level Productions
    1588 Mission Dr.

EXT. BRICK'S PATIO - DAY #1#

A gorgeous day.  The sun is shining. [[A note.]]

/* A scene cut
for time. */

BRICK (V.O.)
(quietly)
I love this *patio*.

STEEL ^
And I **love** you.

CUT TO:

.FLASHBACK

> THE END <

@McCLANE
Yippee.

!SILENCE.

===

INT. HOUSE - NIGHT
Brick sits.
`

const parsed = parseFountain(FOUNTAIN)
const els = parsed.doc.content.map((n) => n.type === 'scriptElement' ? n.attrs.element : n.type)
const textOf = (n) => (n.content || []).map((c) => c.text || (c.type === 'hardBreak' ? '\n' : '')).join('')
ok('Fountain: the title page block', parsed.titlePage.title === 'Brick & Steel' && parsed.titlePage.author === 'Stu Maschwitz' && parsed.titlePage.contact === 'Next Level Productions\n1588 Mission Dr.')
ok('Fountain: every element, with notes and the boneyard left out', same(els, [
  'sceneHeading', 'action', 'character', 'parenthetical', 'dialogue', 'character', 'dialogue', 'transition',
  'sceneHeading', 'centered', 'character', 'dialogue', 'action', 'pageBreak', 'sceneHeading', 'action',
]), els.join(','))
ok('Fountain: scene numbers are kept, locked', parsed.doc.content[0].attrs.sceneNumber === '1' && parsed.doc.attrs.sceneNumbers === 'locked' && textOf(parsed.doc.content[0]) === "EXT. BRICK'S PATIO - DAY")
ok('Fountain: a note is gone from the action', textOf(parsed.doc.content[1]) === 'A gorgeous day.  The sun is shining.')
ok('Fountain: emphasis becomes marks', parsed.doc.content[4].content.some((c) => c.text === 'patio' && c.marks?.[0]?.type === 'italic'))
ok('Fountain: ^ is dual dialogue', parsed.doc.content[5].attrs.dual === true && textOf(parsed.doc.content[5]) === 'STEEL')
ok('Fountain: a forced character and forced action', textOf(parsed.doc.content[10]) === 'McCLANE' && textOf(parsed.doc.content[12]) === 'SILENCE.')
ok('Fountain: "FADE IN:" opening a script is not a title page', parseFountain('FADE IN:\n\nINT. A - DAY\n').doc.content[1].attrs.element === 'sceneHeading')

const written = serializeFountain(parsed.doc, { titlePage: parsed.titlePage })
const again = parseFountain(written)
const shape = (doc) => doc.content.map((n) => [n.type === 'scriptElement' ? n.attrs.element : n.type, textOf(n).toUpperCase(), Boolean(n.attrs?.dual)])
ok('Fountain: what is written reads back the same', same(shape(again.doc), shape(parsed.doc)) && again.titlePage.author === 'Stu Maschwitz', written)
ok('Fountain: a heading without its keyword is forced; a name in capitals needs no @',
  written.includes('\n.FLASHBACK #1A#\n') && written.includes('\nMCCLANE\nYippee.') && written.includes('\nSILENCE.\n'))
ok('Fountain: a lower-case name is forced', serializeFountain({ type: 'doc', content: [line('character', 'Dr. 3'), line('dialogue', 'Hi')] }).startsWith('DR. 3\n') &&
  serializeFountain({ type: 'doc', content: [line('character', '42'), line('dialogue', 'Hi')] }).startsWith('@42\n'))
ok('Fountain: capitals in action with speech under them are forced, so they are not read as a name',
  serializeFountain({ type: 'doc', content: [line('action', 'BANG'), line('dialogue', 'Ow.')] }).startsWith('!BANG'))

const fdx = buildFdx(parsed.doc, { titlePage: parsed.titlePage })
const fdxDoc = new DOMParser().parseFromString(fdx, 'application/xml')
ok('FDX: parses as XML', !fdxDoc.querySelector('parsererror'))
const fdxTypes = [...fdxDoc.querySelectorAll('FinalDraft > Content > Paragraph')].map((p) => p.getAttribute('Type') || 'Dual')
ok('FDX: paragraph types, the dual speeches in one', same(fdxTypes.slice(0, 4), ['Scene Heading', 'Action', 'Dual', 'Transition']), fdxTypes.join(','))
ok('FDX: scene number, styled runs, a page break and the title page',
  fdxDoc.querySelector('Paragraph[Type="Scene Heading"]').getAttribute('Number') === '1' &&
  fdxDoc.querySelector('Text[Style="Italic"]')?.textContent === 'patio' &&
  fdxDoc.querySelectorAll('Paragraph[StartsNewPage="Yes"]').length === 1 &&
  fdxDoc.querySelector('TitlePage Text')?.textContent === 'BRICK & STEEL')

const { toMarkdown } = await import('../../src/print/export/markdown.ts')
const scriptDoc = { type: 'doc', attrs: { writingFormat: 'screenplay' }, content: [line('sceneHeading', 'int. kitchen - day'), line('action', 'Rain.'), line('character', 'mary'), line('parenthetical', '(quietly)'), line('dialogue', 'Hello.'), line('transition', 'cut to:')] }
const scriptDocx = await buildDocx({ title: 'Script', author: '', setup: formats.applyFormat('screenplay'), chapters: [{ title: 'Script', content: scriptDoc }], front: [], contents: false, profile, words: 0, resolveImage: async () => null, modified: new Date(0) })
const scriptStyles = readZipEntry(scriptDocx, 'word/styles.xml')
const scriptBody = readZipEntry(scriptDocx, 'word/document.xml')
ok('Word: a script gets its element styles, and its lines use them',
  scriptStyles.includes('w:styleId="ScriptCharacter"') && scriptStyles.includes('<w:name w:val="Dialogue"/>') &&
  scriptBody.includes('<w:pStyle w:val="ScriptParenthetical"/>') && scriptBody.includes('<w:pStyle w:val="ScriptTransition"/>') &&
  !new dom.window.DOMParser().parseFromString(scriptStyles, 'application/xml').querySelector('parsererror'))
ok('Word: prose gets no script styles', !readZipEntry(docx, 'word/styles.xml').includes('ScriptCharacter'))
ok('plain text: a script in its columns, a speech under its name', toPlainText(scriptDoc) === [
  'INT. KITCHEN - DAY', '', 'Rain.', '', `${' '.repeat(22)}MARY`, `${' '.repeat(16)}(quietly)`, `${' '.repeat(10)}Hello.`, '', `${' '.repeat(53)}CUT TO:`,
].join('\n'), JSON.stringify(toPlainText(scriptDoc)))
ok('Markdown: a script reads as one, a speech hanging from its name',
  toMarkdown(scriptDoc) === '**INT. KITCHEN - DAY**\n\nRain.\n\nMARY  \n(quietly)  \nHello.\n\nCUT TO:\n', JSON.stringify(toMarkdown(scriptDoc)))

/* ---------------- script reports ---------------- */

const { breakdown, formatEighths, reportCsv, reportDocument } = await import('../../src/script/reports.ts')
const shoot = {
  type: 'doc',
  attrs: { writingFormat: 'screenplay', sceneNumbers: 'on' },
  content: [
    line('sceneHeading', 'INT. KITCHEN - NIGHT'), line('action', 'Rain on the glass.'),
    line('character', 'MARY'), line('dialogue', 'You came back, then.'),
    line('character', 'JOHN (V.O.)'), line('parenthetical', '(quietly)'), line('dialogue', 'I did.'),
    line('character', 'MARY'), line('dialogue', 'Why?'),
    line('sceneHeading', 'EXT. GARDEN - DAY'), line('action', 'John, alone.'),
    line('sceneHeading', 'INT. KITCHEN - DAY'), line('character', 'JOHN'), line('dialogue', 'Hello, "house", again.'),
  ],
}
const b = breakdown(shoot)
ok('breakdown: scenes with numbers, settings, places, times and cast',
  same(b.scenes.map((s) => [s.number, s.setting, s.location, s.time, s.cast]), [
    ['1', 'INT', 'KITCHEN', 'NIGHT', ['MARY', 'JOHN']], ['2', 'EXT', 'GARDEN', 'DAY', []], ['3', 'INT', 'KITCHEN', 'DAY', ['JOHN']],
  ]), JSON.stringify(b.scenes))
ok('breakdown: characters by speeches, words spoken, scenes, extensions dropped',
  same(b.characters.map((c) => [c.name, c.speeches, c.words, c.scenes, c.firstScene]), [['JOHN', 2, 5, 2, '1'], ['MARY', 2, 5, 1, '1']]), JSON.stringify(b.characters))
ok('breakdown: places, most screen time first', b.locations[0].name === 'KITCHEN' && same(b.locations[0].scenes, ['1', '3']) && same(b.locations[0].settings, ['INT']))
ok('breakdown: every scene is at least an eighth, and a short script is on page 1', b.scenes.every((s) => s.eighths >= 1 && s.page === 1))
ok('breakdown: positions match the editor\'s', (() => {
  const ed = scriptEditor(shoot)
  const fromEditor = breakdown(ed.state.doc).scenes.map((s) => s.pos)
  ed.destroy()
  return same(fromEditor, b.scenes.map((s) => s.pos))
})())
ok('breakdown: pages from the layout when there is one', breakdown(shoot, (pos) => (pos > 100 ? 2 : 1)).scenes.map((s) => s.page).join() === '1,2,2')
ok('eighths are written as a production writes them', formatEighths(3) === '3/8' && formatEighths(8) === '1' && formatEighths(10) === '1 2/8')
const csv = reportCsv('scenes', b)
ok('a report as CSV: headings, a row a scene, quoting where needed, CRLF',
  csv.startsWith('Scene,Heading,Page,Length,Cast\r\n1,INT. KITCHEN - NIGHT,1,') && csv.includes('"MARY, JOHN"') && csv.endsWith('\r\n'))
ok('a quote in a cell is doubled', reportCsv('characters', { characters: [{ name: 'THE "BOSS"', speeches: 1, words: 1, scenes: 1, firstScene: '1', firstPage: 1 }], scenes: [], locations: [] }).includes('"THE ""BOSS"""'))
const reportDoc = reportDocument('characters', b, 'Script')
ok('a report as a document: a heading and a table with a header row', reportDoc.content[0].type === 'heading' && reportDoc.content[1].type === 'table' &&
  reportDoc.content[1].content[0].content[0].type === 'tableHeader' && reportDoc.content[1].content.length === 3)

const { scriptSummary } = await import('../../src/print/usePrintLayoutController.js')
const summaryEd = scriptEditor(shoot)
const summary = scriptSummary(summaryEd, null)
ok('the Publish tab is told a script\'s scenes and cast', summary.format === 'screenplay' && summary.sceneNumbers === 'on' &&
  same(summary.characters, ['JOHN', 'MARY']) && summary.scenes.length === 3 && summary.scenes[2].number === '3')
summaryEd.destroy()
ok('and nothing for prose', scriptSummary(new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions(StarterKit.configure({})), content: '<p>Once.</p>' }), null) === undefined)

const { pagesOfScenes, highlightSpeeches } = await import('../../src/print/printJob.js')
const fakePage = (pos, lines = []) => {
  const page = document.createElement('div')
  if (pos != null) page.dataset.pos = String(pos)
  for (const [element, text] of lines) {
    const p = document.createElement('p')
    p.className = `script-el script-${element}`
    p.textContent = text
    page.appendChild(p)
  }
  return page
}
const sidesEd = scriptEditor(shoot)
const [s1, s2, s3] = breakdown(sidesEd.state.doc).scenes.map((s) => s.pos)
const sidePages = [fakePage(null), fakePage(0), fakePage(s2 - 5), fakePage(s3 + 2)]
ok('sides: the pages a chosen scene is on, a page it starts partway down included, never the title page',
  same(pagesOfScenes(sidePages, sidesEd, [1]).map((p) => p.dataset.pos), [String(s2 - 5)]) &&
  same(pagesOfScenes(sidePages, sidesEd, [0]).map((p) => p.dataset.pos), [String(s1), String(s2 - 5)]))
sidesEd.destroy()
const actorPages = [
  fakePage(0, [['character', 'MARY'], ['dialogue', 'Hi.'], ['character', 'JOHN'], ['parenthetical', '(beat)'], ['dialogue', 'Hello.']]),
  fakePage(50, [['dialogue', 'And more.'], ['action', 'She goes.'], ['character', 'John (cont\'d)'], ['dialogue', 'Wait.']]),
]
highlightSpeeches(actorPages, 'John')
const marked = actorPages.flatMap((p) => [...p.querySelectorAll('.is-highlighted')].map((el) => el.textContent))
ok('an actor\'s copy marks their speeches, over the page and with an extension, and no one else\'s',
  same(marked, ['JOHN', '(beat)', 'Hello.', 'And more.', 'John (cont\'d)', 'Wait.']), JSON.stringify(marked))

/* Picking a Typeset handle opens and shows the section it belongs to. */
{
  const { default: FinishingSection } = await import('../../src/components/RightSidebar/finishing/FinishingSection.jsx')
  const { writeSectionState } = await import('../../src/ui/sectionState.js')
  const { documentSurface } = await import('../../src/bridge/index.ts')
  writeSectionState('page.size', false)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const sectionRoot = createRoot(host)
  await act(async () => {
    sectionRoot.render(React.createElement(FinishingSection, { id: 'page.size', title: 'Page Size' },
      React.createElement('p', { className: 'size-body' }, 'Letter')))
  })
  ok('a collapsed section starts shut', !host.querySelector('.size-body'))
  await act(async () => { documentSurface.publishTypesetFocus({ sectionId: 'page.margins' }) })
  ok('another section\'s handle leaves it shut', !host.querySelector('.size-body'))
  await act(async () => { documentSurface.publishTypesetFocus({ sectionId: 'page.size' }) })
  ok('its own handle opens it', Boolean(host.querySelector('.size-body')))
  await act(async () => { sectionRoot.unmount() })
  host.remove()
}
