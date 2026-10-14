/**
 * Canvas search.
 *
 * The failure this suite guards against is silent: a canvas coerced to an empty
 * ProseMirror document matches NOTHING, with no error anywhere. So the first thing
 * asserted is simply that a canvas yields hits.
 */
const C = '../../src'
const { collectCanvasMatches } = await import(`${C}/lib/canvasSearch.js`)
const { serializeCanvas, createEmptyCanvas, makeTextNode, makeGroupNode, makeFileNode, makeEdge } =
  await import(`${C}/lib/canvasModel.js`)
const { createMatcher, searchEverything } = await import(`${C}/lib/sidebarSearch.js`)

// collectCanvasMatches takes a COMPILED matcher, not a query string — the same one
// sidebarSearch builds, so every search honours the same case/whole-word/regex
// switches. Passing a bare string makes it return [] silently, which is the exact
// failure this suite exists to catch.
const m = (query, options) => createMatcher(query, options)
import { ok } from './assert.mjs'

const state = createEmptyCanvas()
const add = (node) => { state.nodes[node.id] = node; state.nodeOrder.push(node.id); return node }

const a = add(makeTextNode({ x: 0, y: 0, text: 'The lighthouse keeper\nkept the lighthouse' }))
const b = add(makeTextNode({ x: 400, y: 0, text: 'Nothing to see' }))
const group = add(makeGroupNode({ x: -50, y: -50, label: 'Lighthouse arc' }))
const file = add(makeFileNode({ x: 800, y: 0, file: 'Chapters/Lighthouse.json' }))

const edge = makeEdge({ fromNode: a.id, toNode: b.id, label: 'to the lighthouse' })
state.edges[edge.id] = edge
state.edgeOrder.push(edge.id)

// Search reads the on-disk shape, which is what SearchPanel loads.
const raw = serializeCanvas(state)
const hits = collectCanvasMatches(raw, m('lighthouse'), 'Notes/Plot.canvas')

ok('a canvas yields matches at all', hits.length > 0)

const forNode = (id) => hits.filter((hit) => hit.nodeId === id)
// Card `a` is also the source of the labelled edge, and an edge's hit is addressed
// by its source node — so a.id's hits are its own two plus that one.
const cardHits = hits.filter((hit) => hit.title === 'The lighthouse keeper')
ok('a card matches on its text', cardHits.length > 0)
ok('a card matching twice reports both', cardHits.length === 2)
ok('a non-matching card yields nothing', forNode(b.id).length === 0)
ok('a group matches on its label', forNode(group.id).length === 1)
ok('a file card matches on its path', forNode(file.id).length === 1)

// An edge has no position of its own, so its hit is revealed via its source node.
const edgeHit = hits.find((hit) => hit.matchText && hit.title === 'to the lighthouse')
ok('an edge matches on its label', !!edgeHit)
ok('an edge hit is addressed by its source node', edgeHit.nodeId === a.id)

/* ---- the shape SearchPanel and the reveal path rely on ---- */

const hit = forNode(a.id)[0]
ok('a hit carries the node id (not a doc position)', typeof hit.nodeId === 'string' && !!hit.nodeId)
ok('a hit carries the doc path', hit.docName === 'Notes/Plot.canvas' && hit.path === 'Notes/Plot.canvas')
ok('a hit is typed as a canvas match', hit.type === 'canvas-match')
ok('a hit has a preview', hit.preview.toLowerCase().includes('lighthouse'))
ok('a hit preserves the matched text', hit.matchText === 'lighthouse')
ok('ids are unique', new Set(hits.map((h) => h.id)).size === hits.length)
ok("a card's title is its first line", forNode(a.id)[0].title === 'The lighthouse keeper')

/* ---- matching is case-insensitive against a lowercased query ---- */

const upper = collectCanvasMatches(
  serializeCanvas((() => {
    const s = createEmptyCanvas()
    const n = makeTextNode({ text: 'LIGHTHOUSE' })
    s.nodes[n.id] = n
    s.nodeOrder.push(n.id)
    return s
  })()),
  m('lighthouse'),
  'x.canvas'
)
ok('matching ignores case', upper.length === 1)

/* ---- degenerate inputs must not throw ---- */

ok('an empty canvas yields nothing', collectCanvasMatches(serializeCanvas(createEmptyCanvas()), m('x'), 'x.canvas').length === 0)
ok('a null document yields nothing', collectCanvasMatches(null, m('x'), 'x.canvas').length === 0)
ok('an empty query yields nothing', collectCanvasMatches(raw, m(''), 'x.canvas').length === 0)
ok('garbage yields nothing', collectCanvasMatches({ nodes: 'nope' }, m('x'), 'x.canvas').length === 0)

/* ---- the result cap is honored ---- */

const many = createEmptyCanvas()
for (let i = 0; i < 50; i += 1) {
  const node = makeTextNode({ text: 'match match match' })
  many.nodes[node.id] = node
  many.nodeOrder.push(node.id)
}
ok('the limit caps results', collectCanvasMatches(serializeCanvas(many), m('match'), 'x.canvas', { limit: 24 }).length === 24)

/* ---- the project search: one walk, sorted into categories ---- */

const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const doc = (...texts) => ({ content: { type: 'doc', content: texts.map(para) } })
const files = {
  'Chapters/Harbour': { ...doc('The ferry left at dawn.'), notes: [{ id: 'n1', anchor: 'ferry', content: 'Check the ferry timetable' }] },
  'Chapters/Ferry crossing': doc('Rain all the way over.'),
  'Chapters/Open one': doc('A ferry in the chapter being written.'),
  'Plot.canvas': serializeCanvas((() => {
    const board = createEmptyCanvas()
    const card = makeTextNode({ x: 0, y: 0, text: 'ferry to the island' })
    board.nodes[card.id] = card
    board.nodeOrder.push(card.id)
    return board
  })()),
  'Days.timeline': {},
}
const tree = {
  type: 'folder', path: '', children: Object.keys(files).map((path) => ({ type: 'file', path, name: path.split('/').pop() })),
}
const found = await searchEverything({
  matcher: m('ferry'),
  projectName: 'Novel',
  currentDocName: 'Chapters/Open one',
  listProjectTree: async () => tree,
  loadDocument: async (_project, path) => files[path] ?? null,
})
const docNames = found.documents.map((row) => row.docName)
ok('a document whose name matches comes first', docNames[0] === 'Chapters/Ferry crossing')
ok('documents matching in their text follow', docNames.includes('Chapters/Harbour') && docNames.includes('Plot.canvas'))
ok('one row per document, however often it matches', new Set(docNames).size === docNames.length)
ok('the document being written in is left to "In this document"', !docNames.includes('Chapters/Open one'))
ok('a text match carries where it is, for the jump', typeof found.documents.find((row) => row.docName === 'Chapters/Harbour').from === 'number')
ok('a canvas match carries its card, for the reveal', !!found.documents.find((row) => row.docName === 'Plot.canvas').nodeId)
ok('each row says its kind, for its icon', found.documents.find((row) => row.docName === 'Plot.canvas').kind === 'canvas')
ok('notes are their own category', found.notes.length === 1 && found.notes[0].note.id === 'n1')

const capped = await searchEverything({
  matcher: m('ferry'), projectName: 'Novel', listProjectTree: async () => tree,
  loadDocument: async (_project, path) => files[path] ?? null, limit: 1,
})
ok('each category is capped', capped.documents.length === 1 && capped.notes.length === 1)
ok('an empty query searches nothing', (await searchEverything({
  matcher: m(''), projectName: 'Novel', listProjectTree: async () => tree, loadDocument: async () => null,
})).documents.length === 0)
