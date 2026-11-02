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
import { canRedo, canUndo, createHistory, withHistory } from '../lib/undoHistory'
import type { ActionMeta } from '../lib/undoHistory'
import { normalizeMap } from '../lib/map/mapModel'
import type { MapCollection, StoredMap } from '../types'

/** The sections of a map that are one object rather than a list. */
export type MapSection = 'scale' | 'background' | 'earth' | 'system' | 'surface' | 'galaxy' | 'universe' | 'model' | 'style' | 'timeline'

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

/** One edit to the document, without history. */
function docReducer(map: StoredMap, action: MapDocAction): StoredMap {
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

export { canRedo, canUndo, createHistory }
export const historyReducer = withHistory(docReducer)
