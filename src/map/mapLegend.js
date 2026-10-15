/**
 * mapLegend.js — what the map's key says: the kinds of place on it, its terrains,
 * its routes and its travellers, read from what is actually there (and shown on the
 * day the map is at), so the key never lists what the map does not show.
 *
 * Pure: MapChrome draws the entries on screen, mapExport.js into the picture.
 */
import { PIN_ICONS } from './mapOptions'
import { travelerColor, travelerName } from './mapRender'
import { hiddenLayers, isItemShown } from '../lib/map/mapVisibility'

const ICON_LABELS = new Map(PIN_ICONS.map((icon) => [icon.id, icon.label]))
/** Routes listed by name up to this many; past it, gathered by how they are drawn. */
const NAMED_ROUTES = 4
const DASH_LABELS = { solid: 'Line', dashed: 'Dashed line', dotted: 'Dotted line', inked: 'Inked line', rough: 'Rough line' }

const routeName = (route) => route.name || 'Route'

/**
 * The key's rows, in order: places by marker, terrains, routes, travellers. Each is
 * `{ kind: 'pin' | 'region' | 'route' | 'traveler', label, … }` with what its swatch
 * needs (an icon and colour, a fill, a line).
 */
export function legendEntries(whole, day = 0) {
  const entries = []
  const hidden = hiddenLayers(whole)
  const shown = (item) => isItemShown(whole, item, day, hidden)
  const map = { ...whole, pins: whole.pins.filter(shown), regions: whole.regions.filter(shown), routes: whole.routes.filter(shown) }

  const icons = new Map()
  for (const pin of map.pins) {
    if (pin.galaxy) continue
    if (!icons.has(pin.icon)) icons.set(pin.icon, { kind: 'pin', icon: pin.icon, color: pin.color, label: pin.icon === 'pin' ? 'Place' : ICON_LABELS.get(pin.icon) || 'Place' })
  }
  entries.push(...icons.values())

  const terrains = new Map(map.terrains.map((terrain) => [terrain.id, terrain]))
  const shownTerrains = new Map()
  for (const region of map.regions) {
    const terrain = region.terrain ? terrains.get(region.terrain) : null
    const key = terrain ? `t:${terrain.id}` : `f:${region.fill || ''}`
    if (shownTerrains.has(key)) continue
    // A region with no terrain is named for itself: "The Marches".
    shownTerrains.set(key, { kind: 'region', fill: region.fill || terrain?.fill || null, hatch: region.hatch !== 'none' ? region.hatch : terrain?.hatch || 'none', label: terrain?.name || region.name || 'Region' })
  }
  entries.push(...shownTerrains.values())

  if (map.routes.length <= NAMED_ROUTES) {
    for (const route of map.routes) entries.push({ kind: 'route', stroke: route.style.stroke, dash: route.style.dash, width: route.style.width, label: routeName(route) })
  } else {
    const styles = new Map()
    for (const route of map.routes) {
      const key = `${route.style.dash}|${route.style.stroke || ''}`
      const entry = styles.get(key) || { kind: 'route', stroke: route.style.stroke, dash: route.style.dash, width: route.style.width, names: [] }
      entry.names.push(routeName(route))
      styles.set(key, entry)
    }
    for (const { names, ...entry } of styles.values()) {
      const label = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]}, ${names[1]} and ${names.length - 2} more`
      entries.push({ ...entry, label: label || DASH_LABELS[entry.dash] })
    }
  }

  map.travelers.forEach((traveler, index) => entries.push({ kind: 'traveler', color: travelerColor(traveler, index), label: travelerName(traveler) }))
  return entries
}
