/**
 * journeys.js — every map's journeys, as the timeline shows them, and moving a leg.
 *
 * A timeline view draws each traveller of each map as a lane of its own: stays and
 * legs, read off the same schedule the map draws (map/timeline.js). Dragging a leg
 * there moves its `departDay` in its map, and an event linked to a leg (`mapLeg`) moves
 * with it, either way round.
 *
 * A map open in a pane owns its document — its next autosave would write the old leg
 * back — so a leg edit is offered to it first, as a `map:set-leg` event on window that
 * the open map claims (`detail.claimed`). Only a map no pane holds is written here.
 */
import { listProjectTree, loadDocument, writeDocumentRawIf } from '../FileSystem'
import { getDocDisplayName, isMapDoc } from '../docKind'
import { isMapPayload, normalizeMap, pinLabel, serializeMap } from '../map/mapModel'
import { createSpace } from '../map/mapSpace'
import { buildSchedules } from '../map/timeline'

export const MAP_SET_LEG_EVENT = 'map:set-leg'

const mapPaths = (node, out = []) => {
  if (!node) return out
  if (node.type === 'file') {
    if (isMapDoc(node.path)) out.push(node.path)
    return out
  }
  for (const child of node.children || []) mapPaths(child, out)
  return out
}

/**
 * One map's journeys: `[{ key, mapPath, mapName, travelerId, name, color, doc,
 * intervals: [{ kind, from, to, legId, label }] }]`. The last stay, which runs to
 * Infinity on the map, is cut at the traveller's last movement plus a day.
 */
export function mapJourneys(map, mapPath) {
  const space = createSpace(map)
  const pins = new Map(map.pins.map((pin) => [pin.id, pin]))
  const placeName = (id) => (pins.has(id) ? pinLabel(pins.get(id)) || 'a place' : 'somewhere')
  return buildSchedules(map, space).map((schedule, index) => {
    const traveler = map.travelers[index]
    const finite = schedule.intervals.filter((interval) => Number.isFinite(interval.to))
    const lastEnd = finite.length ? finite[finite.length - 1].to : schedule.start
    const intervals = schedule.intervals.map((interval) => {
      const to = Number.isFinite(interval.to) ? interval.to : Math.max(interval.from + 1, lastEnd + 1)
      if (interval.kind === 'stay') return { kind: 'stay', from: interval.from, to, legId: null, label: `At ${placeName(interval.pin)}` }
      const leg = traveler.legs.find((item) => item.id === interval.legId)
      return {
        kind: 'travel',
        from: interval.from,
        to,
        legId: interval.legId,
        label: `${placeName(leg?.from)} → ${placeName(leg?.to)}`,
      }
    })
    return {
      key: `${mapPath}|${traveler.id}`,
      mapPath,
      mapName: getDocDisplayName(mapPath),
      travelerId: traveler.id,
      name: traveler.name || getDocDisplayName(traveler.doc || '') || 'Traveller',
      color: traveler.color || null,
      doc: traveler.doc || null,
      intervals,
    }
  })
}

/**
 * Every map's journeys and places: `{ journeys, places }`, a place being
 * `{ map, pin, name, mapName }` — what an event's place can be.
 */
export async function loadProjectMaps(projectName) {
  const journeys = []
  const places = []
  if (!projectName) return { journeys, places }
  try {
    for (const path of mapPaths(await listProjectTree(projectName))) {
      const raw = await loadDocument(projectName, path)
      if (!raw || !isMapPayload(raw)) continue
      const map = normalizeMap(raw)
      journeys.push(...mapJourneys(map, path))
      for (const pin of map.pins) places.push({ map: path, pin: pin.id, name: pinLabel(pin) || 'Place', mapName: getDocDisplayName(path) })
    }
  } catch (error) {
    console.warn('[journeys] could not read the maps:', error)
  }
  return { journeys, places }
}

/** A leg's `departDay` (or null when it follows the previous leg), read from disk. */
export async function readLegDepart(projectName, mapPath, travelerId, legId) {
  const raw = await loadDocument(projectName, mapPath)
  if (!raw || !isMapPayload(raw)) return undefined
  const leg = normalizeMap(raw).travelers.find((item) => item.id === travelerId)?.legs.find((item) => item.id === legId)
  return leg ? leg.departDay ?? null : undefined
}

/**
 * Set a leg's `departDay` (null: leave when the previous leg arrives). An open map
 * takes the edit itself; otherwise the file is rewritten. Resolves to whether the leg
 * was found.
 */
export async function setLegDepart(projectName, mapPath, travelerId, legId, departDay) {
  const detail = { projectName, docPath: mapPath, travelerId, legId, departDay, claimed: false }
  window.dispatchEvent(new CustomEvent(MAP_SET_LEG_EVENT, { detail }))
  if (detail.claimed) return true
  const raw = await loadDocument(projectName, mapPath)
  if (!raw || !isMapPayload(raw)) return false
  const map = normalizeMap(raw)
  const traveler = map.travelers.find((item) => item.id === travelerId)
  if (!traveler?.legs.some((leg) => leg.id === legId)) return false
  const next = {
    ...map,
    travelers: map.travelers.map((item) => (item.id !== travelerId ? item : {
      ...item,
      legs: item.legs.map((leg) => (leg.id === legId ? { ...leg, departDay } : leg)),
    })),
  }
  return writeDocumentRawIf(projectName, mapPath, serializeMap(next, map.viewport), isMapPayload)
}
