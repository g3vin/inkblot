const S = '../../src'
const { getCardSchema, getCardExtensions, buildCardExtensions } = await import(`${S}/lib/editorExtensions.js`)
const ok = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) process.exitCode = 1 }

const schema = getCardSchema()
const marks = Object.keys(schema.marks)
const nodes = Object.keys(schema.nodes)
console.log('marks:', marks.join(', '))
console.log('nodes:', nodes.join(', '))
console.log()

// Every mark/node the titlebar Toolbar can invoke must exist in a card, or the
// button throws the moment someone clicks it on a card.
for (const m of ['bold', 'italic', 'strike', 'underline', 'highlight', 'textStyle'])
  ok(`Toolbar mark "${m}" exists in card schema`, marks.includes(m))
for (const n of ['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'table', 'tableRow', 'tableCell', 'tableHeader', 'image'])
  ok(`Toolbar node "${n}" exists in card schema`, nodes.includes(n))

// textAlign is an attribute, not a mark — check the types it targets carry it.
for (const n of ['heading', 'paragraph', 'tableCell', 'tableHeader'])
  ok(`textAlign attr on "${n}"`, !!schema.nodes[n]?.spec?.attrs?.textAlign)
ok('color/fontFamily ride on textStyle', !!schema.marks.textStyle?.spec?.attrs?.color)

// The doc-scoped extensions must NOT leak into a card.
for (const n of ['conversationTile', 'pinterestBoard'])
  ok(`document-only node "${n}" excluded from cards`, !nodes.includes(n))
ok('document-only mark "noteAnnotation" excluded', !marks.includes('noteAnnotation'))

// A card must be able to REPRESENT real formatted content. Parsing the stored
// JSON against the schema proves that without a DOM.
//
// The other half — generateHTML() serializing it back out, which is how every
// non-editing card renders — cannot be checked here: prosemirror-model reaches
// for `window.document`. That path is only exercisable in the app.
const doc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [{ type: 'text', text: 'Act One' }] },
    { type: 'paragraph', content: [
      { type: 'text', marks: [{ type: 'bold' }], text: 'She ' },
      { type: 'text', marks: [{ type: 'italic' }], text: 'left' },
      { type: 'text', text: ' at dawn.' },
    ]},
    { type: 'bulletList', content: [
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'beat one' }] }] },
    ]},
  ],
}

let parsed = null
try { parsed = schema.nodeFromJSON(doc) } catch (e) { console.log('   parse error:', e.message) }
ok('card schema parses a heading + marks + list', !!parsed)
ok('card content survives the round-trip', parsed && parsed.textContent.includes('Act One') && parsed.textContent.includes('beat one'))
ok('bold/italic marks are representable in a card', !!schema.marks.bold && !!schema.marks.italic)
ok('heading keeps its textAlign attr', parsed?.firstChild?.attrs?.textAlign === 'center')

// An empty doc (a brand-new card) must be valid.
let threw = false
try { schema.nodeFromJSON({ type: 'doc', content: [] }) } catch { threw = true }
ok('an empty card is a valid document', !threw)

// Fresh arrays per editor: TipTap extension instances are stateful.
ok('buildCardExtensions returns a fresh array', buildCardExtensions() !== buildCardExtensions())
ok('getCardExtensions is cached (stable identity for memo)', getCardExtensions() === getCardExtensions())
