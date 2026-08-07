/**
 * Canvas search.
 *
 * The bug this suite exists to prevent is a silent one: before M8, SearchPanel
 * coerced a canvas to an empty ProseMirror document and it matched NOTHING, with no
 * error anywhere. So the first thing asserted is simply that a canvas yields hits.
 */
const C = '../../src'
const { collectCanvasMatches } = await import(`${C}/lib/canvasSearch.js`)
const { serializeCanvas, createEmptyCanvas, makeTextNode, makeGroupNode, makeFileNode, makeEdge } =
  await import(`${C}/lib/canvasModel.js`)
const ok = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) process.exitCode = 1 }

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
const hits = collectCanvasMatches(raw, 'lighthouse', 'Notes/Plot.canvas')

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
  'lighthouse',
  'x.canvas'
)
ok('matching ignores case', upper.length === 1)

/* ---- degenerate inputs must not throw ---- */

ok('an empty canvas yields nothing', collectCanvasMatches(serializeCanvas(createEmptyCanvas()), 'x', 'x.canvas').length === 0)
ok('a null document yields nothing', collectCanvasMatches(null, 'x', 'x.canvas').length === 0)
ok('an empty query yields nothing', collectCanvasMatches(raw, '', 'x.canvas').length === 0)
ok('garbage yields nothing', collectCanvasMatches({ nodes: 'nope' }, 'x', 'x.canvas').length === 0)

/* ---- the result cap is honored ---- */

const many = createEmptyCanvas()
for (let i = 0; i < 50; i += 1) {
  const node = makeTextNode({ text: 'match match match' })
  many.nodes[node.id] = node
  many.nodeOrder.push(node.id)
}
ok('the limit caps results', collectCanvasMatches(serializeCanvas(many), 'match', 'x.canvas', { limit: 24 }).length === 24)
