/**
 * generateHTML — how every card that is NOT being edited renders.
 *
 * prosemirror-model reaches for `window.document`, so it throws under bare Node (this
 * suite installs jsdom first), and every static card
 * (CanvasTextNode) plus every document preview (useDocPreview) goes through it. A
 * throw here blanks a card, and the only fallback is its plain text — so a silently
 * broken extension looks like "my formatting disappeared", not like an error.
 *
 * jsdom supplies the DOM; the schema, the extensions and the call are the REAL ones
 * the app uses.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'

// Must be installed before @tiptap/core is imported: prosemirror-model binds to the
// global document at module scope.
const dom = new JSDOM('<!doctype html><html><body></body></html>')
installGlobals(dom.window, ['document', 'navigator', 'DOMParser', 'Node', 'Element', 'HTMLElement'])
Object.defineProperty(globalThis, 'window', { value: dom.window, writable: true, configurable: true })

const C = '../../src'
const { generateHTML } = await import('@tiptap/core')
const { getCardExtensions, getCardSchema, getDocPreviewExtensions } =
  await import(`${C}/lib/editorExtensions.js`)
import { ok } from './assert.mjs'

const render = (content) => generateHTML(content, getCardExtensions())
const renderPreview = (content) => generateHTML(content, getDocPreviewExtensions())
const doc = (...content) => ({ type: 'doc', content })
const para = (text, marks) => ({
  type: 'paragraph',
  content: text ? [{ type: 'text', text, ...(marks ? { marks } : {}) }] : [],
})

/* ---- the extension set builds at all ---- */

ok('the card schema builds', !!getCardSchema().nodes.doc)
ok('getCardExtensions is stable (safe to memo against)', getCardExtensions() === getCardExtensions())

/* ---- a plain card ---- */

let html = render(doc(para('Hello canvas')))
ok('a paragraph renders', html.includes('Hello canvas') && html.includes('<p>'))

/* ---- every mark the titlebar Toolbar can apply must survive ---- */

const marks = {
  bold: 'strong',
  italic: 'em',
  underline: 'u',
  strike: 's',
  code: 'code',
}
for (const [mark, tag] of Object.entries(marks)) {
  const out = render(doc(para('x', [{ type: mark }])))
  ok(`mark renders: ${mark}`, out.includes(`<${tag}`))
}

const highlight = render(doc(para('x', [{ type: 'highlight', attrs: { color: '#ffff00' } }])))
ok('mark renders: highlight (multicolor)', highlight.includes('mark') && highlight.includes('#ffff00'))

const colored = render(doc(para('x', [{ type: 'textStyle', attrs: { color: '#ff0000' } }])))
ok('mark renders: text color', colored.includes('color'))

const font = render(doc(para('x', [{ type: 'textStyle', attrs: { fontFamily: 'Georgia' } }])))
ok('mark renders: font family', font.includes('Georgia'))

/* ---- block nodes ---- */

const heading = render(doc({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H' }] }))
ok('heading renders', heading.includes('<h2'))

const align = render(doc({ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'c' }] }))
ok('text align renders', align.includes('center'))

const bullet = render(doc({
  type: 'bulletList',
  content: [{ type: 'listItem', content: [para('item')] }],
}))
ok('bullet list renders', bullet.includes('<ul') && bullet.includes('<li'))

const ordered = render(doc({
  type: 'orderedList',
  attrs: { start: 1 },
  content: [{ type: 'listItem', content: [para('item')] }],
}))
ok('ordered list renders', ordered.includes('<ol'))

const table = render(doc({
  type: 'table',
  content: [{
    type: 'tableRow',
    content: [
      { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1 }, content: [para('h')] },
      { type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [para('c')] },
    ],
  }],
}))
ok('table renders', table.includes('<table') && table.includes('<th') && table.includes('<td'))

const quote = render(doc({ type: 'blockquote', content: [para('q')] }))
ok('blockquote renders', quote.includes('<blockquote'))

const codeBlock = render(doc({ type: 'codeBlock', content: [{ type: 'text', text: 'x = 1' }] }))
ok('code block renders', codeBlock.includes('<pre'))

const image = render(doc({ type: 'image', attrs: { src: 'data:image/png;base64,AAA' } }))
ok('image renders', image.includes('<img'))

/* ---- the fallbacks the components rely on ---- */

ok('an empty doc renders without throwing', typeof render(doc()) === 'string')

// A card written by another app, or a future version, must not blank the canvas —
// CanvasTextNode catches and falls back to plain text. Prove the throw is real, so
// that catch is not dead code hiding a silent failure.
let threw = false
try {
  render(doc({ type: 'someExtensionWeDoNotHave', content: [] }))
} catch {
  threw = true
}
ok('an unknown node type throws (so the text fallback is load-bearing)', threw)

/* ---- document previews need the DOCUMENT schema, not the card one ---- */

// This is why useDocPreview does not use getCardExtensions(). A real chapter can hold
// a Pinterest board or a conversation tile; the card schema drops both on purpose, so
// rendering a document with it throws — and the catch upstream would blank the ENTIRE
// preview over one embedded board.
for (const type of ['pinterestBoard', 'conversationTile']) {
  let threwInCard = false
  try {
    render(doc({ type, attrs: {} }))
  } catch {
    threwInCard = true
  }
  ok(`a document-only node throws in the CARD schema: ${type}`, threwInCard)

  let previewHtml = ''
  let previewThrew = false
  try {
    previewHtml = renderPreview(doc({ type, attrs: {} }))
  } catch {
    previewThrew = true
  }
  ok(`...and renders in the DOC PREVIEW schema: ${type}`, !previewThrew && previewHtml.length > 0)
}

// The preview schema must still render everything a plain document is made of.
ok('the doc preview schema renders ordinary prose', renderPreview(doc(para('Chapter one'))).includes('Chapter one'))
ok('getDocPreviewExtensions is stable (safe to memo against)', getDocPreviewExtensions() === getDocPreviewExtensions())
