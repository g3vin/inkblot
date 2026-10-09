/**
 * canvasReducer.ts — canvas document state, with undo/redo layered on top.
 *
 * The reducer never mutates: an untouched node keeps its object identity, which
 * is what lets React.memo skip it and what makes whole-document history entries
 * cheap (a snapshot is one new top-level object plus a few hundred pointer
 * copies, not a deep clone).
 *
 * History is whole-document snapshots rather than inverse patches. Patches would
 * buy little here and are a bug farm for compound edits — deleting a node must
 * also delete every edge touching it, and undo has to bring all of it back as
 * one step.
 *
 * The viewport is deliberately NOT part of this state: panning is not an edit
 * and must never land in the undo stack.
 *
 * `CanvasAction` is the reason this file is TypeScript. Every action was a bare
 * object literal whose payload you learned by reading the case that consumed it;
 * as a discriminated union, `action.patch` is only reachable on the actions that
 * carry one, and a `case` that reads the wrong field does not compile.
 */
import {
  incidentEdgeIds,
  makeGroupNode,
  groupFitRect,
  DEFAULT_GROUP_PADDING,
} from '../lib/canvasModel'
import { nodesBounds, padRect } from '../lib/canvasGeometry'
import {
  CanvasNodeType,
  type Point,
  type Rect,
  type StoredCanvasEdge,
  type StoredCanvasNode,
  type StoredCanvasState,
} from '../types'

const HISTORY_LIMIT = 100

/**
 * Group id → the members it held when the gesture began, from `groupFitsFor`.
 * Membership is a snapshot on purpose: see the note on that function.
 */
export type FitGroups = Record<string, string[]>

/** What an action says about how it should land in history, rather than what it does. */
export interface ActionMeta {
  /** Loading a document is not an edit — it resets the stacks instead of pushing. */
  silent?: boolean
  /** Edits sharing a key collapse into the one history entry they started. */
  coalesce?: string | null
  /** Not the writer's edit (a linked document moved), so a locked document takes it too. */
  upkeep?: boolean
}

/** Every action that changes the document. */
export type CanvasDocAction = ({
  type: 'doc/replace'
  doc: StoredCanvasState
} | {
  type: 'nodes/add'
  nodes: StoredCanvasNode[]
} | {
  type: 'nodes/setPositions'
  positions: Record<string, Point>
  fitGroups?: FitGroups | null
} | {
  type: 'nodes/setRects'
  rects: Record<string, Rect>
  fitGroups?: FitGroups | null
} | {
  type: 'nodes/patch'
  id: string
  patch: Partial<StoredCanvasNode>
} | {
  type: 'nodes/patchMany'
  patches: Record<string, Partial<StoredCanvasNode>>
} | {
  type: 'nodes/reorder'
  ids: string[]
  to: 'back' | 'front'
} | {
  type: 'group/create'
  nodeIds?: string[]
  padding?: number
  label?: string
} | {
  type: 'group/ungroup'
  groupIds?: string[]
} | {
  type: 'edges/add'
  edges: StoredCanvasEdge[]
} | {
  type: 'edges/patch'
  id: string
  patch: Partial<StoredCanvasEdge>
} | {
  type: 'selection/delete'
  nodeIds?: string[]
  edgeIds?: string[]
}) & { meta?: ActionMeta }

/** Every action that moves through history without changing the document itself. */
export type CanvasHistoryAction =
  | { type: 'history/undo' }
  | { type: 'history/redo' }
  | { type: 'history/breakCoalesce' }

export type CanvasAction = CanvasDocAction | CanvasHistoryAction

/** The undo stack, the document, and the redo stack. */
export interface CanvasHistory {
  past: StoredCanvasState[]
  present: StoredCanvasState
  future: StoredCanvasState[]
  coalesceKey: string | null
}

/**
 * Grow or shrink each group in `fitGroups` around the members it held when the
 * gesture began. Runs inside the move/resize action rather than as an action of its
 * own, so a drag that resizes a group is still exactly one undo step.
 *
 * `nodes` is always a fresh copy by the time this is called, so it writes in place.
 */
function applyGroupFits(
  nodes: Record<string, StoredCanvasNode>,
  fitGroups: FitGroups | null | undefined,
): void {
  if (!fitGroups) return

  for (const [groupId, memberIds] of Object.entries(fitGroups)) {
    const group = nodes[groupId]
    if (!group || group.type !== CanvasNodeType.Group) continue

    const rect = groupFitRect(nodes, memberIds)
    // A group whose members are all gone keeps its frame rather than collapsing.
    if (!rect) continue

    nodes[groupId] = {
      ...group,
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }
  }
}

/* ---------------- document reducer ---------------- */

function docReducer(doc: StoredCanvasState, action: CanvasAction): StoredCanvasState {
  switch (action.type) {
    case 'doc/replace':
      return action.doc

    case 'nodes/add': {
      const nodes = { ...doc.nodes }
      const nodeOrder = doc.nodeOrder.slice()
      for (const node of action.nodes) {
        nodes[node.id] = node
        // Groups render behind everything, so they belong at the back of the order.
        if (node.type === CanvasNodeType.Group) nodeOrder.unshift(node.id)
        else nodeOrder.push(node.id)
      }
      return { ...doc, nodes, nodeOrder }
    }

    case 'nodes/setPositions': {
      const nodes = { ...doc.nodes }
      for (const [id, position] of Object.entries(action.positions)) {
        const node = nodes[id]
        if (!node) continue
        nodes[id] = { ...node, x: Math.round(position.x), y: Math.round(position.y) }
      }
      applyGroupFits(nodes, action.fitGroups)
      return { ...doc, nodes }
    }

    case 'nodes/setRects': {
      const nodes = { ...doc.nodes }
      for (const [id, rect] of Object.entries(action.rects)) {
        const node = nodes[id]
        if (!node) continue
        nodes[id] = {
          ...node,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        }
      }
      applyGroupFits(nodes, action.fitGroups)
      return { ...doc, nodes }
    }

    case 'nodes/patch': {
      const node = doc.nodes[action.id]
      if (!node) return doc
      return { ...doc, nodes: { ...doc.nodes, [action.id]: { ...node, ...action.patch } } }
    }

    case 'nodes/patchMany': {
      const nodes = { ...doc.nodes }
      for (const [id, patch] of Object.entries(action.patches)) {
        const node = nodes[id]
        if (!node) continue
        nodes[id] = { ...node, ...patch }
      }
      return { ...doc, nodes }
    }

    case 'nodes/reorder': {
      const moving = new Set(action.ids)
      const rest = doc.nodeOrder.filter((id) => !moving.has(id))
      const moved = doc.nodeOrder.filter((id) => moving.has(id))
      return {
        ...doc,
        nodeOrder: action.to === 'back' ? [...moved, ...rest] : [...rest, ...moved],
      }
    }

    case 'group/create': {
      // The group is the padded bounding box of the nodes it is made from. Its
      // membership is not recorded anywhere — it is those nodes purely because it
      // now encloses them (see groupMemberIds).
      const members = (action.nodeIds || [])
        .map((id) => doc.nodes[id])
        .filter((node) => node && node.type !== CanvasNodeType.Group)
      if (!members.length) return doc

      const bounds = nodesBounds(members)
      if (!bounds) return doc

      // `makeGroupNode` is still JavaScript, so its return type is inferred rather
      // than declared and `type` comes back as a plain `string`. The assertion is
      // the seam with the unconverted half, and it goes when canvasModel does.
      const group = makeGroupNode({
        ...padRect(bounds, action.padding ?? DEFAULT_GROUP_PADDING),
        label: action.label || '',
      }) as StoredCanvasNode

      return {
        ...doc,
        nodes: { ...doc.nodes, [group.id]: group },
        // Groups render behind everything, so they go at the back of the order.
        nodeOrder: [group.id, ...doc.nodeOrder],
      }
    }

    case 'group/ungroup': {
      // Removes the group frame only. Its members were never "in" it in any stored
      // sense, so they simply stay where they are — nothing to reparent.
      const doomed = new Set(
        (action.groupIds || []).filter((id) => doc.nodes[id]?.type === CanvasNodeType.Group)
      )
      if (!doomed.size) return doc

      const nodes: Record<string, StoredCanvasNode> = {}
      for (const id of doc.nodeOrder) {
        if (!doomed.has(id)) nodes[id] = doc.nodes[id]
      }

      return {
        ...doc,
        nodes,
        nodeOrder: doc.nodeOrder.filter((id) => !doomed.has(id)),
      }
    }

    case 'edges/add': {
      const edges = { ...doc.edges }
      const edgeOrder = doc.edgeOrder.slice()
      for (const edge of action.edges) {
        // An edge to a node that isn't here is unrenderable.
        if (!doc.nodes[edge.fromNode] || !doc.nodes[edge.toNode]) continue
        edges[edge.id] = edge
        edgeOrder.push(edge.id)
      }
      return { ...doc, edges, edgeOrder }
    }

    case 'edges/patch': {
      const edge = doc.edges[action.id]
      if (!edge) return doc
      return { ...doc, edges: { ...doc.edges, [action.id]: { ...edge, ...action.patch } } }
    }

    case 'selection/delete': {
      const nodeIds = action.nodeIds || []
      const doomedNodes = new Set(nodeIds)
      // Deleting a node must take its edges with it, in the same step, or undo
      // would restore the node without its connections.
      const doomedEdges = new Set<string>([
        ...(action.edgeIds || []),
        ...incidentEdgeIds(doc, nodeIds),
      ])
      if (!doomedNodes.size && !doomedEdges.size) return doc

      const nodes: Record<string, StoredCanvasNode> = {}
      for (const id of doc.nodeOrder) {
        if (!doomedNodes.has(id)) nodes[id] = doc.nodes[id]
      }
      const edges: Record<string, StoredCanvasEdge> = {}
      for (const id of doc.edgeOrder) {
        if (!doomedEdges.has(id)) edges[id] = doc.edges[id]
      }

      return {
        nodes,
        nodeOrder: doc.nodeOrder.filter((id) => !doomedNodes.has(id)),
        edges,
        edgeOrder: doc.edgeOrder.filter((id) => !doomedEdges.has(id)),
      }
    }

    default:
      return doc
  }
}

/* ---------------- history wrapper ---------------- */

export const createHistory = (doc: StoredCanvasState): CanvasHistory => ({
  past: [],
  present: doc,
  future: [],
  coalesceKey: null,
})

export function historyReducer(history: CanvasHistory, action: CanvasAction): CanvasHistory {
  if (action.type === 'history/undo') {
    if (!history.past.length) return history
    return {
      past: history.past.slice(0, -1),
      present: history.past[history.past.length - 1],
      future: [history.present, ...history.future],
      coalesceKey: null,
    }
  }

  if (action.type === 'history/redo') {
    if (!history.future.length) return history
    return {
      past: [...history.past, history.present],
      present: history.future[0],
      future: history.future.slice(1),
      coalesceKey: null,
    }
  }

  // Fired after an idle gap so a long run of coalesced edits (typing in a card,
  // dragging a color slider) breaks into more than one undo step.
  if (action.type === 'history/breakCoalesce') {
    return history.coalesceKey ? { ...history, coalesceKey: null } : history
  }

  const next = docReducer(history.present, action)
  if (next === history.present) return history

  const meta = action.meta || {}

  // Loading a document is not an edit.
  if (meta.silent) {
    return { past: [], present: next, future: [], coalesceKey: null }
  }

  // Successive edits sharing a coalesce key (dragging a color slider, typing in a
  // card) collapse into the single history entry they started.
  if (meta.coalesce && meta.coalesce === history.coalesceKey && history.past.length) {
    return { ...history, present: next, future: [] }
  }

  const past = [...history.past, history.present]
  if (past.length > HISTORY_LIMIT) past.shift()

  return {
    past,
    present: next,
    future: [],
    coalesceKey: meta.coalesce || null,
  }
}

export const canUndo = (history: CanvasHistory): boolean => history.past.length > 0
export const canRedo = (history: CanvasHistory): boolean => history.future.length > 0
