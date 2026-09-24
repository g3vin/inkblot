/**
 * mapReducer.ts — map document state, with undo/redo layered on top.
 *
 * The same design as canvasReducer.ts: never mutate, so an untouched item keeps its
 * identity (and a whole-document snapshot is cheap), and history is snapshots rather
 * than inverse patches. The viewport and the timeline's *playing* state are not in
 * here — looking around is not an edit.
 *
 * Removing is the one compound edit. Deleting a pin must also take it out of every
 * route that stops at it, every label that runs along a route that no longer has two
 * stops, every leg that starts or ends there. `normalizeMap` already knows every one
 * of those rules — it is what a file with dangling references goes through on load —
 * so a removal filters the collection and re-normalizes, and undo brings all of it
 * back as one step.
 */
import { normalizeMap } from '../lib/map/mapModel'
import type { MapCollection, StoredMap } from '../types'

const HISTORY_LIMIT = 100

/** The sections of a map that are one object rather than a list. */
export type MapSection = 'scale' | 'background' | 'earth' | 'system' | 'style' | 'timeline'

export interface ActionMeta {
  /** Loading a document is not an edit — it resets the stacks instead of pushing. */
  silent?: boolean
  /** Edits sharing a key collapse into the one history entry they started. */
  coalesce?: string | null
}

type Item = { id: string } & Record<string, unknown>

export type MapDocAction = ({
  type: 'doc/replace'
  map: StoredMap
} | {
  /** Shallow-merge top-level keys (`mapKind`, or a whole section). */
  type: 'map/patch'
  patch: Partial<StoredMap> & Record<string, unknown>
} | {
  type: 'section/patch'
  section: MapSection
  patch: Record<string, unknown>
} | {
  type: 'items/add'
  collection: MapCollection
  items: Item[]
} | {
  /** id → the keys to change on that item. */
  type: 'items/patch'
  collection: MapCollection
  patches: Record<string, Record<string, unknown>>
} | {
  type: 'items/remove'
  collection: MapCollection
  ids: string[]
}) & { meta?: ActionMeta }

export type MapHistoryAction =
  | { type: 'history/undo'; meta?: ActionMeta }
  | { type: 'history/redo'; meta?: ActionMeta }
  | { type: 'history/breakCoalesce'; meta?: ActionMeta }

export type MapAction = MapDocAction | MapHistoryAction

export interface MapHistory {
  past: StoredMap[]
  present: StoredMap
  future: StoredMap[]
  coalesceKey: string | null
}

const listOf = (map: StoredMap, collection: MapCollection): Item[] =>
  (Array.isArray(map[collection]) ? map[collection] : []) as unknown as Item[]

const withList = (map: StoredMap, collection: MapCollection, list: Item[]): StoredMap =>
  ({ ...map, [collection]: list }) as StoredMap

/**
 * Ids are kept, so normalizing an already-normal map never draws a new one; the
 * generator is only here to satisfy the signature, and would be a bug if called.
 */
const renormalize = (map: StoredMap): StoredMap =>
  normalizeMap(map, () => {
    throw new Error('mapReducer: an item lost its id')
  }) as StoredMap

export function docReducer(map: StoredMap, action: MapDocAction): StoredMap {
  switch (action.type) {
    case 'doc/replace':
      return action.map

    case 'map/patch':
      return { ...map, ...action.patch } as StoredMap

    case 'section/patch': {
      const current = (map[action.section] || {}) as unknown as Record<string, unknown>
      return { ...map, [action.section]: { ...current, ...action.patch } } as StoredMap
    }

    case 'items/add': {
      if (!action.items.length) return map
      return withList(map, action.collection, [...listOf(map, action.collection), ...action.items])
    }

    case 'items/patch': {
      let changed = false
      const list = listOf(map, action.collection).map((item) => {
        const patch = action.patches[item.id]
        if (!patch) return item
        changed = true
        return { ...item, ...patch }
      })
      return changed ? withList(map, action.collection, list) : map
    }

    case 'items/remove': {
      const doomed = new Set(action.ids)
      const list = listOf(map, action.collection)
      const kept = list.filter((item) => !doomed.has(item.id))
      if (kept.length === list.length) return map
      return renormalize(withList(map, action.collection, kept))
    }

    default:
      return map
  }
}

/* ---------------- history wrapper ---------------- */

export const createHistory = (map: StoredMap): MapHistory => ({
  past: [],
  present: map,
  future: [],
  coalesceKey: null,
})

export function historyReducer(history: MapHistory, action: MapAction): MapHistory {
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

  if (action.type === 'history/breakCoalesce') {
    return history.coalesceKey ? { ...history, coalesceKey: null } : history
  }

  const next = docReducer(history.present, action)
  if (next === history.present) return history

  const meta = action.meta || {}
  if (meta.silent) return { past: [], present: next, future: [], coalesceKey: null }

  if (meta.coalesce && meta.coalesce === history.coalesceKey && history.past.length) {
    return { ...history, present: next, future: [] }
  }

  const past = [...history.past, history.present]
  if (past.length > HISTORY_LIMIT) past.shift()
  return { past, present: next, future: [], coalesceKey: meta.coalesce || null }
}

export const canUndo = (history: MapHistory): boolean => history.past.length > 0
export const canRedo = (history: MapHistory): boolean => history.future.length > 0
