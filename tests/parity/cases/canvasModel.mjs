/**
 * canvasModel.js against `inkblot_core::canvas_model`.
 *
 * The interesting inputs here are the malformed ones. `normalizeCanvas` is what stands
 * between a corrupt or foreign file and a crashed pane, so the corpus is mostly files
 * that should not exist: nodes that are numbers, ids that are empty strings, duplicate
 * ids, edges pointing at nothing, sizes below the floor, and another app's keys that
 * have to come back out untouched.
 *
 * **Generated ids.** A node without an id gets `newId()`, which is random on both
 * sides. `canon` rewrites every id in the output that was not in the input — in
 * nodeOrder/edgeOrder order, which both implementations agree on — so the branch is
 * still covered rather than skipped.
 */
import {
  normalizeCanvas, readViewport, serializeCanvas, resolveCanvasColor,
  groupMemberIds, groupFitRect, groupsToRefit, expandGroupSelection, incidentEdgeIds,
  DEFAULT_GROUP_PADDING,
} from '../../../src/lib/canvasModel.js'
import { encode } from '../encode.mjs'

const box = (id, type, x, y, width, height, rest = {}) => ({ id, type, x, y, width, height, ...rest })

/** Explicit ids only — a canvas built for the group functions, so nothing is generated. */
const GROUPED = {
  nodes: [
    box('g1', 'group', 0, 0, 400, 400, { label: 'Act One' }),
    box('g2', 'group', 380, 380, 400, 400),
    box('a', 'text', 20, 20, 100, 60, { text: 'inside g1' }),
    box('b', 'text', 420, 420, 100, 60, { text: 'inside g2' }),
    box('c', 'text', 390, 390, 100, 60, { text: 'inside both' }),
    box('far', 'text', 5000, 5000, 100, 60),
  ],
  edges: [
    { id: 'e1', fromNode: 'a', toNode: 'b', fromSide: 'right', toSide: 'left' },
    { id: 'e2', fromNode: 'b', toNode: 'c' },
    { id: 'e3', fromNode: 'far', toNode: 'a', toEnd: 'arrow', color: '3' },
  ],
}

/** Two groups drawn on top of each other each contain the other. */
const OVERLAPPING = {
  nodes: [box('g1', 'group', 0, 0, 500, 500), box('g2', 'group', 0, 0, 500, 500), box('a', 'text', 10, 10, 100, 60)],
  edges: [],
}

const RAW_CANVASES = [
  null,
  'not a canvas',
  42,
  {},
  { nodes: 'nope', edges: 'nope' },
  { nodes: [], edges: [] },
  GROUPED,
  OVERLAPPING,
  // Every way a node can be malformed.
  {
    nodes: [
      null,
      'string node',
      7,
      {},
      { id: '' },
      { id: 'dup', type: 'text' },
      { id: 'dup', type: 'group', x: 9 },
      { id: 'tiny', width: 1, height: 1 },
      { id: 'huge', width: 1e21, height: -1e21 },
      { id: 'nan', x: NaN, y: Infinity, width: 'wide', height: null },
      { id: 'unknown-type', type: 'sculpture' },
      { id: 'draw', type: 'draw', strokes: [[1, 2], [3, 4]] },
      { id: 'foreign', type: 'text', obsidianOnly: { a: 1 }, styleAttributes: null },
      { id: 'wrong-types', text: 42, color: ['1'], file: false, label: 0, url: {}, inkblotNoteId: 3 },
      { id: 'note', type: 'file', file: 'Chapter/One', inkblotNoteId: 'n1' },
      { id: 'tiptap', type: 'text', inkblotTipTap: { type: 'doc', content: [{ type: 'paragraph' }] } },
    ],
    edges: [
      null,
      'string edge',
      { id: 'dangling', fromNode: 'nowhere', toNode: 'dup' },
      { id: 'dup-edge', fromNode: 'dup', toNode: 'tiny' },
      { id: 'dup-edge', fromNode: 'tiny', toNode: 'dup' },
      { id: '', fromNode: 'dup', toNode: 'note' },
      { id: 'sideways', fromNode: 'dup', toNode: 'note', fromSide: 'sideways', toSide: 4 },
      { id: 'extras', fromNode: 'note', toNode: 'dup', fromEnd: 'none', toEnd: 'arrow', label: 'then', weight: 3 },
    ],
  },
  // Viewport blocks, well-formed and not.
  { nodes: [], edges: [], inkblot: { version: 1, viewport: { x: -12.5, y: 0.1, zoom: 0.35 } } },
  { nodes: [], edges: [], inkblot: { viewport: { x: 'left', zoom: NaN } } },
  { nodes: [], edges: [], inkblot: { viewport: null } },
  { nodes: [], edges: [], inkblot: 'nope' },
]

const VIEWPORTS = [
  { x: 0, y: 0, zoom: 1 },
  { x: -12.5, y: 1 / 3, zoom: 4 },
  { x: NaN, y: Infinity, zoom: 'big' },
]

const COLORS = ['1', '2', '3', '4', '5', '6', '7', '0', '#abcdef', '', null, 'rebeccapurple', 1, 6, true,
  'teal', 'slate', ' teal', '#e5534b', '#E5534B', ' #ffd54f ', '#007aff', '  ', '\uFEFF#abc\uFEFF']

const MOVING = [[], ['a'], ['c'], ['g1'], ['a', 'b'], ['g1', 'c'], ['nowhere'], ['a', 'a']]

/** Ids the input actually declared; anything else in the output was generated. */
const explicitIds = (raw) => {
  const ids = new Set()
  for (const list of [raw?.nodes, raw?.edges]) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      if (item && typeof item === 'object' && typeof item.id === 'string' && item.id) ids.add(item.id)
    }
  }
  return ids
}

const deepReplace = (value, mapping) => {
  if (typeof value === 'string') return mapping.get(value) ?? value
  if (Array.isArray(value)) return value.map((item) => deepReplace(item, mapping))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [mapping.get(key) ?? key, deepReplace(inner, mapping)])
    )
  }
  return value
}

export default {
  name: 'canvasModel',

  /** Rewrite generated ids to `gen0`, `gen1`, … on whichever side produced them. */
  canon(value, { fn, args }) {
    if (fn !== 'normalizeCanvas' && fn !== 'serializeCanvas') return value
    const declared = explicitIds(args[0])
    const sequence = fn === 'normalizeCanvas'
      ? [...(value?.nodeOrder ?? []), ...(value?.edgeOrder ?? [])]
      : [...(value?.nodes ?? []), ...(value?.edges ?? [])].map((item) => item?.id)

    const mapping = new Map()
    for (const id of sequence) {
      if (typeof id === 'string' && !declared.has(id) && !mapping.has(id)) {
        mapping.set(id, `gen${mapping.size}`)
      }
    }
    return deepReplace(value, mapping)
  },

  *cases() {
    const emit = (fn, args, expected) => ({ fn, args: encode(args), expected })

    for (const color of COLORS) {
      yield emit('resolveCanvasColor', [color], resolveCanvasColor(color))
    }

    for (const raw of RAW_CANVASES) {
      yield emit('normalizeCanvas', [raw], normalizeCanvas(raw))
      yield emit('readViewport', [raw], readViewport(raw))

      const state = normalizeCanvas(raw)
      for (const viewport of VIEWPORTS) {
        yield emit('serializeCanvas', [raw, viewport], serializeCanvas(state, viewport))
      }

      for (const groupId of ['g1', 'g2', 'a', 'missing', '']) {
        yield emit('groupMemberIds', [raw, groupId], groupMemberIds(state, groupId))
      }
      for (const moving of MOVING) {
        yield emit('groupsToRefit', [raw, moving], groupsToRefit(state, moving))
        yield emit('expandGroupSelection', [raw, moving], expandGroupSelection(state, moving))
        yield emit('incidentEdgeIds', [raw, moving], incidentEdgeIds(state, moving))
        yield emit(
          'groupFitRect',
          [raw, moving, DEFAULT_GROUP_PADDING],
          groupFitRect(state.nodes, moving, DEFAULT_GROUP_PADDING)
        )
      }
    }
  },
}
