/**
 * Print Layout's pure logic: page sizes, the page setup and its geometry, where
 * pages break, and how pages are imposed onto sheets for binding.
 *
 * jsdom does no layout, so pagination is tested here as the function it is —
 * measured geometry in, pushes out. The measured half runs against real WebKit in
 * tests/layout.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
installGlobals(dom.window, ['document', 'navigator', 'DOMParser', 'Node', 'Element', 'HTMLElement'])
Object.defineProperty(globalThis, 'window', { value: dom.window, writable: true, configurable: true })

const C = '../../src'
const sizes = await import(`${C}/print/pageSizes.ts`)
const setupMod = await import(`${C}/print/pageSetup.ts`)
const { paginate } = await import(`${C}/print/paginate.ts`)
const imp = await import(`${C}/print/imposition.ts`)
const { Editor, generateHTML } = await import('@tiptap/core')
const { buildEditorExtensions, getDocPreviewExtensions } = await import(`${C}/lib/editorExtensions.js`)
const { StarterKit } = await import('@tiptap/starter-kit')
const docPageSetup = await import(`${C}/print/DocPageSetup.js`)

const ok = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) process.exitCode = 1 }
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/* ---- page sizes: each against its standard ---- */

const px = (id) => {
  const p = sizes.getPageSizePreset(id)
  return [sizes.mmToPx(p.widthMm), sizes.mmToPx(p.heightMm)]
}
ok('US Letter is 8.5 × 11 in = 816 × 1056 CSS px', same(px('letter').map(Math.round), [816, 1056]) && near(px('letter')[0], 816))
ok('US Legal is 8.5 × 14 in', near(px('legal')[1], 14 * 96))
ok('A4 is 210 × 297 mm', sizes.getPageSizePreset('a4').widthMm === 210 && sizes.getPageSizePreset('a4').heightMm === 297)
ok('A0 is 841 × 1189 mm and A10 is 26 × 37 mm',
  sizes.getPageSizePreset('a0').heightMm === 1189 && sizes.getPageSizePreset('a10').widthMm === 26)
ok('B5 is 176 × 250 mm (ISO), JIS B5 is 182 × 257 mm',
  sizes.getPageSizePreset('b5').widthMm === 176 && sizes.getPageSizePreset('jis-b5').heightMm === 257)
ok('each ISO A size halves the one above it (to the standard\'s whole-mm rounding)',
  [1, 2, 3, 4, 5, 6].every((i) => {
    const up = sizes.getPageSizePreset(`a${i - 1}`)
    const p = sizes.getPageSizePreset(`a${i}`)
    return p.heightMm === up.widthMm && Math.abs(p.widthMm - up.heightMm / 2) <= 1
  }))
ok('6 × 9 trade is 576 × 864 px', near(px('trade-6x9')[0], 576) && near(px('trade-6x9')[1], 864))
ok('a typed 210 × 297 (or 297 × 210) is recognised as A4',
  sizes.matchPageSizePreset(210, 297)?.id === 'a4' && sizes.matchPageSizePreset(297, 210)?.id === 'a4')
ok('1 in round-trips through every unit', ['mm', 'cm', 'in', 'pt'].every((u) => near(sizes.toMm(sizes.fromMm(25.4, u), u), 25.4)))
ok('72 pt is one inch', near(sizes.fromMm(25.4, 'pt'), 72))
ok('preset ids are unique', new Set(sizes.PAGE_SIZE_PRESETS.map((p) => p.id)).size === sizes.PAGE_SIZE_PRESETS.length)

/* ---- page setup ---- */

const { normalizePageSetup, pageMetrics, contentBox, DEFAULT_PAGE_SETUP, bookPageSetup } = setupMod
const def = normalizePageSetup(null)
ok('the default setup is US Letter with 1 in margins', def.presetId === 'letter' && def.margins.topMm === 25.4)
const m = pageMetrics(def)
ok('Letter with 1 in margins has a 6.5 × 9 in text block', near(m.contentWidth, 6.5 * 96) && near(m.contentHeight, 9 * 96))
const land = pageMetrics({ ...def, orientation: 'landscape' })
ok('landscape swaps width and height', near(land.width, 1056) && near(land.height, 816))
const twoCol = pageMetrics({ ...def, columns: 2, columnGapMm: 12.7 })
ok('two columns split the text block around the gap', near(twoCol.columnWidth, (6.5 * 96 - 48) / 2))
ok('garbage normalizes to a page that lays out',
  pageMetrics(normalizePageSetup({ widthMm: 'x', heightMm: -4, columns: 9, margins: { topMm: 'y' } })).contentHeight > 0)
const tiny = normalizePageSetup({ ...DEFAULT_PAGE_SETUP, presetId: 'a7', widthMm: 74, heightMm: 105, margins: { topMm: 60, bottomMm: 60, insideMm: 50, outsideMm: 50, gutterMm: 0 } })
ok('margins too big for the page scale back instead of going negative',
  pageMetrics(tiny).contentWidth >= sizes.mmToPx(10) - 1e-6 && pageMetrics(tiny).contentHeight >= sizes.mmToPx(10) - 1e-6)
ok('an unknown preset id is custom', normalizePageSetup({ ...def, presetId: 'nonsense' }).presetId === 'custom')
ok('columns are clamped to 1–3', normalizePageSetup({ columns: 7 }).columns === 3 && normalizePageSetup({ columns: 0 }).columns === 1)

const book = bookPageSetup('trade-6x9')
const recto = contentBox(book, 1)
const verso = contentBox(book, 2)
ok('mirrored margins: the inside + gutter is on the left of a recto, the right of a verso',
  near(recto.x, sizes.mmToPx(15.875 + 3.175)) && near(verso.x, sizes.mmToPx(15.875)))
ok('the text block is the same size on both sides of a spread', recto.width === verso.width && recto.height === verso.height)

const ctx = { page: 7, pages: 120, title: 'The Book', chapter: 'Chapter One', author: 'A. Writer' }
ok('a recto running head shows the chapter, a verso the title',
  setupMod.runningTextFor(book, 'header', 7, ctx).center === 'Chapter One' &&
  setupMod.runningTextFor(book, 'header', 8, ctx).center === 'The Book')
ok('no running head on a chapter\'s first page when differentFirstPage is set',
  setupMod.runningTextFor(book, 'header', 1, ctx, { chapterFirstPage: true }) === null)
const outsideFolio = { ...def, mirrorMargins: true, footer: { left: '', center: '', right: '{page}' } }
ok('a folio set outside on the recto is outside (left) on the verso',
  setupMod.runningTextFor(outsideFolio, 'footer', 3, ctx).right === '7' &&
  setupMod.runningTextFor(outsideFolio, 'footer', 4, ctx).left === '7')
ok('roman page numbers', setupMod.formatPageNumber(14, 'lowerRoman') === 'xiv' && setupMod.toRoman(1994) === 'MCMXCIV')
ok('tokens resolve; unknown text is left alone',
  setupMod.resolveRunningTemplate('{title} — p. {page} of {pages} {x}', ctx, 'arabic') === 'The Book — p. 7 of 120 {x}')
ok('suggested inside margin grows with page count',
  setupMod.suggestedInsideMarginMm(100) < setupMod.suggestedInsideMarginMm(400) &&
  near(setupMod.suggestedInsideMarginMm(250), 12.7))

/* ---- pagination ---- */

// A frame of 100px text blocks, 150px apart (so 50px of margin + gap between).
const frame = { slotHeight: 100, stride: 150, columns: 1, minLines: 2 }
const para = (pos, top, lineCount, lh = 10) => ({
  kind: 'text',
  pos,
  top,
  bottom: top + lineCount * lh,
  lines: Array.from({ length: lineCount }, (_, i) => ({ top: top + i * lh, bottom: top + (i + 1) * lh, pos: pos + 1 + i * 10 })),
})
const atom = (pos, top, height) => ({ kind: 'atom', pos, top, bottom: top + height })

let r = paginate([para(0, 0, 5), para(60, 60, 3)], frame)
ok('content that fits is one page with no pushes', r.pageCount === 1 && r.pushes.length === 0)

r = paginate([para(0, 0, 8), para(100, 90, 6)], frame)
// The second paragraph has lines at 90..150; only line 0 (90–100) fits. One line at
// the foot is an orphan, so the whole paragraph goes over.
ok('an orphan line is not left at the foot: the paragraph moves over whole',
  r.pushes.length === 1 && r.pushes[0].kind === 'block' && r.pushes[0].pos === 100 && near(r.pushes[0].height, 60) && r.pageCount === 2)

r = paginate([para(0, 0, 14)], frame)
ok('a long paragraph splits mid-paragraph at the first line past the foot',
  r.pushes.length === 1 && r.pushes[0].kind === 'line' && r.pushes[0].pos === 0 + 1 + 10 * 10 && near(r.pushes[0].height, 50))
ok('…and the page it continues on starts at that line', r.slotStarts[1] === 101)

r = paginate([para(0, 0, 11)], frame)
// 10 lines fit; 1 would carry over — a widow. Two go over instead.
ok('a widow is not carried alone to the head: two lines go over',
  r.pushes[0].kind === 'line' && r.pushes[0].pos === 1 + 9 * 10 && near(r.pushes[0].height, 150 - 90))

r = paginate([para(0, 0, 11)], { ...frame, minLines: 1 })
ok('with widow/orphan control off, exactly the overflow goes over', r.pushes[0].pos === 1 + 10 * 10)

r = paginate([para(0, 0, 32)], frame)
ok('a paragraph three pages long splits twice', r.pushes.length === 3 && r.pageCount === 4 &&
  r.pushes.every((p) => p.kind === 'line'))

r = paginate([para(0, 0, 3), atom(40, 40, 80)], frame)
ok('an atom that does not fit moves to the next page', r.pushes[0].kind === 'block' && r.pushes[0].pos === 40 && near(r.pushes[0].height, 110))

r = paginate([atom(0, 0, 260), para(300, 270, 2)], frame)
ok('an atom taller than a page is not pushed off its page (it would loop forever)',
  r.pushes.every((p) => p.pos !== 0))
ok('…and what follows it starts on the next free page below it', r.pushes[0].pos === 300 && near(270 + r.pushes[0].height, 300))

const heading = (pos, top) => ({ kind: 'text', pos, top, bottom: top + 20, keepWithNext: true, lines: [{ top, bottom: top + 20, pos: pos + 1 }] })
r = paginate([para(0, 0, 7), heading(80, 75), para(100, 97, 5)], frame)
ok('a heading is not left at the foot of a page without its paragraph',
  r.pushes[0].kind === 'block' && r.pushes[0].pos === 80)

r = paginate([para(0, 0, 2), { kind: 'break', pos: 20, top: 20, bottom: 20, breakKind: 'page' }, para(21, 22, 2)], frame)
ok('a manual page break starts what follows on a new page', r.pushes[0].pos === 21 && near(22 + r.pushes[0].height, 150) && r.pageCount === 2)

r = paginate([para(0, 0, 2), { kind: 'break', pos: 20, top: 20, bottom: 20, breakKind: 'recto' }, para(21, 22, 2)], frame)
ok('a recto break skips the verso: what follows starts on page 3', near(22 + r.pushes[0].height, 300) && r.pageCount === 3 && r.slotStarts[1] === null)

r = paginate([para(0, 0, 2), { kind: 'break', pos: 20, top: 20, bottom: 20, breakKind: 'recto' }, para(21, 22, 2)], frame)
ok('chapter-start slots are recorded', same(r.chapterStartSlots, [0, 2]))

r = paginate([para(0, 0, 5), { kind: 'break', pos: 50, top: 50, bottom: 50, breakKind: 'column' }, para(51, 52, 2)], { ...frame, columns: 2 })
ok('a column break moves to the next column, which is on the same page', near(52 + r.pushes[0].height, 150) && r.pageCount === 1)

r = paginate([para(0, 0, 12)], { ...frame, columns: 2 })
ok('with two columns, overflow goes to column 2 of the same page', r.pageCount === 1 && r.slotCount === 2)

r = paginate([para(0, 0, 5), { kind: 'break', pos: 50, top: 50, bottom: 50, breakKind: 'page' }], frame)
ok('a trailing page break still opens its page', r.pageCount === 2)

// A single pass must be stable: feeding the natural geometry again gives the same answer.
const units = [para(0, 0, 9), atom(90, 95, 30), para(130, 130, 25), heading(400, 380), para(420, 402, 4)]
ok('pagination is deterministic', same(paginate(units, frame), paginate(units, frame)))
ok('no push is ever negative or zero', paginate(units, frame).pushes.every((p) => p.height > 0))

/* ---- imposition ---- */

const readOrder = (sheets) => {
  // Fold each signature and read it: the right half of each front, then the back's
  // left, working inwards, then back out through the other halves.
  const pages = []
  const bySig = new Map()
  for (const s of sheets) {
    if (!bySig.has(s.signature)) bySig.set(s.signature, [])
    bySig.get(s.signature).push(s)
  }
  for (const group of bySig.values()) {
    for (const s of group) pages.push(s.front.right, s.back.left)
    for (const s of [...group].reverse()) pages.push(s.back.right, s.front.left)
  }
  return pages
}

let im = imp.imposePages(4, { binding: 'saddle' })
ok('a 4-page folio is front 4|1, back 2|3', same(im.sheets[0].front, { left: 4, right: 1 }) && same(im.sheets[0].back, { left: 2, right: 3 }))

for (const sheets of [1, 2, 4, 8]) {
  const n = 4 * sheets
  im = imp.imposePages(n, { binding: 'signatures', sheetsPerSignature: sheets })
  ok(`a ${n}-page signature folds to read 1…${n}`, same(readOrder(im.sheets), Array.from({ length: n }, (_, i) => i + 1)))
}

im = imp.imposePages(16, { binding: 'signatures', sheetsPerSignature: 4 })
ok('16 pages in 4-sheet signatures: sheet 1 is 16|1 / 2|15, the centre sheet 10|7 / 8|9',
  same(im.sheets[0].front, { left: 16, right: 1 }) && same(im.sheets[0].back, { left: 2, right: 15 }) &&
  same(im.sheets[3].front, { left: 10, right: 7 }) && same(im.sheets[3].back, { left: 8, right: 9 }))

im = imp.imposePages(37, { binding: 'signatures', sheetsPerSignature: 4 })
ok('37 pages pad to three 16-page signatures with 11 blanks', im.paddedPageCount === 48 && im.blanksAdded === 11 && im.sheets.length === 12)
ok('…the blanks are at the end', readOrder(im.sheets).slice(37).every((p) => p === 0) && same(readOrder(im.sheets).slice(0, 37), Array.from({ length: 37 }, (_, i) => i + 1)))
ok('…and the second signature starts at page 17', im.sheets[4].front.right === 17)

im = imp.imposePages(30, { binding: 'saddle' })
ok('saddle stitch puts every page in one signature', new Set(im.sheets.map((s) => s.signature)).size === 1 && im.paddedPageCount === 32)

im = imp.imposePages(16, { binding: 'signatures', sheetsPerSignature: 4, paperThicknessMm: 0.1 })
ok('creep grows inward: 0 on the outer sheet, 0.3 mm on the fourth', im.sheets[0].creepMm === 0 && near(im.sheets[3].creepMm, 0.3))

im = imp.imposePages(8, { binding: 'perfect' })
ok('perfect binding keeps reading order: each leaf backs onto the next page',
  same(im.sheets[0].front, { left: 1, right: 3 }) && same(im.sheets[0].back, { left: 4, right: 2 }))

im = imp.imposePages(8, { binding: 'signatures', sheetsPerSignature: 2 })
ok('manual duplex prints every front, then the backs in reverse',
  same(imp.printSequence(im, 'manual'), [{ sheet: 0, side: 'front' }, { sheet: 1, side: 'front' }, { sheet: 1, side: 'back' }, { sheet: 0, side: 'back' }]))
ok('the folding guide names every sheet', imp.foldingGuide(im).length === 3 && imp.foldingGuide(im)[1].includes('8 | 1'))

/* ---- the page setup lives on the doc node ---- */

const editor = new Editor({
  extensions: buildEditorExtensions(StarterKit),
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }] },
})
ok('a new document has no page setup of its own', docPageSetup.readDocPageSetup(editor.state.doc) === null)
editor.commands.setPageSetup(book)
ok('setPageSetup stores it on the doc node', docPageSetup.readDocPageSetup(editor.state.doc)?.presetId === 'trade-6x9')
const json = editor.getJSON()
ok('…and it is in getJSON(), which is what autosave writes', json.attrs?.pageSetup?.mirrorMargins === true)
const reloaded = new Editor({ extensions: buildEditorExtensions(StarterKit), content: json })
ok('…and it survives a reload', docPageSetup.readDocPageSetup(reloaded.state.doc)?.widthMm === book.widthMm)
editor.commands.undo()
ok('changing the page setup is undoable', docPageSetup.readDocPageSetup(editor.state.doc) === null)
editor.commands.setPageSetup(book)
docPageSetup.setContentKeepingPageSetup(editor, '<p>restored from html</p>')
ok('restoring an HTML-only version keeps the page setup', docPageSetup.readDocPageSetup(editor.state.doc)?.presetId === 'trade-6x9' && editor.getText() === 'restored from html')
docPageSetup.setContentKeepingPageSetup(editor, { type: 'doc', attrs: { pageSetup: { ...def, presetId: 'a5', widthMm: 148, heightMm: 210 } }, content: [{ type: 'paragraph' }] })
ok('restoring a JSON version keeps the typesetting as it is now — its setup is the typeset history\'s, not the text\'s',
  docPageSetup.readDocPageSetup(editor.state.doc)?.presetId === 'trade-6x9')
ok('generateHTML still renders a document that has a page setup', generateHTML(json, getDocPreviewExtensions()).includes('Hi'))
editor.destroy()
reloaded.destroy()

/* ---- exports ---- */

installGlobals(dom.window, ['XMLSerializer'])
const { toMarkdown } = await import(`${C}/print/export/markdown.ts`)
const { portableContent } = await import(`${C}/print/export/portable.ts`)
const { createZip, listZip } = await import(`${C}/print/export/zip.ts`)
const { buildEpub, toXhtmlBody } = await import(`${C}/print/export/epub.ts`)
const { buildHtmlDocument } = await import(`${C}/print/export/html.ts`)

const t = (text, marks) => ({ type: 'text', text, ...(marks ? { marks } : {}) })
const p = (...content) => ({ type: 'paragraph', content })
const sample = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [t('Chapter One')] },
    p(t('Plain, '), t('bold', [{ type: 'bold' }]), t(' and '), t(' italic ', [{ type: 'italic' }]), t('.')),
    p(t('A *literal* star and [brackets].')),
    p(t('Underlined', [{ type: 'underline' }]), t(' '), t('marked', [{ type: 'highlight' }]), t(' '), t('a link', [{ type: 'link', attrs: { href: 'https://example.com/a b' } }])),
    { type: 'bulletList', content: [
      { type: 'listItem', content: [p(t('one')), { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('nested'))] }] }] },
      { type: 'listItem', content: [p(t('two'))] },
    ] },
    { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [p(t('three'))] }, { type: 'listItem', content: [p(t('four'))] }] },
    { type: 'blockquote', content: [p(t('quoted'))] },
    { type: 'codeBlock', attrs: { language: 'js' }, content: [t('let x = 1')] },
    { type: 'pageBreak', attrs: { kind: 'page' } },
    { type: 'table', content: [
      { type: 'tableRow', content: [{ type: 'tableHeader', content: [p(t('A'))] }, { type: 'tableHeader', content: [p(t('B|C'))] }] },
      { type: 'tableRow', content: [{ type: 'tableCell', content: [p(t('1'))] }, { type: 'tableCell', content: [p(t('2'))] }] },
    ] },
    p(t('# not a heading')),
    { type: 'conversationTile', attrs: { participants: { you: 'Ana', them: 'Ben' }, messages: [{ sender: 'you', name: 'Ana', text: 'Hi' }, { sender: 'them', name: 'Ben', text: 'Hello' }] } },
    { type: 'pinterestBoard', attrs: { url: 'https://pinterest.com/me/board' } },
    p(t('pic '), { type: 'image', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=', alt: 'a pic' } }),
  ],
}
const md = toMarkdown(portableContent(sample), { imageSrc: () => 'book_assets/image-1.png' })
if (process.env.DUMP) console.log(md)
ok('markdown: headings, bold and italic (whitespace kept outside the markers)', md.includes('# Chapter One') && md.includes('Plain, **bold** and  *italic* .'))
ok('markdown: literal markup is escaped', md.includes('A \\*literal\\* star and \\[brackets\\].'))
ok('markdown: underline, highlight, links', md.includes('<u>Underlined</u>') && md.includes('==marked==') && md.includes('[a link](https://example.com/a%20b)'))
ok('markdown: nested bullets indent under their item', md.includes('- one\n  - nested\n- two'))
ok('markdown: an ordered list keeps its start', md.includes('3. three\n4. four'))
ok('markdown: blockquote and fenced code', md.includes('> quoted') && md.includes('```js\nlet x = 1\n```'))
ok('markdown: page break and GFM table with an escaped pipe', md.includes('<div style="break-after: page"></div>') && md.includes('| A | B\\|C |\n| --- | --- |\n| 1 | 2 |'))
ok('markdown: a line that would read as a heading is escaped', md.includes('\\# not a heading'))
ok('markdown: a conversation becomes a transcript, a board a link', md.includes('> **Ana:** Hi') && md.includes('> **Ben:** Hello') && md.includes('[https://pinterest.com/me/board](https://pinterest.com/me/board)'))
ok('markdown: images point at the exported files', md.includes('![a pic](book_assets/image-1.png)'))

const zip = await createZip([
  { name: 'mimetype', data: 'application/epub+zip', store: true },
  { name: 'a.txt', data: 'hello '.repeat(200) },
])
const listing = listZip(zip)
ok('zip: entries are written in order', listing.map((e) => e.name).join() === 'mimetype,a.txt')
ok('zip: mimetype is stored, at offset 0, with no extra field', listing[0].method === 0 && listing[0].offset === 0 && listing[0].extraLength === 0)
ok('zip: the file begins with the EPUB signature readers sniff for',
  new TextDecoder().decode(zip.subarray(30, 58)) === 'mimetypeapplication/epub+zip')
ok('zip: compressible entries are deflated', listing[1].method === 8)
const { inflateRawSync } = await import('node:zlib')
{
  const view = new DataView(zip.buffer, zip.byteOffset)
  const at = listing[1].offset
  const size = view.getUint32(at + 18, true)
  const start = at + 30 + view.getUint16(at + 26, true)
  ok('zip: a deflated entry inflates back to its bytes', inflateRawSync(zip.subarray(start, start + size)).toString() === 'hello '.repeat(200))
}

ok('xhtml: void elements are closed and entities are XML-safe',
  toXhtmlBody('<p>a<br>b &amp; c<img src="x.png"></p>') === '<p>a<br />b &amp; c<img src="x.png" /></p>')

const epub = await buildEpub({
  title: 'The Book',
  author: 'A. Writer',
  language: 'en-GB',
  chapters: [{ title: 'One', content: sample }, { title: 'Two & Three', content: { type: 'doc', content: [p(t('end'))] } }],
  resolveImage: async (src) => (src.startsWith('data:') ? { bytes: new Uint8Array([137, 80, 78, 71]), mime: 'image/png', ext: 'png' } : null),
  identifier: 'urn:uuid:00000000-0000-4000-8000-000000000000',
  modified: new Date('2026-09-23T12:00:00Z'),
})
const names = listZip(epub).map((e) => e.name)
ok('epub: container, package, nav, NCX, stylesheet, chapters and image', [
  'mimetype', 'META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/nav.xhtml', 'OEBPS/toc.ncx', 'OEBPS/styles.css',
  'OEBPS/text/chapter-001.xhtml', 'OEBPS/text/chapter-002.xhtml', 'OEBPS/images/image-1.png',
].every((n) => names.includes(n)) && names[0] === 'mimetype')
const readEntry = (bytes, name) => {
  const e = listZip(bytes).find((x) => x.name === name)
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  const size = view.getUint32(e.offset + 18, true)
  const start = e.offset + 30 + view.getUint16(e.offset + 26, true) + e.extraLength
  const raw = bytes.subarray(start, start + size)
  return (e.method === 8 ? inflateRawSync(raw) : Buffer.from(raw)).toString('utf8')
}
const parser = new dom.window.DOMParser()
const wellFormed = (xml) => !parser.parseFromString(xml, 'application/xml').querySelector('parsererror')
const opf = readEntry(epub, 'OEBPS/content.opf')
ok('epub: every XML file parses as XML', ['META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/nav.xhtml', 'OEBPS/toc.ncx', 'OEBPS/text/chapter-001.xhtml', 'OEBPS/text/chapter-002.xhtml']
  .every((n) => wellFormed(readEntry(epub, n))))
ok('epub: required metadata', opf.includes('<dc:title>The Book</dc:title>') && opf.includes('<dc:language>en-GB</dc:language>') &&
  opf.includes('urn:uuid:00000000-0000-4000-8000-000000000000') && opf.includes('<meta property="dcterms:modified">2026-09-23T12:00:00Z</meta>') &&
  opf.includes('<dc:creator id="author">A. Writer</dc:creator>'))
const manifestHrefs = [...opf.matchAll(/href="([^"]+)"/g)].map((m) => `OEBPS/${m[1]}`)
ok('epub: every manifest item is in the archive, and every archive file is in the manifest',
  manifestHrefs.every((h) => names.includes(h)) &&
  names.filter((n) => n.startsWith('OEBPS/') && n !== 'OEBPS/content.opf').every((n) => manifestHrefs.includes(n)))
const ch1 = readEntry(epub, 'OEBPS/text/chapter-001.xhtml')
ok('epub: chapter images point into the package', ch1.includes('src="../images/image-1.png"'))
ok('epub: nothing editable reaches the reader', !ch1.includes('contenteditable') && ch1.includes('class="page-break page-break-page"'))
ok('epub: titles are escaped in the nav', readEntry(epub, 'OEBPS/nav.xhtml').includes('Two &amp; Three'))

const html = buildHtmlDocument({ title: 'T', chapters: [{ title: 'One', content: sample }], setup: bookPageSetup('trade-6x9') })
if (process.env.DUMP) console.log(html.slice(0, 3000))
ok('html: the print size and mirrored margins are in @page',
  html.includes('@page { size: 152.4mm 228.6mm;') && html.includes('@page :left'))
ok('html: self-contained — no external stylesheet or script', !/<link |<script/.test(html))
