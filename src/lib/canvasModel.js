/**
 * canvasModel.js — the canvas document format and its runtime shape.
 *
 * On disk we write the open JSON Canvas spec (https://jsoncanvas.org):
 *
 *   { nodes: [{ id, type, x, y, width, height, color?, text?, file?, label? }],
 *     edges: [{ id, fromNode, fromSide, toNode, toSide, fromEnd?, toEnd?, color?, label? }] }
 *
 * so a canvas made here opens in Obsidian and vice versa. Inkblot-only data
 * rides along in optional keys a foreign reader ignores:
 *   - node.inkblotTipTap — the card's full TipTap JSON (node.text is the lossy
 *     plain-text projection the spec asks for)
 *   - doc.inkblot        — { version, viewport }
 *
 * At runtime nodes/edges are normalized into id→object maps plus explicit order
 * arrays: the maps give O(1) patching, the arrays give stable z-order. Nothing
 * here touches the filesystem or React — it is all pure, so the reducer can
 * rely on it.
 */
import { nodesBounds, padRect, rectContains } from './canvasGeometry'

export const CANVAS_FORMAT_VERSION = 1

/** Node types we understand. 'draw' is reserved: normalizeCanvas round-trips it
 *  untouched so a future freehand layer needs no format migration. */
export const NODE_TYPES = ['text', 'file', 'link', 'group', 'draw']

/** JSON Canvas presets are the strings '1'–'6'. A node may also carry any hex
 *  color, which we pass through untouched. */
export const CANVAS_COLOR_PRESETS = [
  { id: '1', label: 'Red', value: '#e5534b' },
  { id: '2', label: 'Orange', value: '#e8873c' },
  { id: '3', label: 'Yellow', value: '#e0b341' },
  { id: '4', label: 'Green', value: '#4fb477' },
  { id: '5', label: 'Cyan', value: '#3fa9c4' },
  { id: '6', label: 'Purple', value: '#a07cd4' },
]

const PRESET_BY_ID = new Map(CANVAS_COLOR_PRESETS.map((preset) => [preset.id, preset.value]))

/**
 * Resolve a spec color ('1'–'6' or '#rrggbb') to a CSS color.
 *
 * Unset resolves to `--canvas-ink` — near-white in dark mode, near-black in light —
 * NOT the accent color. An uncolored card or arrow is the neutral default state, and
 * painting every one of them accent-blue made the accent meaningless: it should mark
 * what is *selected*, not what merely exists. The token is defined on .canvas-surface
 * in Canvas.css, so it follows the theme for free.
 */
export const resolveCanvasColor = (color) => {
  if (!color) return 'var(--canvas-ink)'
  return PRESET_BY_ID.get(String(color)) || String(color)
}

export const DEFAULT_TEXT_NODE_SIZE = { width: 260, height: 140 }
export const DEFAULT_FILE_NODE_SIZE = { width: 320, height: 220 }
// Taller than it is wide: a Pinterest board is a column of pins.
export const DEFAULT_LINK_NODE_SIZE = { width: 340, height: 420 }
// A note card holds a quote, a body, and any replies — it needs room to breathe.
export const DEFAULT_NOTE_NODE_SIZE = { width: 300, height: 240 }
// A voice memo is a play button and a scrub bar; it has no reason to be tall.
export const DEFAULT_AUDIO_NODE_SIZE = { width: 260, height: 72 }
export const DEFAULT_GROUP_PADDING = 24
export const MIN_NODE_SIZE = { width: 100, height: 60 }

/** 16 hex chars, matching the id style Obsidian writes. */
export const newId = () => {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/* ---------- factories ---------- */

export const makeTextNode = ({ x = 0, y = 0, text = '', ...rest } = {}) => ({
  id: newId(),
  type: 'text',
  x: Math.round(x),
  y: Math.round(y),
  ...DEFAULT_TEXT_NODE_SIZE,
  text,
  ...rest,
})

export const makeFileNode = ({ x = 0, y = 0, file = '', ...rest } = {}) => ({
  id: newId(),
  type: 'file',
  x: Math.round(x),
  y: Math.round(y),
  ...DEFAULT_FILE_NODE_SIZE,
  file,
  ...rest,
})

/**
 * A note (and its replies) from a document, placed on the canvas.
 *
 * Stored as a spec `file` node pointing at the document that OWNS the note, plus one
 * inkblot-only key naming which note. The note itself is never copied onto the
 * canvas — the document remains the single source of truth, which is what makes
 * editing it from either side stay in sync rather than fork into two versions.
 *
 * A foreign reader sees a plain file reference to the document, which is true.
 */
export const makeNoteNode = ({ x = 0, y = 0, file = '', noteId = '', ...rest } = {}) => ({
  id: newId(),
  type: 'file',
  x: Math.round(x),
  y: Math.round(y),
  ...DEFAULT_NOTE_NODE_SIZE,
  file,
  inkblotNoteId: noteId,
  ...rest,
})

export const DEFAULT_TIMELINE_EVENT_NODE_SIZE = { width: 260, height: 120 }

/** Where the chronology lives: what a timeline event card's `file` names. */
export const TIMELINE_FILE = '.story/timeline.json'

/**
 * A timeline event, placed on the canvas. Like a note card it is a reference, not a
 * copy: a spec `file` node naming the project's chronology, plus the event's id — so
 * the card shows the event as it is now, dates and all, wherever it has been dragged.
 */
export const makeTimelineEventNode = ({ x = 0, y = 0, eventId = '', ...rest } = {}) => ({
  id: newId(),
  type: 'file',
  x: Math.round(x),
  y: Math.round(y),
  ...DEFAULT_TIMELINE_EVENT_NODE_SIZE,
  file: TIMELINE_FILE,
  inkblotTimelineEventId: eventId,
  ...rest,
})

/** A URL on the canvas. A Pinterest board url renders as the board (CanvasLinkNode). */
export const makeLinkNode = ({ x = 0, y = 0, url = '', ...rest } = {}) => ({
  id: newId(),
  type: 'link',
  x: Math.round(x),
  y: Math.round(y),
  ...DEFAULT_LINK_NODE_SIZE,
  url,
  ...rest,
})

export const makeGroupNode = ({ x = 0, y = 0, width = 400, height = 300, label = '', ...rest } = {}) => ({
  id: newId(),
  type: 'group',
  x: Math.round(x),
  y: Math.round(y),
  width: Math.round(width),
  height: Math.round(height),
  label,
  ...rest,
})

export const makeEdge = ({ fromNode, fromSide, toNode, toSide, ...rest } = {}) => ({
  id: newId(),
  fromNode,
  fromSide,
  toNode,
  toSide,
  toEnd: 'arrow',
  ...rest,
})

/* ---------- empty / normalize / serialize ---------- */

export const createEmptyCanvas = () => ({
  nodes: {},
  nodeOrder: [],
  edges: {},
  edgeOrder: [],
})

export const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 }

const finiteOr = (value, fallback) => (Number.isFinite(value) ? value : fallback)

/** Groups render behind everything else, so they sort to the front of nodeOrder. */
const byGroupsFirst = (nodes) => (a, b) => {
  const aGroup = nodes[a]?.type === 'group' ? 0 : 1
  const bGroup = nodes[b]?.type === 'group' ? 0 : 1
  return aGroup - bGroup
}

/**
 * Parse arbitrary on-disk JSON into the runtime shape. Anything unrecognizable
 * degrades to an empty canvas rather than throwing — a corrupt or foreign file
 * should open blank, never crash the pane. Unknown node/edge keys are preserved
 * so a round-trip through inkblot doesn't strip another app's data.
 */
export function normalizeCanvas(raw) {
  const state = createEmptyCanvas()
  if (!raw || typeof raw !== 'object') return state

  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : []
  for (const node of rawNodes) {
    if (!node || typeof node !== 'object') continue
    const id = typeof node.id === 'string' && node.id ? node.id : newId()
    if (state.nodes[id]) continue
    const type = NODE_TYPES.includes(node.type) ? node.type : 'text'

    state.nodes[id] = {
      ...node,
      id,
      type,
      x: finiteOr(node.x, 0),
      y: finiteOr(node.y, 0),
      width: Math.max(MIN_NODE_SIZE.width, finiteOr(node.width, DEFAULT_TEXT_NODE_SIZE.width)),
      height: Math.max(MIN_NODE_SIZE.height, finiteOr(node.height, DEFAULT_TEXT_NODE_SIZE.height)),
    }
    state.nodeOrder.push(id)
  }
  state.nodeOrder.sort(byGroupsFirst(state.nodes))

  const rawEdges = Array.isArray(raw.edges) ? raw.edges : []
  for (const edge of rawEdges) {
    if (!edge || typeof edge !== 'object') continue
    const id = typeof edge.id === 'string' && edge.id ? edge.id : newId()
    if (state.edges[id]) continue
    // An edge to a node that isn't here is unrenderable; drop it.
    if (!state.nodes[edge.fromNode] || !state.nodes[edge.toNode]) continue

    state.edges[id] = { ...edge, id }
    state.edgeOrder.push(id)
  }

  return state
}

/** Read the persisted viewport, tolerating a missing or malformed `inkblot` block. */
export function readViewport(raw) {
  const viewport = raw?.inkblot?.viewport
  if (!viewport || typeof viewport !== 'object') return { ...DEFAULT_VIEWPORT }
  return {
    x: finiteOr(viewport.x, DEFAULT_VIEWPORT.x),
    y: finiteOr(viewport.y, DEFAULT_VIEWPORT.y),
    zoom: finiteOr(viewport.zoom, DEFAULT_VIEWPORT.zoom),
  }
}

/** Runtime shape → the spec-shaped object we write to disk. */
export function serializeCanvas(state, viewport = DEFAULT_VIEWPORT) {
  return {
    type: 'canvas', // interop/debugging marker only — never routed on (see docKind.js)
    nodes: state.nodeOrder.map((id) => state.nodes[id]).filter(Boolean),
    edges: state.edgeOrder.map((id) => state.edges[id]).filter(Boolean),
    inkblot: {
      version: CANVAS_FORMAT_VERSION,
      viewport: {
        x: finiteOr(viewport?.x, DEFAULT_VIEWPORT.x),
        y: finiteOr(viewport?.y, DEFAULT_VIEWPORT.y),
        zoom: finiteOr(viewport?.zoom, DEFAULT_VIEWPORT.zoom),
      },
    },
  }
}

/* ---------- groups ---------- */

/**
 * The nodes a group contains. Membership is GEOMETRIC and never stored: a node
 * belongs to a group exactly when its rect sits inside the group's, resolved fresh
 * at the moment it matters (pointer-down). That is what Obsidian does, and it keeps
 * the on-disk format spec-clean — a group is just a rect with a label, so a canvas
 * grouped here still opens correctly anywhere else.
 */
export function groupMemberIds(state, groupId) {
  const group = state.nodes[groupId]
  if (!group || group.type !== 'group') return []

  return state.nodeOrder.filter((id) => {
    if (id === groupId) return false
    const node = state.nodes[id]
    return node && rectContains(group, node)
  })
}

/** The rect a group must occupy to hold `memberIds`, padded. Null if it holds none. */
export function groupFitRect(nodes, memberIds, padding = DEFAULT_GROUP_PADDING) {
  const members = memberIds.map((id) => nodes[id]).filter(Boolean)
  const bounds = nodesBounds(members)
  return bounds ? padRect(bounds, padding) : null
}

/**
 * The groups that must be re-fitted because a drag touches something they hold.
 *
 * Returns `{ groupId: [memberIds] }`, with membership taken NOW — before the move.
 * That snapshot is the whole point: if a card is dragged out past its group's edge,
 * geometric membership would say it had left, and the group would snap shut behind
 * it. Holding the pre-drag list instead means the group stretches to follow the card,
 * which is what the gesture looks like it should do.
 *
 * Groups that are themselves being dragged are excluded — they move rigidly with
 * their contents and must not resize.
 */
export function groupsToRefit(state, movingIds) {
  const moving = new Set(movingIds)
  const fits = {}

  for (const id of state.nodeOrder) {
    const node = state.nodes[id]
    if (node?.type !== 'group' || moving.has(id)) continue

    const members = groupMemberIds(state, id)
    if (members.some((memberId) => moving.has(memberId))) fits[id] = members
  }

  return fits
}

/**
 * Expand a selection to everything a drag of it should carry: every group in the
 * selection brings its members, and a member that is itself a group brings its own.
 *
 * Walked with a worklist rather than recursion because containment is not a tree —
 * two groups drawn on top of each other each contain the other, and a naive walk
 * would not terminate. `seen` makes that case a no-op instead of a hang.
 */
export function expandGroupSelection(state, ids) {
  const seen = new Set()
  const queue = [...ids]

  while (queue.length) {
    const id = queue.pop()
    if (seen.has(id)) continue
    seen.add(id)

    const node = state.nodes[id]
    if (node?.type === 'group') {
      for (const memberId of groupMemberIds(state, id)) {
        if (!seen.has(memberId)) queue.push(memberId)
      }
    }
  }

  return [...seen]
}

/** Every edge touching one of `nodeIds` — deleting a node must take these with it. */
export function incidentEdgeIds(state, nodeIds) {
  const targets = new Set(nodeIds)
  return state.edgeOrder.filter((id) => {
    const edge = state.edges[id]
    return edge && (targets.has(edge.fromNode) || targets.has(edge.toNode))
  })
}
