/**
 * mapOptions.js — the fixed lists the map's controls offer (tools, marker icons,
 * compass styles) and the small helpers the panels share. Kept out of the component
 * files so each of those exports only components, as fast refresh needs.
 */
import { getDocDisplayName } from '../lib/docKind'
import { formatDay } from '../lib/map/calendar'
import { newId } from '../lib/map/mapModel'
import { travelerName } from './mapRender'

export const MAP_TOOLS = [
  { id: 'select', icon: 'cursor', label: 'Select and move', key: 'V' },
  { id: 'pin', icon: 'map-pin', label: 'Place', key: 'P' },
  { id: 'route', icon: 'map-route', label: 'Route', key: 'R' },
  { id: 'region', icon: 'map-area', label: 'Region', key: 'G' },
  { id: 'label', icon: 'label', label: 'Label', key: 'T' },
  { id: 'ruler', icon: 'ruler', label: 'Measure distance', key: 'M' },
  { id: 'area', icon: 'measure-area', label: 'Measure area', key: 'A' },
  { id: 'calibrate', icon: 'calibrate', label: 'Set scale', key: null },
]

/** The zoom as the toolbar writes it: 250%, 12×. */
export const formatZoom = (zoom) => (zoom >= 10 ? `${Math.round(zoom)}×` : zoom >= 1 ? `${Math.round(zoom * 100)}%` : `${Math.round(zoom * 1000) / 10}%`)

/** What the hint strip says while a tool is in hand (and once drawing has begun). */
export const TOOL_HINTS = {
  pin: 'Click to place. Drag a document from the file tree to place it.',
  route: 'Click to add stops — click a place to route through it.',
  'route-drawing': 'Keep clicking. Double-click or Enter to finish, Backspace to undo a stop, Esc to cancel.',
  region: 'Click around the edge of the region.',
  'region-drawing': 'Double-click or Enter to close the shape. Backspace removes the last corner.',
  label: 'Click where the label goes.',
  ruler: 'Click to measure. Double-click to finish.',
  'ruler-drawing': 'Keep clicking to measure a path. Double-click to finish; click again to start over.',
  area: 'Click around an area to measure it.',
  'area-drawing': 'Double-click to finish.',
  calibrate: 'Click the two ends of a distance you know — a scale bar, two towns.',
  'calibrate-drawing': 'Now click the other end.',
}

/** Pin icons, in the order the inspector offers them. */
export const PIN_ICONS = [
  { id: 'pin', label: 'Pin' },
  { id: 'city', label: 'City' },
  { id: 'town', label: 'Town' },
  { id: 'castle', label: 'Castle' },
  { id: 'port', label: 'Port' },
  { id: 'temple', label: 'Temple' },
  { id: 'tower', label: 'Tower' },
  { id: 'mountain', label: 'Peak' },
  { id: 'cave', label: 'Cave' },
  { id: 'ruin', label: 'Ruin' },
  { id: 'camp', label: 'Camp' },
  { id: 'battle', label: 'Battle' },
  { id: 'star', label: 'Landmark' },
  { id: 'skull', label: 'Danger' },
]

/** Compass rose styles the style panel offers. */
export const COMPASS_STYLES = [
  { id: 'rose8', label: 'Eight-point rose' },
  { id: 'rose4', label: 'Four-point star' },
  { id: 'simple', label: 'North arrow' },
]

/** The unit distances on this map are shown in; a star system picks per figure. */
export const unitFor = (map) => (map.mapKind === 'system' ? 'auto' : map.scale.displayUnit || 'km')

/** A label that runs along `route`, carrying its name. */
export const newRouteLabel = (route) => ({
  id: newId(), text: route.name || 'Road', at: null, route: route.id, path: null, startOffset: 0.5, size: 14, rotation: 0, font: 'serif', minZoom: 0, maxZoom: null,
})

const CONFLICT_TEXT = {
  overlap: 'sets off before arriving from the previous leg',
  discontinuity: 'starts a leg somewhere they are not',
  impassable: 'crosses terrain their transport cannot',
  beforeStart: 'sets off before their journey begins',
  twoPlaces: 'is in two places at once',
}

/** A conflict as a sentence: who, what, and when in the story's calendar. */
export const describeConflict = (conflict, map, calendar) => {
  const traveler = map.travelers.find((candidate) => candidate.id === (conflict.travelerId || conflict.travelers?.[0]))
  const who = conflict.doc ? getDocDisplayName(conflict.doc) : traveler ? travelerName(traveler) : 'Someone'
  const when = Number.isFinite(conflict.from) ? ` on ${formatDay(calendar, conflict.from)}` : ''
  return `${who} ${CONFLICT_TEXT[conflict.kind] || conflict.kind}${when}.`
}
