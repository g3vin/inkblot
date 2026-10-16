/**
 * mapFind.js — finding something on the open map by name, to fly to it (⌘F).
 *
 * Searches what the map shows on `day`: places, routes, regions, labels, a system's
 * bodies and the travellers. Names that start with the query come first, then names
 * with a word that does, then the rest that contain it.
 *
 * (Project search, mapSearch.js, finds text across every map; this finds a thing on
 * this one and says where it is.)
 */
import { pinLabel } from './mapModel'
import { resolvePin, routeCoords } from './mapSpace'
import { hiddenLayers, isItemShown } from './mapVisibility'
import { buildSchedule, travelerPositionAt } from './timeline'

const KIND_NAMES = { pin: 'Place', route: 'Route', region: 'Region', label: 'Label', body: 'Body', traveler: 'Traveller' }
const BODY_NAMES = { star: 'Star', planet: 'Planet', dwarf: 'Dwarf planet', moon: 'Moon', belt: 'Belt', station: 'Station', barycenter: 'Barycentre' }

const middle = (points) => {
  const usable = points.filter(Boolean)
  if (!usable.length) return null
  const sum = usable.reduce((acc, point) => acc.map((value, index) => value + (point[index] || 0)), [0, 0, 0])
  return sum.map((value) => value / usable.length).slice(0, usable[0].length)
}

/**
 * Where `kind`/`id` is on `day`, in the map's own coordinates: a place where it
 * resolves, a route's middle, a region's middle, a label's anchor, a body's position
 * or a traveller's whereabouts. Null when it is nowhere (or missing).
 */
export function itemPoint(map, space, kind, id, day = 0) {
  if (kind === 'pin') {
    const pin = map.pins.find((candidate) => candidate.id === id)
    return pin ? resolvePin(map, space, pin, day) : null
  }
  if (kind === 'route') {
    const route = map.routes.find((candidate) => candidate.id === id)
    return route ? middle(routeCoords(map, space, route, day)) : null
  }
  if (kind === 'region') {
    const region = map.regions.find((candidate) => candidate.id === id)
    return region ? middle(region.rings[0] || []) : null
  }
  if (kind === 'label') {
    const label = map.labels.find((candidate) => candidate.id === id)
    return label ? label.at || label.path?.[0] || null : null
  }
  if (kind === 'body') return map.mapKind === 'system' && space.positionsAt ? space.positionsAt(day).get(id) || null : null
  if (kind === 'traveler') {
    const traveler = map.travelers.find((candidate) => candidate.id === id)
    return traveler ? travelerPositionAt(map, space, buildSchedule(map, space, traveler), day)?.point || null : null
  }
  return null
}

/** How well `name` answers `query` (lower case): 0 best, null not at all. */
function rank(name, query) {
  const text = String(name || '').toLowerCase()
  if (!text || !query) return null
  if (text.startsWith(query)) return 0
  if (text.split(/[\s\-–—'’(]+/).some((word) => word.startsWith(query))) return 1
  return text.includes(query) ? 2 : null
}

/**
 * What on `map` answers `query`: `[{ kind, id, name, detail, at }]`, best first,
 * at most `limit`. `at` is a point in the map's own coordinates to fly to.
 */
export function findOnMap(map, space, query, { day = 0, limit = 8, docName } = {}) {
  const needle = String(query || '').trim().toLowerCase()
  if (!needle) return []
  const hidden = hiddenLayers(map)
  const shown = (item) => isItemShown(map, item, day, hidden)
  const found = []
  const consider = (kind, id, name, at, detail = KIND_NAMES[kind]) => {
    const score = rank(name, needle)
    if (score !== null && at) found.push({ kind, id, name, detail, at, score })
  }

  for (const pin of map.pins.filter(shown)) consider('pin', pin.id, pinLabel(pin, docName), resolvePin(map, space, pin, day))
  for (const route of map.routes.filter(shown)) if (route.name) consider('route', route.id, route.name, middle(routeCoords(map, space, route, day)))
  for (const region of map.regions.filter(shown)) if (region.name) consider('region', region.id, region.name, middle(region.rings[0] || []))
  for (const label of map.labels.filter(shown)) consider('label', label.id, label.text, label.at)
  if (map.mapKind === 'system' && space.positionsAt) {
    const positions = space.positionsAt(day)
    for (const body of map.system.bodies) consider('body', body.id, body.name, positions.get(body.id), BODY_NAMES[body.kind] || 'Body')
  }
  for (const traveler of map.travelers) {
    const name = traveler.name || (traveler.doc && docName ? docName(traveler.doc) : null)
    if (rank(name, needle) === null) continue
    const where = travelerPositionAt(map, space, buildSchedule(map, space, traveler), day)
    consider('traveler', traveler.id, name, where?.point || null)
  }

  return found
    .sort((a, b) => a.score - b.score || a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ kind, id, name, detail, at }) => ({ kind, id, name, detail, at }))
}
