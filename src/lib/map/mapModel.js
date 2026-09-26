/**
 * mapModel.js — the map document format.
 *
 * A map lives at `<projectRoot>/<path>.map.json` (tree path `Folder/Name.map`, see
 * docKind.js). Unlike a canvas, the runtime shape IS the on-disk shape: every
 * collection is an array in paint order, and each item is a plain object that keeps
 * any keys it does not model, so a round-trip never strips data a newer build (or
 * another tool) wrote.
 *
 *   { type: 'map', formatVersion, mapKind: 'blank'|'image'|'earth'|'system',
 *     scale, background, earth, system,
 *     pins, routes, regions, terrains, labels, transports, travelers,
 *     timeline, style, viewport }
 *
 * Every stored point is `[x, y]`. What the pair means depends on the map kind —
 * pixels of the background on a plane map, `[lon, lat]` degrees on an Earth map,
 * AU on a star system — and only mapSpace.js interprets it.
 *
 * Doc references (`pin.doc`, `traveler.doc`) are TREE paths, e.g.
 * `Settings/Rivertown`, never `.json` file paths.
 *
 * Mirrors `inkblot_core::map::model`; `npm run parity` asserts the two agree, so
 * every check here is written the way the Rust reads it: a value of the wrong JSON
 * type is replaced by the default, never coerced.
 */

import { describeMapDiff, diffMaps } from './mapDiff'

export const MAP_FORMAT_VERSION = 1

export const MAP_KINDS = ['blank', 'image', 'earth', 'system']
export const EARTH_PROJECTIONS = ['equalEarth', 'equirectangular', 'mercator', 'naturalEarth', 'orthographic']
export const EARTH_DETAIL = ['auto', '110m', '50m']
export const ROUTE_SMOOTHING = ['linear', 'catmullRom']
export const LINE_DASHES = ['solid', 'dashed', 'dotted', 'inked', 'rough']
export const HATCHES = ['none', 'diagonal', 'cross', 'dots', 'waves', 'mountains']
export const TRANSPORT_MEDIA = ['land', 'water', 'air', 'space']
export const MAP_THEMES = ['clean', 'parchment', 'ink', 'night']
export const BODY_KINDS = ['star', 'planet', 'dwarf', 'moon', 'belt', 'station', 'barycenter']
export const RADIAL_MODES = ['linear', 'log']

/** A blank map is a sheet this big, in map units, until something says otherwise. */
export const BLANK_SHEET = { width: 4000, height: 3000 }

export const DEFAULT_MAP_VIEWPORT = { x: 0, y: 0, zoom: 1 }

/** 16 hex chars, the same id style canvases use. */
export const newId = () => {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/* ---------- reading raw JSON ---------- */

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const stringOr = (value, fallback) => (typeof value === 'string' ? value : fallback)
const numberOr = (value, fallback) => (Number.isFinite(value) ? value : fallback)
const positiveOr = (value, fallback) => (Number.isFinite(value) && value > 0 ? value : fallback)
const boolOr = (value, fallback) => (typeof value === 'boolean' ? value : fallback)
const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback)
const objectOr = (value) => (isObject(value) ? value : {})

/** `[x, y]` from anything; null unless both are finite numbers. Extra entries drop. */
export const readPoint = (value) =>
  Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])
    ? [value[0], value[1]]
    : null

const readPoints = (value) => (Array.isArray(value) ? value.map(readPoint).filter(Boolean) : [])

/**
 * Normalize an array of items that each carry an `id`: non-objects drop, a missing
 * or empty id is generated, and a repeated id keeps only its first item.
 * `normalizeItem` returns the item or null to drop it.
 */
const readList = (value, nextId, normalizeItem) => {
  const out = []
  const seen = new Set()
  for (const item of Array.isArray(value) ? value : []) {
    if (!isObject(item)) continue
    const id = typeof item.id === 'string' && item.id ? item.id : nextId()
    if (seen.has(id)) continue
    const normalized = normalizeItem({ ...item, id })
    if (!normalized) continue
    seen.add(id)
    out.push(normalized)
  }
  return out
}

/* ---------- sections ---------- */

const readScale = (raw) => {
  const scale = objectOr(raw)
  const calibration = objectOr(scale.calibration)
  const a = readPoint(calibration.a)
  const b = readPoint(calibration.b)
  const distance = positiveOr(calibration.distance, null)
  return {
    ...scale,
    kmPerUnit: positiveOr(scale.kmPerUnit, 1),
    displayUnit: stringOr(scale.displayUnit, 'km'),
    calibration: a && b && distance !== null
      ? { ...calibration, a, b, distance, unit: stringOr(calibration.unit, 'km') }
      : null,
    customUnits: (Array.isArray(scale.customUnits) ? scale.customUnits : [])
      .filter((unit) => isObject(unit) && typeof unit.id === 'string' && unit.id && positiveOr(unit.km, null) !== null)
      .map((unit) => ({ ...unit, name: stringOr(unit.name, unit.id) })),
  }
}

const readBackground = (raw) => {
  const background = objectOr(raw)
  const opacity = numberOr(background.opacity, 1)
  return {
    ...background,
    image: stringOr(background.image, null),
    width: positiveOr(background.width, null),
    height: positiveOr(background.height, null),
    opacity: Math.min(1, Math.max(0, opacity)),
    trace: stringOr(background.trace, null),
    showImage: boolOr(background.showImage, true),
  }
}

const readEarth = (raw) => {
  const earth = objectOr(raw)
  return {
    ...earth,
    projection: oneOf(earth.projection, EARTH_PROJECTIONS, 'equalEarth'),
    rotate: readPoint(earth.rotate) || [0, 0],
    graticule: boolOr(earth.graticule, true),
    borders: boolOr(earth.borders, true),
    detail: oneOf(earth.detail, EARTH_DETAIL, 'auto'),
  }
}

const readOrbit = (raw) => {
  if (!isObject(raw)) return null
  const aAU = positiveOr(raw.aAU, null)
  if (aAU === null) return null
  const e = numberOr(raw.e, 0)
  return {
    ...raw,
    aAU,
    // Past 0.99 the Kepler solve stops converging in a fixed number of steps.
    e: Math.min(0.99, Math.max(0, e)),
    periapsisDeg: numberOr(raw.periapsisDeg, 0),
    meanAnomalyDeg: numberOr(raw.meanAnomalyDeg, 0),
    periodDays: positiveOr(raw.periodDays, null),
    retrograde: boolOr(raw.retrograde, false),
  }
}

const readBody = (body) => ({
  ...body,
  name: stringOr(body.name, ''),
  kind: oneOf(body.kind, BODY_KINDS, 'planet'),
  parent: stringOr(body.parent, null),
  massSun: positiveOr(body.massSun, null),
  radiusKm: positiveOr(body.radiusKm, null),
  color: stringOr(body.color, null),
  orbit: readOrbit(body.orbit),
})

const readSystem = (raw, nextId) => {
  const system = objectOr(raw)
  const display = objectOr(system.display)
  const bodies = readList(system.bodies, nextId, readBody)
  // A parent that is not a body here (or is the body itself) orbits nothing.
  const ids = new Set(bodies.map((body) => body.id))
  for (const body of bodies) {
    if (body.parent !== null && (!ids.has(body.parent) || body.parent === body.id)) body.parent = null
  }
  return {
    ...system,
    bodies,
    display: {
      ...display,
      radial: oneOf(display.radial, RADIAL_MODES, 'log'),
      pxPerAU: positiveOr(display.pxPerAU, 100),
    },
  }
}

const readLineStyle = (raw) => {
  const style = objectOr(raw)
  return {
    ...style,
    stroke: stringOr(style.stroke, null),
    width: positiveOr(style.width, 2),
    dash: oneOf(style.dash, LINE_DASHES, 'solid'),
    arrow: boolOr(style.arrow, false),
  }
}

const readPin = (pin) => {
  const at = readPoint(pin.at)
  const body = stringOr(pin.body, null)
  // Somewhere to be is the one thing a pin cannot do without.
  if (!at && !body) return null
  return {
    ...pin,
    name: stringOr(pin.name, null),
    doc: stringOr(pin.doc, null),
    at,
    body,
    icon: stringOr(pin.icon, 'pin'),
    color: stringOr(pin.color, null),
  }
}

const readRoute = (pinIds) => (route) => {
  const nodes = []
  for (const node of Array.isArray(route.nodes) ? route.nodes : []) {
    if (!isObject(node)) continue
    if (typeof node.pin === 'string' && pinIds.has(node.pin)) {
      const { at: _at, ...rest } = node
      nodes.push(rest)
      continue
    }
    const at = readPoint(node.at)
    if (at) {
      const { pin: _pin, ...rest } = node
      nodes.push({ ...rest, at })
    }
  }
  // A route of fewer than two stops has no line to draw.
  if (nodes.length < 2) return null
  return {
    ...route,
    name: stringOr(route.name, null),
    nodes,
    smooth: oneOf(route.smooth, ROUTE_SMOOTHING, 'linear'),
    style: readLineStyle(route.style),
  }
}

const readRegion = (region) => {
  const rings = (Array.isArray(region.rings) ? region.rings : [])
    .map(readPoints)
    .filter((ring) => ring.length >= 3)
  if (!rings.length) return null
  return {
    ...region,
    name: stringOr(region.name, null),
    rings,
    terrain: stringOr(region.terrain, null),
    fill: stringOr(region.fill, null),
    hatch: oneOf(region.hatch, HATCHES, 'none'),
    stroke: stringOr(region.stroke, null),
  }
}

/** Speed multipliers keyed by transport id or `*<medium>`; only numbers ≥ 0 count. */
const readMultipliers = (raw) => {
  const out = {}
  for (const [key, value] of Object.entries(objectOr(raw))) {
    if (Number.isFinite(value) && value >= 0) out[key] = value
  }
  return out
}

const readTerrain = (terrain) => ({
  ...terrain,
  name: stringOr(terrain.name, terrain.id),
  multipliers: readMultipliers(terrain.multipliers),
})

const readLabel = (routeIds) => (label) => {
  const at = readPoint(label.at)
  const route = typeof label.route === 'string' && routeIds.has(label.route) ? label.route : null
  const path = readPoints(label.path)
  if (!at && !route && path.length < 2) return null
  return {
    ...label,
    text: stringOr(label.text, ''),
    at,
    route,
    path: path.length >= 2 ? path : null,
    startOffset: Math.min(1, Math.max(0, numberOr(label.startOffset, 0.5))),
    size: positiveOr(label.size, 18),
    rotation: numberOr(label.rotation, 0),
    font: stringOr(label.font, 'serif'),
    minZoom: numberOr(label.minZoom, 0),
    maxZoom: positiveOr(label.maxZoom, null),
  }
}

const readTransport = (transport) => {
  const fractionC = numberOr(transport.fractionC, null)
  return {
    ...transport,
    name: stringOr(transport.name, transport.id),
    kmh: positiveOr(transport.kmh, 5),
    hoursPerDay: Math.min(24, positiveOr(transport.hoursPerDay, 8)),
    medium: oneOf(transport.medium, TRANSPORT_MEDIA, 'land'),
    fractionC: fractionC !== null && fractionC > 0 && fractionC < 1 ? fractionC : null,
  }
}

const readLeg = (routeIds, pinIds) => (leg) => ({
  ...leg,
  route: typeof leg.route === 'string' && routeIds.has(leg.route) ? leg.route : null,
  from: typeof leg.from === 'string' && pinIds.has(leg.from) ? leg.from : null,
  to: typeof leg.to === 'string' && pinIds.has(leg.to) ? leg.to : null,
  transport: stringOr(leg.transport, 'walk'),
  departDay: numberOr(leg.departDay, null),
  restDays: Math.max(0, numberOr(leg.restDays, 0)),
})

const readTraveler = (routeIds, pinIds, nextId) => (traveler) => ({
  ...traveler,
  doc: stringOr(traveler.doc, null),
  name: stringOr(traveler.name, null),
  color: stringOr(traveler.color, null),
  startPin: typeof traveler.startPin === 'string' && pinIds.has(traveler.startPin) ? traveler.startPin : null,
  startDay: numberOr(traveler.startDay, 0),
  legs: readList(traveler.legs, nextId, readLeg(routeIds, pinIds)),
})

/** A screen-anchored ornament: `at` is a fraction of the view, 0–1 on each axis. */
const readOrnament = (raw, show, at, extra = {}) => {
  const ornament = objectOr(raw)
  return {
    ...ornament,
    ...extra,
    show: boolOr(ornament.show, show),
    at: readPoint(ornament.at) || at,
  }
}

const readStyle = (raw) => {
  const style = objectOr(raw)
  const compass = objectOr(style.compass)
  const cartouche = objectOr(style.cartouche)
  return {
    ...style,
    theme: oneOf(style.theme, MAP_THEMES, 'clean'),
    compass: readOrnament(style.compass, true, [0.92, 0.14], {
      size: positiveOr(compass.size, 96),
      style: stringOr(compass.style, 'rose8'),
    }),
    scaleBar: readOrnament(style.scaleBar, true, [0.05, 0.94]),
    cartouche: readOrnament(style.cartouche, false, [0.08, 0.08], {
      title: stringOr(cartouche.title, null),
      subtitle: stringOr(cartouche.subtitle, null),
    }),
  }
}

/** Read the persisted viewport, tolerating a missing or malformed one. */
export function readMapViewport(raw) {
  const viewport = raw?.viewport
  if (!isObject(viewport)) return { ...DEFAULT_MAP_VIEWPORT }
  return {
    x: numberOr(viewport.x, DEFAULT_MAP_VIEWPORT.x),
    y: numberOr(viewport.y, DEFAULT_MAP_VIEWPORT.y),
    zoom: positiveOr(viewport.zoom, DEFAULT_MAP_VIEWPORT.zoom),
  }
}

/* ---------- normalize / serialize ---------- */

/**
 * Parse arbitrary on-disk JSON into a map. Anything unrecognizable degrades to a
 * blank map rather than throwing — a corrupt file opens empty, never crashes the
 * pane. `nextId` supplies ids for items that lack one (the parity harness passes a
 * counter so both implementations agree).
 *
 * Order matters for references: pins are read before routes (a route stop naming a
 * pin that is not here drops), routes before labels and travelers.
 */
export function normalizeMap(raw, nextId = newId) {
  const source = isObject(raw) ? raw : {}

  const pins = readList(source.pins, nextId, readPin)
  const pinIds = new Set(pins.map((pin) => pin.id))
  const routes = readList(source.routes, nextId, readRoute(pinIds))
  const routeIds = new Set(routes.map((route) => route.id))

  return {
    ...source,
    type: 'map',
    formatVersion: MAP_FORMAT_VERSION,
    mapKind: oneOf(source.mapKind, MAP_KINDS, 'blank'),
    scale: readScale(source.scale),
    background: readBackground(source.background),
    earth: readEarth(source.earth),
    system: readSystem(source.system, nextId),
    pins,
    routes,
    regions: readList(source.regions, nextId, readRegion),
    terrains: readList(source.terrains, nextId, readTerrain),
    labels: readList(source.labels, nextId, readLabel(routeIds)),
    transports: readList(source.transports, nextId, readTransport),
    travelers: readList(source.travelers, nextId, readTraveler(routeIds, pinIds, nextId)),
    timeline: { ...objectOr(source.timeline), day: numberOr(objectOr(source.timeline).day, 0) },
    style: readStyle(source.style),
    viewport: readMapViewport(source),
  }
}

/** A map → what is written to disk, with the live viewport folded in. */
export function serializeMap(map, viewport = map?.viewport) {
  return { ...map, type: 'map', formatVersion: MAP_FORMAT_VERSION, viewport: readMapViewport({ viewport }) }
}

/**
 * Is this raw file content a map (or nothing at all)? The loader refuses to write
 * over anything else: a text document named `Something.map` existed before maps
 * did, and treating it as a blank map would overwrite it on the first autosave.
 */
export const isMapPayload = (raw) => raw === null || raw === undefined || (isObject(raw) && raw.type === 'map')

/** A new, empty map of `mapKind`. */
export function createEmptyMap(mapKind = 'blank', overrides = {}) {
  const kind = oneOf(mapKind, MAP_KINDS, 'blank')
  const base = { mapKind: kind, ...overrides }
  if (kind === 'blank' && !isObject(overrides.background)) {
    base.background = { width: BLANK_SHEET.width, height: BLANK_SHEET.height }
  }
  return normalizeMap(base)
}

/* ---------- factories ---------- */

export const makePin = ({ at = null, doc = null, name = null, ...rest } = {}) => ({
  id: newId(),
  name,
  doc,
  at: readPoint(at),
  body: null,
  icon: 'pin',
  color: null,
  ...rest,
})

/* ---------- queries ---------- */

/** The name a pin shows: its own, else its document's, else a placeholder. */
export const pinLabel = (pin, docDisplayName = (doc) => doc.split('/').filter(Boolean).pop() || doc) => {
  if (!pin) return ''
  if (pin.name) return pin.name
  if (pin.doc) return docDisplayName(pin.doc)
  return 'Untitled place'
}

const words = (text) => String(text || '').split(/\s+/).filter(Boolean).length

/**
 * Every piece of text written onto a map — names, labels and the cartouche — in the
 * order countMapWords and mapText read them.
 */
function mapStrings(map) {
  if (!isObject(map)) return []
  const out = []
  for (const list of [map.pins, map.routes, map.regions, map.travelers]) {
    for (const item of Array.isArray(list) ? list : []) {
      if (isObject(item) && typeof item.name === 'string') out.push(item.name)
    }
  }
  for (const label of Array.isArray(map.labels) ? map.labels : []) {
    if (isObject(label) && typeof label.text === 'string') out.push(label.text)
  }
  const cartouche = objectOr(objectOr(map.style).cartouche)
  for (const key of ['title', 'subtitle']) {
    if (typeof cartouche[key] === 'string') out.push(cartouche[key])
  }
  return out
}

/** Words written onto a map — names and labels. Mirrors countCanvasWords. */
export const countMapWords = (map) => mapStrings(map).reduce((total, text) => total + words(text), 0)

/** The text written onto a map, space-separated — what filtering its history searches. */
export const mapText = (map) => mapStrings(map).join(' ')

/* ---------- doc references ---------- */

/**
 * Where the doc at `path` is after `entryPath` became `nextPath` — the rules of
 * entryOperations.remapPath, repeated here so this module stays free of the
 * filesystem. `undefined`: untouched. `null`: the entry was deleted.
 */
const remapDocRef = (path, entryPath, nextPath, type) => {
  if (!path || !entryPath) return undefined
  const hit = type === 'folder' ? path.startsWith(`${entryPath}/`) : path === entryPath
  if (!hit) return undefined
  if (nextPath == null) return null
  return type === 'folder' ? `${nextPath}${path.slice(entryPath.length)}` : nextPath
}

/**
 * Follow a rename or move of `entryPath` (a doc, or a folder of them) through every
 * doc reference on the map. A delete (`nextPath` null) leaves references in place —
 * the pin shows as missing and can be relinked, which beats silently losing it.
 *
 * Returns `{ map, changed }`; `map` is the input itself when nothing changed.
 */
export function rewriteMapDocRefs(map, entryPath, nextPath, type = 'file') {
  if (!isObject(map) || nextPath == null) return { map, changed: false }
  let changed = false

  const rewrite = (list) => {
    if (!Array.isArray(list)) return list
    let touched = false
    const next = list.map((item) => {
      const moved = isObject(item) ? remapDocRef(item.doc, entryPath, nextPath, type) : undefined
      if (typeof moved !== 'string' || moved === item.doc) return item
      touched = true
      return { ...item, doc: moved }
    })
    if (!touched) return list
    changed = true
    return next
  }

  const pins = rewrite(map.pins)
  const travelers = rewrite(map.travelers)
  return changed ? { map: { ...map, pins, travelers }, changed } : { map, changed }
}

/** Every doc the map links to, deduplicated, in first-seen order. */
export function mapDocRefs(map) {
  const out = []
  const seen = new Set()
  for (const list of [map?.pins, map?.travelers]) {
    for (const item of Array.isArray(list) ? list : []) {
      if (isObject(item) && typeof item.doc === 'string' && item.doc && !seen.has(item.doc)) {
        seen.add(item.doc)
        out.push(item.doc)
      }
    }
  }
  return out
}

/* ---------- history ---------- */

const COUNTED = [
  ['pins', 'place', 'places'],
  ['routes', 'route', 'routes'],
  ['regions', 'region', 'regions'],
  ['labels', 'label', 'labels'],
  ['travelers', 'traveler', 'travelers'],
]

const countOf = (map, key) => (Array.isArray(map?.[key]) ? map[key].length : 0)

/**
 * One line for a history row: what a version holds, or how it differs from the
 * version before it (see describeMapDiff).
 */
export function summarizeMapChange(previous, next) {
  if (!previous) {
    const parts = COUNTED
      .map(([key, one, many]) => [countOf(next, key), one, many])
      .filter(([count]) => count > 0)
      .map(([count, one, many]) => `${count} ${count === 1 ? one : many}`)
    return parts.length ? `Snapshot · ${parts.join(', ')}` : 'Snapshot · empty map'
  }
  return describeMapDiff(diffMaps(previous, next))
}
