/**
 * The canvas reducer and its undo history: one undo step per gesture, and deleting a
 * node takes its edges with it.
 */
const C = '../../src'
const { historyReducer, createHistory, canUndo, canRedo } = await import(`${C}/canvas/canvasReducer.ts`)
const { createEmptyCanvas, makeTextNode, makeEdge } = await import(`${C}/lib/canvasModel.js`)
import { ok } from './assert.mjs'

let h = createHistory(createEmptyCanvas())
const run = (a) => { h = historyReducer(h, a) }
const doc = () => h.present

// build: two cards + an edge = 3 undo steps
const a = makeTextNode({ x: 0, y: 0, text: 'A' })
const b = makeTextNode({ x: 400, y: 0, text: 'B' })
run({ type: 'nodes/add', nodes: [a] })
run({ type: 'nodes/add', nodes: [b] })
const e = makeEdge({ fromNode: a.id, fromSide: 'right', toNode: b.id, toSide: 'left' })
run({ type: 'edges/add', edges: [e] })
ok('built 2 nodes + 1 edge', doc().nodeOrder.length === 2 && doc().edgeOrder.length === 1)
ok('3 undo steps recorded', h.past.length === 3)

// a drag of both cards = ONE step
const before = doc()
run({ type: 'nodes/setPositions', positions: { [a.id]: { x: 50, y: 60 }, [b.id]: { x: 450, y: 60 } } })
ok('multi-node drag moved both', doc().nodes[a.id].x === 50 && doc().nodes[b.id].x === 450)
ok('multi-node drag = 1 undo step', h.past.length === 4)
run({ type: 'history/undo' })
ok('undo restores both positions at once', doc().nodes[a.id].x === 0 && doc().nodes[b.id].x === 400)
ok('undo is exact (identity restored)', doc() === before)
run({ type: 'history/redo' })
ok('redo reapplies', doc().nodes[a.id].x === 50)

// structural sharing: an untouched node keeps identity, so React.memo can skip it
const bBefore = doc().nodes[b.id]
run({ type: 'nodes/patch', id: a.id, patch: { color: '4' } })
ok('untouched node keeps object identity', doc().nodes[b.id] === bBefore)
ok('patched node is a new object', doc().nodes[a.id].color === '4')

// THE compound case: deleting a node must take its edges, as one step
run({ type: 'selection/delete', nodeIds: [a.id], edgeIds: [] })
ok('deleting a node removes it', !doc().nodes[a.id])
ok('deleting a node removes its incident edge', doc().edgeOrder.length === 0)
const steps = h.past.length
run({ type: 'history/undo' })
ok('undo restores the node AND its edge together', !!doc().nodes[a.id] && doc().edgeOrder.length === 1)
ok('that whole delete was 1 step', h.past.length === steps - 1)

// coalescing: a color drag collapses into one entry, then breaks after idle
const base = h.past.length
run({ type: 'nodes/patch', id: b.id, patch: { color: '1' }, meta: { coalesce: `c:${b.id}` } })
run({ type: 'nodes/patch', id: b.id, patch: { color: '2' }, meta: { coalesce: `c:${b.id}` } })
run({ type: 'nodes/patch', id: b.id, patch: { color: '3' }, meta: { coalesce: `c:${b.id}` } })
ok('coalesced edits = 1 undo step', h.past.length === base + 1)
ok('coalesced edits keep the latest value', doc().nodes[b.id].color === '3')
run({ type: 'history/undo' })
ok('undo of a coalesced run reverts the whole run', doc().nodes[b.id].color === undefined)

run({ type: 'history/redo' })
run({ type: 'nodes/patch', id: b.id, patch: { color: '5' }, meta: { coalesce: `c:${b.id}` } })
run({ type: 'history/breakCoalesce' })
run({ type: 'nodes/patch', id: b.id, patch: { color: '6' }, meta: { coalesce: `c:${b.id}` } })
ok('breakCoalesce starts a new undo step', h.past.length >= base + 2)

// a new edit clears the redo stack
run({ type: 'history/undo' })
ok('redo available after undo', canRedo(h))
run({ type: 'nodes/add', nodes: [makeTextNode({ x: 9, y: 9 })] })
ok('a fresh edit clears redo', !canRedo(h))

// loading is not an edit
h = historyReducer(h, { type: 'doc/replace', doc: createEmptyCanvas(), meta: { silent: true } })
ok('doc/replace wipes history', !canUndo(h) && !canRedo(h))

// an edge to a missing node is unrenderable and must be dropped
h = createHistory(createEmptyCanvas())
run({ type: 'edges/add', edges: [makeEdge({ fromNode: 'ghost', toNode: 'ghost2' })] })
ok('edge to a missing node rejected', doc().edgeOrder.length === 0)

// no-op actions must not create history entries
const h0 = h
h = historyReducer(h, { type: 'nodes/patch', id: 'nope', patch: { color: '1' } })
ok('no-op action creates no undo step', h === h0)
