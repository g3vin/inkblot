/**
 * Citations in a real editor: inserting one, the renderer formatting every citation
 * and the bibliography together, a style change re-formatting them, the nodes
 * surviving JSON, HTML and generateHTML — and the bibliography added on paper for a
 * document that keeps none in its text (`printBibliography.js`), including a book whose
 * chapters are numbered through.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'
import { files } from './stub-fs.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent', 'Event', 'KeyboardEvent',
  'MutationObserver', 'getComputedStyle', 'DOMParser'])
dom.window.scrollBy = () => {}
const noRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 })
for (const proto of [dom.window.Element.prototype, dom.window.Range.prototype, dom.window.Text.prototype]) {
  proto.getClientRects ??= () => []
  proto.getBoundingClientRect ??= noRect
}

const { Editor, generateHTML } = await import('@tiptap/core')
const { closeHistory } = await import('@tiptap/pm/history')
const { StarterKit } = await import('@tiptap/starter-kit')
const { Citation, setCitationContext, collectCitations } = await import('../../src/extensions/Citation.js')
const { Bibliography } = await import('../../src/extensions/Bibliography.js')
const { getDocPreviewExtensions } = await import('../../src/lib/editorExtensions.js')
const { parseName } = await import('../../src/lib/references/csl.js')
const { withPrintBibliography } = await import('../../src/lib/references/printBibliography.js')
const store = await import('../../src/lib/references/referenceStore.js')
const { saveDocument } = await import('../../src/lib/FileSystem.js')
const { toMarkdown } = await import('../../src/print/export/markdown.ts')

const ok = (l, c, detail) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) { process.exitCode = 1; if (detail !== undefined) console.log('      got:', detail) } }
const settle = async (until, tries = 200) => {
  for (let i = 0; i < tries; i += 1) {
    if (until()) return true
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return false
}

const austen = { id: 'b', kind: 'book', contributors: [parseName('Austen, Jane')], fields: { title: 'Pride and prejudice', publisher: 'Penguin Classics', issued: '2003' }, annotation: 'A novel of manners.' }
const lecun = { id: 'a', kind: 'journalArticle', contributors: ['LeCun, Yann', 'Bengio, Yoshua', 'Hinton, Geoffrey'].map((n) => parseName(n)), fields: { title: 'Deep learning', 'container-title': 'Nature', volume: '521', page: '436-444', issued: '2015' } }
const references = new Map([['a', lecun], ['b', austen]])

const editor = new Editor({
  element: document.getElementById('root').appendChild(document.createElement('div')),
  extensions: [StarterKit, Citation, Bibliography],
  content: '<p>As argued</p>',
})
setCitationContext(editor, { docPath: 'one', references, style: 'apa', bibliography: { include: 'cited', annotated: false }, attachedIds: [] })

/* ---------------- citing ---------------- */

editor.commands.focus('end')
editor.commands.insertCitation({ refIds: ['b'], locator: '12' })
ok('a citation is inserted, with a space before it', editor.state.doc.textContent.startsWith('As argued '))
await settle(() => collectCitations(editor.state.doc).citations[0]?.node.attrs.rendered)
let cites = collectCitations(editor.state.doc).citations
ok('the renderer formats it', cites[0].node.attrs.rendered === '(Austen, 2003, p. 12)', cites[0].node.attrs.rendered)
ok('the node view shows it', document.querySelector('.citation-chip')?.textContent === '(Austen, 2003, p. 12)')
ok('the text reads as the citation (word count, read aloud)', editor.getText().includes('(Austen, 2003, p. 12)'))

editor.commands.insertContent(' and more ')
editor.commands.insertCitation({ refIds: ['a'] })
editor.commands.insertBibliography()
await settle(() => collectCitations(editor.state.doc).bibliography?.node.attrs.entries.length === 2)
let bib = collectCitations(editor.state.doc).bibliography
ok('the bibliography lists what is cited, in the style\'s order', bib?.node.attrs.entries.map((e) => e.html.slice(0, 6)).join('|') === 'Austen|LeCun,', bib?.node.attrs.entries)
ok('under the style\'s heading', bib.node.attrs.title === 'References')
ok('and draws it', document.querySelector('.bibliography-title')?.textContent === 'References' && document.querySelectorAll('.bibliography-entry').length === 2)
const blocks = () => editor.state.doc.content.content.map((n) => n.type.name).join()
ok('the bibliography went to the end, before the trailing paragraph', blocks() === 'paragraph,bibliography,paragraph', blocks())

editor.view.dispatch(closeHistory(editor.state.tr))
editor.commands.setTextSelection(1)
editor.commands.insertContent({ type: 'paragraph', content: [{ type: 'text', text: 'Later text' }] })
editor.commands.insertBibliography()
ok('inserting it again moves it to the end, never doubled', blocks().endsWith('bibliography,paragraph') && blocks().split('bibliography').length === 2, blocks())

/* ---------------- undo is the writer's ---------------- */

await settle(() => false, 10)
editor.view.dispatch(closeHistory(editor.state.tr))
const beforeTyping = editor.state.doc.toJSON()
editor.commands.setTextSelection(3)
editor.commands.insertContent('x')
await settle(() => false, 10)
editor.commands.undo()
ok('formatting is not an undo step: one undo takes back one keystroke', JSON.stringify(editor.state.doc.toJSON()) === JSON.stringify(beforeTyping))

/* ---------------- styles ---------------- */

setCitationContext(editor, { docPath: 'one', references, style: 'mla', bibliography: { include: 'cited', annotated: true }, attachedIds: [] })
await settle(() => collectCitations(editor.state.doc).bibliography?.node.attrs.title === 'Works Cited')
cites = collectCitations(editor.state.doc).citations
ok('a style change re-formats every citation', cites[0].node.attrs.rendered === '(Austen 12)', cites[0].node.attrs.rendered)
bib = collectCitations(editor.state.doc).bibliography
ok('and the bibliography, under its heading', bib.node.attrs.title === 'Works Cited')
ok('annotated: the annotation is under its entry', bib.node.attrs.entries[0].annotation === 'A novel of manners.' && document.querySelector('.bibliography-annotation')?.textContent === 'A novel of manners.')

setCitationContext(editor, { docPath: 'one', references, style: 'chicago-notes', bibliography: { include: 'cited', annotated: false }, attachedIds: [] })
await settle(() => collectCitations(editor.state.doc).bibliography?.node.attrs.notes.length === 2)
cites = collectCitations(editor.state.doc).citations
ok('a note style: citations become note numbers', cites.map((c) => c.node.attrs.rendered).join() === '<sup>1</sup>,<sup>2</sup>')
ok('and the notes are listed', collectCitations(editor.state.doc).bibliography.node.attrs.notes[0].startsWith('Jane Austen, <i>Pride and Prejudice</i>'))

setCitationContext(editor, { docPath: 'one', references, style: 'apa', bibliography: { include: 'attached', annotated: false }, attachedIds: ['a', 'b'] })
await settle(() => collectCitations(editor.state.doc).citations[0].node.attrs.rendered.startsWith('(Austen'))

/* ---------------- round trips ---------------- */

const json = editor.getJSON()
const citationJson = json.content.flatMap((block) => block.content || []).find((n) => n.type === 'citation')
ok('JSON keeps the sources and the formatted text', citationJson.attrs.items[0].refId === 'b' && citationJson.attrs.items[0].locator === '12' && citationJson.attrs.rendered.startsWith('(Austen'))

const html = generateHTML(json, getDocPreviewExtensions())
ok('a preview renders the citation formatted', html.includes('data-citation') && html.includes('(Austen, 2003, p. 12)'))
ok('and the bibliography, entries and all', html.includes('bibliography-title') && html.includes('Penguin Classics'))

const pasted = new Editor({
  element: document.getElementById('root').appendChild(document.createElement('div')),
  extensions: [StarterKit, Citation, Bibliography],
  content: editor.getHTML(),
})
const pastedCite = collectCitations(pasted.state.doc).citations[0]
ok('HTML keeps a citation\'s sources', pastedCite?.items[0].refId === 'b' && pastedCite.items[0].locator === '12')
ok('but never trusts pasted markup as its text', pastedCite.node.attrs.rendered === '')
pasted.destroy()

const hostile = generateHTML({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'citation', attrs: { items: [{ refId: 'x' }], rendered: '<img src=x onerror=alert(1)>(Hi)' } }] }] }, getDocPreviewExtensions())
ok('a hand-edited file cannot inject markup through a citation', !hostile.includes('<img') && hostile.includes('(Hi)'))

const md = toMarkdown(json)
ok('Markdown: the citation as text', md.includes('As argued (Austen, 2003, p. 12)'), md)
ok('Markdown: the bibliography as a section', md.includes('## References') && md.includes('*Pride and prejudice*'))

editor.destroy()

/* ---------------- on paper only ---------------- */

const P = 'Thesis'
const cite = (refId) => ({ type: 'paragraph', content: [{ type: 'text', text: 'Claim ' }, { type: 'citation', attrs: { items: [{ refId }], rendered: '' } }] })
await store.addReference(P, austen, 'one')
await store.addReference(P, lecun, 'two')
for (const name of ['one', 'two']) await saveDocument(P, name, { content: { type: 'doc', content: [] }, notes: [] })

let chapters = [{ path: 'one', name: 'one', content: { type: 'doc', content: [cite('b')] } }]
let out = await withPrintBibliography(P, chapters)
const last = out[0].content.content.at(-1)
ok('a document without a bibliography gets one on paper', last.type === 'bibliography' && last.attrs.entries[0].html.startsWith('Austen'))
ok('and is laid out afresh for it', out[0].printBibliography === true)

await store.updateDocCitations(P, 'one', (current) => ({ ...current, bibliography: { ...current.bibliography, inPrint: false } }))
out = await withPrintBibliography(P, chapters)
ok('unless it asked not to', out === chapters)
await store.updateDocCitations(P, 'one', (current) => ({ ...current, bibliography: { ...current.bibliography, inPrint: true } }))

chapters = [{ path: 'one', name: 'one', content: { type: 'doc', content: [cite('b'), { type: 'bibliography', attrs: { title: 'References', entries: [], notes: [] } }] } }]
out = await withPrintBibliography(P, chapters)
ok('a document with a live bibliography prints that one only', out === chapters)

await store.updateDocCitations(P, 'one', (current) => ({ ...current, style: 'ieee' }))
chapters = [
  { path: 'one', name: 'one', content: { type: 'doc', content: [cite('b')] } },
  { path: 'two', name: 'two', content: { type: 'doc', content: [cite('a'), cite('b')] } },
]
out = await withPrintBibliography(P, chapters)
const renderedOf = (content) => collectCitationsJsonRendered(content)
function collectCitationsJsonRendered(node, acc = []) {
  if (node.type === 'citation') acc.push(node.attrs.rendered)
  for (const child of node.content || []) collectCitationsJsonRendered(child, acc)
  return acc
}
ok('a book: numbering runs through the chapters', renderedOf(out[0].content).join() === '[1]' && renderedOf(out[1].content).join() === '[2],[1]', [renderedOf(out[0].content), renderedOf(out[1].content)])
ok('a book: one bibliography, at its end', !out[0].content.content.some((n) => n.type === 'bibliography') && out[1].content.content.at(-1).type === 'bibliography')
ok('a book: in the first chapter\'s style', out[1].content.content.at(-1).attrs.entries[0].html.startsWith('[1] J. Austen'), out[1].content.content.at(-1).attrs.entries[0]?.html)
ok('the library file is untouched by printing', files.has('/appdata/Thesis/.inkblot-references.json'))
