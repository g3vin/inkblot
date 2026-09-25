/**
 * Document persistence: canvases and text documents written side by side, and the guard
 * that stops a stray text autosave from overwriting a canvas with an empty document.
 */
import { files } from './stub-fs.mjs'
const SRC = '../../src/lib'
const { saveDocument, loadDocument, getVersions } = await import(`${SRC}/FileSystem.js`)
const { saveCanvasDocument, loadCanvasDocument } = await import(`${SRC}/canvasFileSystem.js`)
const { createEmptyCanvas, makeTextNode, makeEdge } = await import(`${SRC}/canvasModel.js`)

import { ok } from './assert.mjs'
const P = 'Novel'

// --- Build a canvas the way the app does, and a text doc beside it in the same folder.
const s = createEmptyCanvas()
const a = makeTextNode({ x: 10, y: 20, text: 'Act One' })
const b = makeTextNode({ x: 400, y: 20, text: 'Act Two' })
for (const n of [a, b]) { s.nodes[n.id] = n; s.nodeOrder.push(n.id) }
const e = makeEdge({ fromNode: a.id, fromSide: 'right', toNode: b.id, toSide: 'left' })
s.edges[e.id] = e; s.edgeOrder.push(e.id)

await saveCanvasDocument(P, 'Structure/plan.canvas', s, { x: -5, y: -6, zoom: 1.5 })
await saveDocument(P, 'Structure/chapter-one', { content: { type: 'doc', content: [{ type: 'paragraph' }] }, notes: [{ id: 'n1' }] })

ok('canvas written to <path>.canvas.json', files.has('/appdata/Novel/Structure/plan.canvas.json'))
ok('text doc written to <path>.json',       files.has('/appdata/Novel/Structure/chapter-one.json'))
ok('the two are different files',           files.size >= 2)

// --- THE data-safety case: a rogue text-autosave fires at the canvas path.
// Without the guard in saveDocument, this would rewrite the file as {"content":[],"notes":[]}.
console.log('\n-- simulating a stray text autosave aimed at the canvas --')
await saveDocument(P, 'Structure/plan.canvas', { content: { type: 'doc', content: [] }, notes: [] })
await saveDocument(P, 'Structure/plan.canvas', { content: [], notes: [], _appendVersion: true, _version: { contentHtml: '<p></p>' } })

const reloaded = await loadCanvasDocument(P, 'Structure/plan.canvas')
ok('canvas survived the stray autosave (nodes)', reloaded.state.nodeOrder.length === 2)
ok('canvas survived the stray autosave (edges)', reloaded.state.edgeOrder.length === 1)
ok('card text intact',    reloaded.state.nodes[a.id]?.text === 'Act One')
ok('viewport intact',     reloaded.viewport.zoom === 1.5)

// --- The text doc must still behave exactly as before.
const text = await loadDocument(P, 'Structure/chapter-one')
ok('text doc untouched', text.content.content.length === 1 && text.notes.length === 1)

// --- Canvases get no version history.
ok('getVersions() empty for a canvas', (await getVersions(P, 'Structure/plan.canvas')).length === 0)

// --- On-disk shape is the JSON Canvas spec.
const raw = JSON.parse(files.get('/appdata/Novel/Structure/plan.canvas.json'))
ok('spec: top-level nodes[] / edges[]', Array.isArray(raw.nodes) && Array.isArray(raw.edges))
ok('spec: node has x/y/width/height', ['x','y','width','height'].every(k => typeof raw.nodes[0][k] === 'number'))
ok('spec: edge has fromNode/fromSide/toNode/toSide', raw.edges[0].fromSide === 'right' && raw.edges[0].toSide === 'left')
ok('inkblot extras quarantined under .inkblot', raw.inkblot.viewport.zoom === 1.5)
