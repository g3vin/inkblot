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
