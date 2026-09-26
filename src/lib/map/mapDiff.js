/**
 * mapDiff.js — comparing and merging two states of a map, for version history.
 *
 * The map counterpart of `diffCanvases` / `mergeCanvases` in versionHistory.js. A map
 * is a set of collections of id'd items plus a handful of whole-map settings, so the
 * diff is item by item within each collection, and section by section for the rest:
 *
 *   added / removed   an item only one side has
 *   edited            the same item, with something other than its placement changed
 *   moved             the same item, changed only in where it sits
 *   settings          a whole-map section (style, scale, …) that differs
 *
 * The viewport is where somebody was looking, not what they made, and is never a
 * difference. The timeline IS compared — the day it was left on is saved state, and a
 * comparison that hid it would show two different files as identical.
 *
 * Mirrors `inkblot_core::map::diff`; `npm run parity` asserts the two agree.
 */

/**
 * Every collection a map holds, in the order a diff lists them. `geometry` is the
 * keys that only place an item — a change confined to them is a move, not an edit.
 * Bodies live at `system.bodies`; the rest at the top level.
 */
export const MAP_COLLECTIONS = [
  { key: 'pins', one: 'place', many: 'places', geometry: ['at', 'body'] },
  { key: 'routes', one: 'route', many: 'routes', geometry: ['nodes'] },
  { key: 'regions', one: 'region', many: 'regions', geometry: ['rings'] },
  { key: 'labels', one: 'label', many: 'labels', geometry: ['at', 'route', 'path', 'startOffset', 'rotation'] },
  { key: 'travelers', one: 'traveler', many: 'travelers', geometry: [] },
  { key: 'bodies', one: 'body', many: 'bodies', geometry: ['orbit'] },
  { key: 'terrains', one: 'terrain', many: 'terrains', geometry: [] },
  { key: 'transports', one: 'transport', many: 'transports', geometry: [] },
]

/** The whole-map sections, with what the compare view calls them. */
export const MAP_SETTINGS = [
  { key: 'mapKind', label: 'Map kind' },
  { key: 'scale', label: 'Scale' },
  { key: 'background', label: 'Background' },
  { key: 'earth', label: 'Globe' },
  { key: 'system', label: 'Star system' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'style', label: 'Style' },
]

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * Structural equality of two JSON values. Key order is not part of a value, and a
 * missing key is the same as `null` only at the top of a section (see `sectionOf`).
 */
export function sameJson(a, b) {
  if (a === b) return true
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((value, index) => sameJson(value, b[index]))
  }
  if (isObject(a)) {
    if (!isObject(b)) return false
    const keys = Object.keys(a)
    if (keys.length !== Object.keys(b).length) return false
    return keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]))
  }
  return false
}

/** An object minus some keys. */
const without = (object, keys) => {
  const out = { ...object }
  for (const key of keys) delete out[key]
  return out
}

/**
 * A collection's items: objects with a non-empty string id, first of each id kept —
 * the rule normalizeMap reads lists by, so a raw map and its normalized form agree.
 */
export function mapItems(map, key) {
  const list = key === 'bodies' ? (isObject(map?.system) ? map.system.bodies : null) : map?.[key]
  const out = []
  const seen = new Set()
  for (const item of Array.isArray(list) ? list : []) {
    if (!isObject(item) || typeof item.id !== 'string' || !item.id || seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

/** A whole-map section as compared: `null` when absent; the system without its bodies. */
const sectionOf = (map, key) => {
  const value = isObject(map) && Object.hasOwn(map, key) ? map[key] : null
  if (key === 'system' && isObject(value)) return without(value, ['bodies'])
  return value ?? null
}

/** Item-level diff of two maps (left = older, right = newer). */
export function diffMaps(left, right) {
  const diff = { added: [], removed: [], edited: [], moved: [], settings: [] }

  for (const { key: collection, geometry } of MAP_COLLECTIONS) {
    const before = mapItems(left, collection)
    const after = mapItems(right, collection)
    const beforeById = new Map(before.map((item) => [item.id, item]))
    const afterIds = new Set(after.map((item) => item.id))

    for (const item of after) {
      const old = beforeById.get(item.id)
      if (!old) {
        diff.added.push({ collection, item })
        continue
      }
      if (sameJson(old, item)) continue
      const change = { collection, before: old, after: item }
      if (sameJson(without(old, geometry), without(item, geometry))) diff.moved.push(change)
      else diff.edited.push(change)
    }
    for (const item of before) {
      if (!afterIds.has(item.id)) diff.removed.push({ collection, item })
    }
  }

  for (const { key: section } of MAP_SETTINGS) {
    const before = sectionOf(left, section)
    const after = sectionOf(right, section)
    if (!sameJson(before, after)) diff.settings.push({ section, before, after })
  }

  return diff
}

export const mapDiffIsEmpty = (diff) =>
  !diff.added.length && !diff.removed.length && !diff.edited.length && !diff.moved.length && !diff.settings.length

/**
 * One line for a history row: "+2 places · −1 route · 1 edited · 3 moved · Style".
 * Adds and removes are counted per collection; edits and moves across all of them.
 */
export function describeMapDiff(diff) {
  const parts = []
  const counted = (changes, sign) => {
    for (const { key, one, many } of MAP_COLLECTIONS) {
      const count = changes.filter((change) => change.collection === key).length
      if (count) parts.push(`${sign}${count} ${count === 1 ? one : many}`)
    }
  }
  counted(diff.added, '+')
  counted(diff.removed, '−')
  if (diff.edited.length) parts.push(`${diff.edited.length} edited`)
  if (diff.moved.length) parts.push(`${diff.moved.length} moved`)
  for (const { key, label } of MAP_SETTINGS) {
    if (diff.settings.some((change) => change.section === key)) parts.push(label)
  }
  return parts.join(' · ') || 'No changes'
}

/** The key a merge decision is filed under for one change. */
export const mapChangeKey = (type, change) =>
  type === 'setting' ? `setting:${change.section}` : `${type}:${change.collection}:${(change.item || change.after).id}`

/**
 * Merge two maps from per-change decisions. The result starts as the RIGHT side; a
 * decision of 'left' flips one change back:
 *
 *   added:<collection>:<id>    drop the item right added
 *   removed:<collection>:<id>  bring back the item right deleted, where it stood
 *   edited:<collection>:<id>   keep the older item
 *   moved:<collection>:<id>    keep the older placement
 *   setting:<section>          keep the older section
 *
 * References left dangling by a choice (a route stop on a place that was dropped) are
 * not repaired here: normalizeMap drops them when the result is loaded, the same rule
 * it applies to any file.
 */
export function mergeMaps(left, right, diff, decisions = {}) {
  const take = (key) => decisions[key] === 'left'
  const merged = isObject(right) ? { ...right } : {}

  for (const change of diff.settings) {
    if (!take(mapChangeKey('setting', change))) continue
    if (change.section === 'system') {
      // The bodies are merged as a collection of their own, below; the setting
      // decides everything about the system except them.
      const bodies = isObject(merged.system) ? merged.system.bodies : undefined
      const system = isObject(change.before) ? { ...change.before } : {}
      if (bodies !== undefined) system.bodies = bodies
      if (change.before === null && bodies === undefined) delete merged.system
      else merged.system = isObject(change.before) || bodies !== undefined ? system : change.before
    } else if (change.before === null) {
      delete merged[change.section]
    } else {
      merged[change.section] = change.before
    }
  }

  for (const { key: collection } of MAP_COLLECTIONS) {
    const inCollection = (list) => list.filter((change) => change.collection === collection)
    const added = new Set(inCollection(diff.added).map((change) => change.item.id))
    const replaced = new Map()
    for (const [type, list] of [['edited', diff.edited], ['moved', diff.moved]]) {
      for (const change of inCollection(list)) {
        if (take(mapChangeKey(type, change))) replaced.set(change.after.id, change.before)
      }
    }

    const items = []
    for (const item of mapItems(right, collection)) {
      if (added.has(item.id) && take(mapChangeKey('added', { collection, item }))) continue
      items.push(replaced.get(item.id) || item)
    }

    // A restored item goes back just above whatever it sat on top of in the older
    // map, so paint order — which region covers which — survives the round trip.
    const leftItems = mapItems(left, collection)
    for (const change of inCollection(diff.removed)) {
      if (!take(mapChangeKey('removed', change))) continue
      const index = leftItems.findIndex((item) => item.id === change.item.id)
      let at = 0
      for (let below = index - 1; below >= 0; below -= 1) {
        const found = items.findIndex((item) => item.id === leftItems[below].id)
        if (found !== -1) {
          at = found + 1
          break
        }
      }
      items.splice(at, 0, change.item)
    }

    const unchanged = sameJson(items, mapItems(right, collection))
    if (collection === 'bodies') {
      if (!unchanged) merged.system = { ...(isObject(merged.system) ? merged.system : {}), bodies: items }
    } else if (!unchanged) {
      merged[collection] = items
    }
  }

  return merged
}

/* ---------- presenting a change ---------- */

/** What a compare row calls an item: its name, or its text, or its kind. */
export function mapItemTitle(collection, item, docDisplayName = (doc) => doc.split('/').filter(Boolean).pop() || doc) {
  const spec = MAP_COLLECTIONS.find((entry) => entry.key === collection)
  const fallback = `Untitled ${spec?.one || 'item'}`
  if (!isObject(item)) return fallback
  const text = collection === 'labels' ? item.text : item.name
  if (typeof text === 'string' && text.trim()) return text.trim()
  if (typeof item.doc === 'string' && item.doc) return docDisplayName(item.doc)
  return fallback
}

/** The top-level keys two values differ in, in first-seen order. */
export function changedKeys(before, after) {
  const a = isObject(before) ? before : {}
  const b = isObject(after) ? after : {}
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
  return keys.filter((key) => key !== 'id' && !sameJson(a[key] ?? null, b[key] ?? null))
}

const round = (value) => (Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 100) / 100)

/** A short, readable rendering of one JSON value, for a compare row. */
export function briefValue(value) {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') return String(round(value))
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  if (typeof value === 'string') return value.length > 40 ? `${value.slice(0, 39)}…` : value
  if (Array.isArray(value)) {
    if (value.length === 2 && value.every((part) => typeof part === 'number')) {
      return `(${round(value[0])}, ${round(value[1])})`
    }
    return `${value.length} item${value.length === 1 ? '' : 's'}`
  }
  const keys = Object.keys(value)
  return keys.length ? `{ ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', …' : ''} }` : '{ }'
}
