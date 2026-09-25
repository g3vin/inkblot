/**
 * Groups: the create/ungroup reducer actions, and the geometric membership that a
 * drag resolves at pointer-down.
 *
 * Membership is never stored, so the thing worth testing is that it is derived
 * correctly from the rects alone — including the case that would hang a naive
 * implementation (two groups that each contain the other).
 */
const C = '../../src'
const { historyReducer, createHistory } = await import(`${C}/canvas/canvasReducer.ts`)
const {
  createEmptyCanvas,
  makeTextNode,
  makeGroupNode,
  makeEdge,
  groupMemberIds,
  expandGroupSelection,
  groupsToRefit,
  DEFAULT_GROUP_PADDING,
} = await import(`${C}/lib/canvasModel.js`)
import { ok } from './assert.mjs'

let h = createHistory(createEmptyCanvas())
const run = (a) => { h = historyReducer(h, a) }
const doc = () => h.present

/* ---- group/create ---- */

const a = makeTextNode({ x: 100, y: 100 })   // 260x140 by default
const b = makeTextNode({ x: 500, y: 300 })
run({ type: 'nodes/add', nodes: [a, b] })
run({ type: 'group/create', nodeIds: [a.id, b.id] })

const groupId = doc().nodeOrder[0]
const group = doc().nodes[groupId]
ok('group/create adds a group node', group?.type === 'group')
ok('group sorts to the BACK of nodeOrder (renders behind)', doc().nodeOrder[0] === groupId)

// The bounding box of the two cards is (100,100)–(760,440), padded on every side.
ok('group x is the padded bounding box', group.x === 100 - DEFAULT_GROUP_PADDING)
ok('group y is the padded bounding box', group.y === 100 - DEFAULT_GROUP_PADDING)
ok('group width spans both cards + padding', group.width === 660 + DEFAULT_GROUP_PADDING * 2)
ok('group height spans both cards + padding', group.height === 340 + DEFAULT_GROUP_PADDING * 2)

ok('group/create is 1 undo step', h.past.length === 2)
run({ type: 'history/undo' })
ok('undo removes the group', doc().nodeOrder.length === 2)
run({ type: 'history/redo' })

/* ---- membership is geometric ---- */

const members = groupMemberIds(doc(), groupId)
ok('the group claims both enclosed cards', members.includes(a.id) && members.includes(b.id))
ok('the group does not claim itself', !members.includes(groupId))

const outside = makeTextNode({ x: 5000, y: 5000 })
run({ type: 'nodes/add', nodes: [outside] })
ok('a card outside the frame is not a member', !groupMemberIds(doc(), groupId).includes(outside.id))

// A card only half inside is NOT a member: containment, not intersection.
const straddling = makeTextNode({ x: group.x + group.width - 50, y: group.y })
run({ type: 'nodes/add', nodes: [straddling] })
ok('a card straddling the border is not a member', !groupMemberIds(doc(), groupId).includes(straddling.id))

/* ---- dragging a group carries its members ---- */

const dragged = expandGroupSelection(doc(), [groupId])
ok('dragging the group carries its members', dragged.includes(a.id) && dragged.includes(b.id))
ok('dragging the group carries the group itself', dragged.includes(groupId))
ok('dragging the group does not carry outsiders', !dragged.includes(outside.id))

const draggedCard = expandGroupSelection(doc(), [a.id])
ok('dragging a plain card carries only itself', draggedCard.length === 1 && draggedCard[0] === a.id)

/* ---- the case that would hang a naive walk ---- */

// Two groups drawn on the same rect each contain the other. Containment is not a
// tree, so the expansion must terminate rather than recurse forever.
let h2 = createHistory(createEmptyCanvas())
const twin1 = makeGroupNode({ x: 0, y: 0, width: 400, height: 400 })
const twin2 = makeGroupNode({ x: 0, y: 0, width: 400, height: 400 })
const inner = makeTextNode({ x: 50, y: 50 })
h2 = historyReducer(h2, { type: 'nodes/add', nodes: [twin1, twin2, inner] })
const mutual = expandGroupSelection(h2.present, [twin1.id])
ok('mutually-containing groups terminate', mutual.length === 3)
ok('mutually-containing groups carry the card', mutual.includes(inner.id))

// Nested groups: dragging the outer one carries the inner one AND the inner's cards.
let h3 = createHistory(createEmptyCanvas())
const outer = makeGroupNode({ x: 0, y: 0, width: 800, height: 800 })
const nested = makeGroupNode({ x: 100, y: 100, width: 400, height: 400 })
const deep = makeTextNode({ x: 150, y: 150 })
h3 = historyReducer(h3, { type: 'nodes/add', nodes: [outer, nested, deep] })
const nestedDrag = expandGroupSelection(h3.present, [outer.id])
ok('a nested group is carried by its parent', nestedDrag.includes(nested.id))
ok("a nested group's cards are carried too", nestedDrag.includes(deep.id))

/* ---- group/ungroup ---- */

const beforeUngroup = doc().nodeOrder.length
run({ type: 'group/ungroup', groupIds: [groupId] })
ok('ungroup removes the group frame', !doc().nodes[groupId])
ok('ungroup keeps every member', !!doc().nodes[a.id] && !!doc().nodes[b.id])
ok('ungroup removed exactly one node', doc().nodeOrder.length === beforeUngroup - 1)
run({ type: 'history/undo' })
ok('undo brings the group back', !!doc().nodes[groupId])

// Ungrouping something that isn't a group must be a no-op, not a delete.
const h4 = h
h = historyReducer(h, { type: 'group/ungroup', groupIds: [a.id] })
ok('ungrouping a plain card is a no-op', h === h4)

// Grouping nothing must not create an empty frame.
const h5 = h
h = historyReducer(h, { type: 'group/create', nodeIds: [] })
ok('grouping an empty selection is a no-op', h === h5)

/* ---- a group re-fits around members that move ---- */

let h7 = createHistory(createEmptyCanvas())
const m1 = makeTextNode({ x: 0, y: 0 })       // 260x140
const m2 = makeTextNode({ x: 400, y: 0 })
const loner = makeTextNode({ x: 4000, y: 4000 })
h7 = historyReducer(h7, { type: 'nodes/add', nodes: [m1, m2, loner] })
h7 = historyReducer(h7, { type: 'group/create', nodeIds: [m1.id, m2.id] })

const gid = h7.present.nodeOrder[0]
const before = h7.present.nodes[gid]

// groupsToRefit reports the groups a drag reaches into, with membership taken NOW.
let fits = groupsToRefit(h7.present, [m2.id])
ok('a group holding a dragged card is refit', !!fits[gid])
ok('the refit keeps the pre-drag member list', fits[gid].includes(m1.id) && fits[gid].includes(m2.id))

ok('a group untouched by the drag is not refit', !groupsToRefit(h7.present, [loner.id])[gid])
// Dragging the group itself moves it rigidly — it must never resize.
ok('a group being dragged is not refit', !groupsToRefit(h7.present, [gid, m1.id, m2.id])[gid])

// Drag m2 far right: the group must EXPAND to keep holding it, even though it now
// sits outside the old frame (geometric membership alone would have dropped it).
h7 = historyReducer(h7, {
  type: 'nodes/setPositions',
  positions: { [m2.id]: { x: 900, y: 0 } },
  fitGroups: fits,
})
const grown = h7.present.nodes[gid]
ok('the group expanded to follow the card', grown.width > before.width)
ok('the group still ends past the moved card', grown.x + grown.width >= 900 + 260)
ok('the card is a member again after the refit', groupMemberIds(h7.present, gid).includes(m2.id))

// And back: dragging it in must CONTRACT the group rather than leave dead space.
fits = groupsToRefit(h7.present, [m2.id])
h7 = historyReducer(h7, {
  type: 'nodes/setPositions',
  positions: { [m2.id]: { x: 400, y: 0 } },
  fitGroups: fits,
})
const shrunk = h7.present.nodes[gid]
ok('the group contracted back', shrunk.width === before.width)
ok('the group returned to its original box', shrunk.x === before.x && shrunk.y === before.y)

// The refit rides inside the move action, so the whole gesture is still ONE undo step.
const steps = h7.past.length
h7 = historyReducer(h7, { type: 'history/undo' })
ok('move + group refit is a single undo step', h7.past.length === steps - 1)
ok('undo restores the group box too', h7.present.nodes[gid].width === grown.width)

// Resizing a member grows the group as well.
let h8 = createHistory(createEmptyCanvas())
const r1 = makeTextNode({ x: 0, y: 0 })
h8 = historyReducer(h8, { type: 'nodes/add', nodes: [r1] })
h8 = historyReducer(h8, { type: 'group/create', nodeIds: [r1.id] })
const rgid = h8.present.nodeOrder[0]
const rBefore = h8.present.nodes[rgid]
h8 = historyReducer(h8, {
  type: 'nodes/setRects',
  rects: { [r1.id]: { x: 0, y: 0, width: 600, height: 400 } },
  fitGroups: groupsToRefit(h8.present, [r1.id]),
})
ok('resizing a member grows its group', h8.present.nodes[rgid].width > rBefore.width)
ok('the grown group still holds the member', groupMemberIds(h8.present, rgid).includes(r1.id))

// A group whose members have all been deleted keeps its frame rather than collapsing.
const emptyFit = { [rgid]: ['gone-id'] }
const kept = historyReducer(h8, { type: 'nodes/setPositions', positions: {}, fitGroups: emptyFit })
ok('a group with no surviving members keeps its box', kept.present.nodes[rgid].width === h8.present.nodes[rgid].width)

// A group has no ports, but deleting one must still never orphan an edge.
let h6 = createHistory(createEmptyCanvas())
const c1 = makeTextNode({ x: 0, y: 0 })
const c2 = makeTextNode({ x: 300, y: 0 })
h6 = historyReducer(h6, { type: 'nodes/add', nodes: [c1, c2] })
h6 = historyReducer(h6, { type: 'edges/add', edges: [makeEdge({ fromNode: c1.id, toNode: c2.id })] })
h6 = historyReducer(h6, { type: 'group/create', nodeIds: [c1.id, c2.id] })
ok('grouping cards leaves their edge alone', h6.present.edgeOrder.length === 1)
h6 = historyReducer(h6, { type: 'group/ungroup', groupIds: [h6.present.nodeOrder[0]] })
ok('ungrouping leaves their edge alone', h6.present.edgeOrder.length === 1)
