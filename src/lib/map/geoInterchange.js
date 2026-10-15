/**
 * geoInterchange.js — places, routes and regions in and out as GeoJSON and KML, the
 * formats every GIS tool, Google Earth and most mapping sites read and write.
 *
 * Out: pins and labels become points, routes lines, regions polygons, with their
 * names, colours and days as properties. On the Earth and on a planet the
 * coordinates are longitude and latitude, as both formats expect; on a drawn map
 * they are the sheet's own (y down), marked `inkblot.units: 'sheet'`.
 *
 * In: points become places, lines routes, polygons regions (holes kept). On the
 * Earth or a planet they land where they say; on a drawn map the whole import is
 * fitted into the middle of the sheet, north up.
 */
import { BLANK_SHEET, newId, normalizeMap } from './mapModel'
import { routeCoords } from './mapSpace'

/** Maps whose points are longitude and latitude. */
export const LONLAT_KINDS = new Set(['earth', 'planet'])
/** Maps an import can land on. */
export const IMPORT_KINDS = new Set(['earth', 'planet', 'blank', 'image'])

const closeRing = (ring) => {
  const first = ring[0]
  const last = ring[ring.length - 1]
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first]
}
const openRing = (ring) => {
  if (ring.length < 2) return ring
  const first = ring[0]
  const last = ring[ring.length - 1]
  return first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring
}
const xy = (point) => [point[0], point[1]]
const clean = (properties) => Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== null && value !== undefined && value !== ''))

/* ---------------- out ---------------- */

/** The map's places, routes, regions and labels as a GeoJSON FeatureCollection. */
export function mapToGeoJSON(map, space, { day = 0 } = {}) {
  const features = []
  const span = (item) => ({ from: item.from, until: item.until })
  for (const pin of map.pins) {
    if (!pin.at) continue
    features.push({ type: 'Feature', id: pin.id, geometry: { type: 'Point', coordinates: xy(pin.at) }, properties: clean({ kind: 'place', name: pin.name, icon: pin.icon !== 'pin' ? pin.icon : null, color: pin.color, doc: pin.doc, ...span(pin) }) })
  }
  for (const route of map.routes) {
    const coords = routeCoords(map, space, route, day).map(xy)
    if (coords.length < 2) continue
    features.push({ type: 'Feature', id: route.id, geometry: { type: 'LineString', coordinates: coords }, properties: clean({ kind: 'route', name: route.name, color: route.style.stroke, dash: route.style.dash !== 'solid' ? route.style.dash : null, ...span(route) }) })
  }
  for (const region of map.regions) {
    features.push({ type: 'Feature', id: region.id, geometry: { type: 'Polygon', coordinates: region.rings.map((ring) => closeRing(ring.map(xy))) }, properties: clean({ kind: 'region', name: region.name, terrain: region.terrain, color: region.fill, ...span(region) }) })
  }
  for (const label of map.labels) {
    if (!label.at) continue
    features.push({ type: 'Feature', id: label.id, geometry: { type: 'Point', coordinates: xy(label.at) }, properties: clean({ kind: 'label', name: label.text, ...span(label) }) })
  }
  return { type: 'FeatureCollection', inkblot: { mapKind: map.mapKind, units: LONLAT_KINDS.has(map.mapKind) ? 'lonlat' : 'sheet' }, features }
}

const escapeXml = (text) => String(text).replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char])
const kmlCoords = (points) => points.map((point) => `${point[0]},${point[1]}`).join(' ')

/** The same, as a KML document (Google Earth and friends). */
export function mapToKml(map, space, { name = 'Map', day = 0 } = {}) {
  const { features } = mapToGeoJSON(map, space, { day })
  const placemarks = features.map((feature) => {
    const title = feature.properties.name ? `<name>${escapeXml(feature.properties.name)}</name>` : ''
    const geometry = feature.geometry
    let shape
    if (geometry.type === 'Point') shape = `<Point><coordinates>${kmlCoords([geometry.coordinates])}</coordinates></Point>`
    else if (geometry.type === 'LineString') shape = `<LineString><tessellate>1</tessellate><coordinates>${kmlCoords(geometry.coordinates)}</coordinates></LineString>`
    else {
      const [outer, ...holes] = geometry.coordinates
      shape = `<Polygon><outerBoundaryIs><LinearRing><coordinates>${kmlCoords(outer)}</coordinates></LinearRing></outerBoundaryIs>${holes.map((hole) => `<innerBoundaryIs><LinearRing><coordinates>${kmlCoords(hole)}</coordinates></LinearRing></innerBoundaryIs>`).join('')}</Polygon>`
    }
    return `<Placemark>${title}${shape}</Placemark>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${escapeXml(name)}</name>${placemarks.join('')}</Document></kml>\n`
}

/* ---------------- in ---------------- */

const parseKmlCoords = (text) =>
  String(text || '').trim().split(/\s+/).map((tuple) => tuple.split(',').map(Number)).filter((point) => point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])).map(xy)

/** KML text → GeoJSON features (points, lines and polygons; folders and multi-geometries flattened). */
export function kmlToGeoJSON(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('That file is not readable KML.')
  const child = (element, tag) => [...element.children].find((node) => node.localName === tag)
  const all = (element, tag) => [...element.getElementsByTagNameNS('*', tag)]
  const features = []
  for (const placemark of all(doc, 'Placemark')) {
    const name = child(placemark, 'name')?.textContent?.trim() || null
    const push = (geometry) => features.push({ type: 'Feature', geometry, properties: clean({ name }) })
    for (const point of all(placemark, 'Point')) {
      const [at] = parseKmlCoords(child(point, 'coordinates')?.textContent)
      if (at) push({ type: 'Point', coordinates: at })
    }
    for (const line of all(placemark, 'LineString')) {
      const coords = parseKmlCoords(child(line, 'coordinates')?.textContent)
      if (coords.length >= 2) push({ type: 'LineString', coordinates: coords })
    }
    for (const polygon of all(placemark, 'Polygon')) {
      const ring = (boundary) => parseKmlCoords(all(boundary, 'coordinates')[0]?.textContent)
      const outer = all(polygon, 'outerBoundaryIs').map(ring)[0]
      if (!outer || outer.length < 3) continue
      push({ type: 'Polygon', coordinates: [outer, ...all(polygon, 'innerBoundaryIs').map(ring).filter((hole) => hole.length >= 3)] })
    }
  }
  return { type: 'FeatureCollection', features }
}

/** Every simple geometry in a GeoJSON object (collections and multi-geometries flattened). */
function* simpleGeometries(geometry) {
  if (!geometry) return
  switch (geometry.type) {
    case 'Point':
    case 'LineString':
    case 'Polygon':
      yield geometry
      break
    case 'MultiPoint':
      for (const coordinates of geometry.coordinates || []) yield { type: 'Point', coordinates }
      break
    case 'MultiLineString':
      for (const coordinates of geometry.coordinates || []) yield { type: 'LineString', coordinates }
      break
    case 'MultiPolygon':
      for (const coordinates of geometry.coordinates || []) yield { type: 'Polygon', coordinates }
      break
    case 'GeometryCollection':
      for (const part of geometry.geometries || []) yield* simpleGeometries(part)
      break
    default:
  }
}

const featuresOf = (json) =>
  json?.type === 'FeatureCollection' ? json.features || [] : json?.type === 'Feature' ? [json] : json?.type ? [{ type: 'Feature', geometry: json, properties: {} }] : []

const finitePoint = (point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])

/**
 * GeoJSON → `{ pins, routes, regions, labels }`, new items for `map`. On a drawn map
 * (not longitude and latitude) everything is fitted into the middle of the sheet.
 * `skipped` counts what could not be read.
 */
export function geoJSONToItems(json, map) {
  const items = { pins: [], routes: [], regions: [], labels: [] }
  let skipped = 0
  const raw = []
  for (const feature of featuresOf(json)) {
    const properties = feature?.properties || {}
    const name = typeof properties.name === 'string' && properties.name ? properties.name : typeof properties.title === 'string' ? properties.title : null
    for (const geometry of simpleGeometries(feature?.geometry)) raw.push({ geometry, properties, name })
  }

  // Where a point lands: as it is on a world, fitted to the sheet on a drawn map.
  let place = (point) => xy(point)
  if (!LONLAT_KINDS.has(map.mapKind) && json?.inkblot?.units !== 'sheet') {
    const points = raw.flatMap(({ geometry }) => (geometry.type === 'Point' ? [geometry.coordinates] : geometry.type === 'LineString' ? geometry.coordinates : (geometry.coordinates || []).flat())).filter(finitePoint)
    if (points.length) {
      const xs = points.map((point) => point[0])
      const ys = points.map((point) => point[1])
      const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
      const sheet = { width: map.background.width || BLANK_SHEET.width, height: map.background.height || BLANK_SHEET.height }
      const fit = Math.min((sheet.width * 0.6) / Math.max(maxX - minX, 1e-9), (sheet.height * 0.6) / Math.max(maxY - minY, 1e-9))
      const scale = Number.isFinite(fit) ? fit : 1
      // North up: latitude grows up the page, y grows down it.
      place = (point) => [sheet.width / 2 + (point[0] - (minX + maxX) / 2) * scale, sheet.height / 2 - (point[1] - (minY + maxY) / 2) * scale]
    }
  }

  const color = (properties) => (typeof properties.color === 'string' ? properties.color : typeof properties.stroke === 'string' ? properties.stroke : typeof properties.fill === 'string' ? properties.fill : null)
  const days = (properties) => ({ from: Number.isFinite(properties.from) ? properties.from : null, until: Number.isFinite(properties.until) ? properties.until : null })
  for (const { geometry, properties, name } of raw) {
    if (geometry.type === 'Point') {
      if (!finitePoint(geometry.coordinates)) {
        skipped += 1
        continue
      }
      const at = place(geometry.coordinates)
      if (properties.kind === 'label') items.labels.push({ id: newId(), text: name || 'Label', at, route: null, path: null, startOffset: 0.5, size: 24, rotation: 0, font: 'serif', minZoom: 0, maxZoom: null, ...days(properties) })
      else items.pins.push({ id: newId(), name, at, icon: typeof properties.icon === 'string' ? properties.icon : 'pin', color: color(properties), ...days(properties) })
    } else if (geometry.type === 'LineString') {
      const coords = (geometry.coordinates || []).filter(finitePoint).map(place)
      if (coords.length < 2) {
        skipped += 1
        continue
      }
      items.routes.push({ id: newId(), name, nodes: coords.map((at) => ({ at })), style: { stroke: color(properties), dash: typeof properties.dash === 'string' ? properties.dash : 'solid' }, ...days(properties) })
    } else {
      const rings = (geometry.coordinates || []).map((ring) => openRing((ring || []).filter(finitePoint).map(place))).filter((ring) => ring.length >= 3)
      if (!rings.length) {
        skipped += 1
        continue
      }
      items.regions.push({ id: newId(), name, rings, fill: color(properties), terrain: typeof properties.terrain === 'string' ? properties.terrain : null, ...days(properties) })
    }
  }
  // Read the way a saved map is, so every new item has all its fields.
  const read = normalizeMap({ mapKind: map.mapKind, background: map.background, ...items })
  return { pins: read.pins, routes: read.routes, regions: read.regions, labels: read.labels, skipped }
}

/** A file's text → GeoJSON, by its extension (`.kml`) or its look. */
export function readGeoFile(text, fileName = '') {
  if (/\.kml$/i.test(fileName) || /^\s*<(\?xml|kml)/i.test(text)) return kmlToGeoJSON(text)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('That file is not readable GeoJSON or KML.')
  }
}
