/**
 * mapVisibility.js — whether an item is on the map right now.
 *
 * Two things can take an item off: its layer is hidden (`map.layers`), or the story
 * is not at a day it is there (`from` – `until`: a city founded in year 300, a border
 * that moved in 1871). Every renderer asks here — the editor, the globe, the 3D
 * views, a thumbnail, an export — so a hidden thing is hidden everywhere, and
 * nothing is drawn for it at all.
 */

/** The day an item appears and goes, with any timeline event it follows already applied. */
export const itemSpan = (item) => ({ from: Number.isFinite(item?.from) ? item.from : null, until: Number.isFinite(item?.until) ? item.until : null })

/** Is the story at a day this item is there? `until` is the first day it is gone. */
export function isAtDay(item, day) {
  const { from, until } = itemSpan(item)
  if (from !== null && day < from) return false
  if (until !== null && day >= until) return false
  return true
}

/** Ids of the layers that are hidden. */
export function hiddenLayers(map) {
  const hidden = new Set()
  for (const layer of Array.isArray(map?.layers) ? map.layers : []) if (layer.visible === false) hidden.add(layer.id)
  return hidden
}

/** Ids of the layers that are locked: what is on them cannot be selected or moved. */
export function lockedLayers(map) {
  const locked = new Set()
  for (const layer of Array.isArray(map?.layers) ? map.layers : []) if (layer.locked) locked.add(layer.id)
  return locked
}

/** Is `item` drawn on `map` on `day`? */
export function isItemShown(map, item, day = 0, hidden = hiddenLayers(map)) {
  if (item?.layer && hidden.has(item.layer)) return false
  return isAtDay(item, day)
}

const SHOWN_COLLECTIONS = ['pins', 'routes', 'regions', 'labels']
const COLLECTION_OF = { pin: 'pins', route: 'routes', region: 'regions', label: 'labels' }

/**
 * What is off the map on `day`, as one string: equal strings, equal maps. Cheap
 * enough to ask every frame of playback, so the layers redraw only when something
 * actually comes or goes.
 */
export function hiddenKey(map, day = 0) {
  const hidden = hiddenLayers(map)
  let key = ''
  for (const collection of SHOWN_COLLECTIONS) {
    for (const item of map?.[collection] || []) if (!isItemShown(map, item, day, hidden)) key += `${item.id},`
  }
  return key
}

/** The ids a `hiddenKey` names. */
export const hiddenIds = (key) => new Set(key ? key.split(',').filter(Boolean) : [])

/**
 * `map` without the routes, regions and labels `hiddenKey` names: the same map
 * when nothing is hidden. Pins stay, since routes and travellers find their stops
 * through them; whoever draws pins skips the hidden ones (`hiddenIds`).
 */
export function withoutHidden(map, key) {
  if (!key) return map
  const gone = hiddenIds(key)
  const next = { ...map }
  for (const collection of ['routes', 'regions', 'labels']) next[collection] = (map[collection] || []).filter((item) => !gone.has(item.id))
  return next
}

/** Is the item of `kind` and `id` on a locked layer (so it cannot be picked up)? */
export function isItemLocked(map, kind, id) {
  const collection = COLLECTION_OF[kind]
  if (!collection) return false
  const item = (map?.[collection] || []).find((candidate) => candidate.id === id)
  return Boolean(item?.layer && lockedLayers(map).has(item.layer))
}
