/**
 * mapRender.js — the arithmetic behind what MapLayers draws: stored lines and rings
 * as SVG paths, which way text should read, which Earth detail to load, and how a
 * traveller is named and coloured. Kept apart from the components so the editor, the
 * export and the tests can share it.
 */
import { geoArea } from 'd3-geo'
import { getDocDisplayName } from '../lib/docKind'
import { pathData } from '../lib/map/mapGeometry'
import { measuredLine } from '../lib/map/mapSpace'
import { TRAVELER_COLORS } from '../lib/map/mapColors'

/** A polyline in stored coordinates → an SVG path in world coordinates. */
export function linePath(projector, space, points) {
  if (points.length < 2) return ''
  if (projector.kind === 'earth') {
    // Densify along great circles, then let d3 cut at the antimeridian and the globe's edge.
    const dense = measuredLine(space, points).points
    return projector.path({ type: 'LineString', coordinates: dense }) || ''
  }
  return pathData(points.map((point) => projector.toWorld(point)).filter(Boolean))
}

/** A region's rings → an SVG path (even-odd, so holes are holes). */
export function ringsPath(projector, rings) {
  if (projector.kind === 'earth') {
    const closed = rings.map((ring) => [...ring, ring[0]])
    let polygon = { type: 'Polygon', coordinates: closed }
    // d3 reads winding on the sphere: a ring wound the "wrong" way encloses the rest
    // of the world. Whichever way it was drawn, take the smaller side.
    if (geoArea(polygon) > 2 * Math.PI) polygon = { type: 'Polygon', coordinates: closed.map((ring) => [...ring].reverse()) }
    return projector.path(polygon) || ''
  }
  return rings.map((ring) => pathData(ring.map((point) => projector.toWorld(point)).filter(Boolean), true)).join('')
}

/** Text on a path reads left to right: flip a path that runs the other way. */
export const labelNeedsFlip = (worldPoints) =>
  worldPoints.length >= 2 && worldPoints[worldPoints.length - 1][0] < worldPoints[0][0]

/** Pick the Earth's detail for a zoom: coarse for the world, finer once zoomed in. */
export const earthLevelFor = (earth, zoom) =>
  earth?.detail === '110m' || earth?.detail === '50m' ? earth.detail : zoom >= 2.5 ? '50m' : '110m'

export const travelerColor = (traveler, index) => traveler.color || TRAVELER_COLORS[index % TRAVELER_COLORS.length]

export const travelerName = (traveler) =>
  traveler.name || (traveler.doc ? getDocDisplayName(traveler.doc) : 'Traveller')

export const initials = (name) =>
  String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0].toUpperCase()).join('')
