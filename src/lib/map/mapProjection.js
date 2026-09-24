/**
 * mapProjection.js — where a stored point is drawn.
 *
 * The render-side twin of mapSpace.js. A projector turns stored coordinates into
 * WORLD coordinates — the units the SVG world group is drawn in, before the
 * viewport's pan and zoom — and back again, which is how a click becomes a stored
 * point:
 *
 *   plane   the identity: a pin's `at` is already a pixel of the sheet or picture
 *   earth   a d3-geo projection of lon/lat onto a 4096-wide world
 *   system  AU (y up) onto the page (y down), linearly or on a log-radial scale so
 *           a system's inner planets and its outer giants fit on one screen
 *
 * Distances are never measured here — a log-scaled orbit is drawn short and
 * measured true (mapSpace.js).
 */
import {
  geoEqualEarth,
  geoEquirectangular,
  geoMercator,
  geoNaturalEarth1,
  geoOrthographic,
  geoDistance,
  geoPath,
} from 'd3-geo'
import { BLANK_SHEET } from './mapModel'
import { systemPositionsAt } from './orbits'

/** The width of the world an Earth map is drawn into. */
export const EARTH_WORLD_WIDTH = 4096
/** World units per AU at scale 1 on a star system (display.pxPerAU overrides). */
const DEFAULT_PX_PER_AU = 100
/** The log-radial scale's knee: nearer than this the scale is near-linear. */
const LOG_R0 = 0.3
const LOG_NORM = Math.log(1 + 1 / LOG_R0)
/** Mercator's usual cut-off, where the square world ends. */
const MERCATOR_LIMIT = 85.0511

const PROJECTIONS = {
  equalEarth: geoEqualEarth,
  equirectangular: geoEquirectangular,
  mercator: geoMercator,
  naturalEarth: geoNaturalEarth1,
  orthographic: geoOrthographic,
}

export const PROJECTION_NAMES = {
  equalEarth: 'Equal Earth',
  naturalEarth: 'Natural Earth',
  equirectangular: 'Equirectangular',
  mercator: 'Mercator',
  orthographic: 'Globe',
}

/** A d3 projection for an Earth map, sized to EARTH_WORLD_WIDTH. */
export function makeEarthProjection(earth) {
  const name = PROJECTIONS[earth?.projection] ? earth.projection : 'equalEarth'
  const projection = PROJECTIONS[name]()
  const rotate = Array.isArray(earth?.rotate) ? earth.rotate : [0, 0]
  projection.rotate([rotate[0], rotate[1]])
  if (name === 'orthographic') {
    projection.clipAngle(90)
    projection.fitSize([EARTH_WORLD_WIDTH, EARTH_WORLD_WIDTH], { type: 'Sphere' })
  } else if (name === 'mercator') {
    // Mercator's sphere is infinite; fit the band it is actually drawn for.
    projection.fitSize([EARTH_WORLD_WIDTH, EARTH_WORLD_WIDTH], {
      type: 'Polygon',
      coordinates: [[[-179.999, -MERCATOR_LIMIT], [179.999, -MERCATOR_LIMIT], [179.999, MERCATOR_LIMIT], [-179.999, MERCATOR_LIMIT], [-179.999, -MERCATOR_LIMIT]]],
    })
  } else {
    projection.fitWidth(EARTH_WORLD_WIDTH, { type: 'Sphere' })
  }
  return { name, projection }
}

/** A key that changes exactly when the projected picture would. */
export const projectionKey = (earth) =>
  `${earth?.projection || 'equalEarth'}:${(earth?.rotate || [0, 0]).map((value) => Math.round(value * 100) / 100).join(',')}`

/* ---------- star-system display scale ---------- */

const radialOut = (r, mode, pxPerAU) =>
  mode === 'linear' ? r * pxPerAU : (pxPerAU * Math.log(1 + r / LOG_R0)) / LOG_NORM

const radialIn = (d, mode, pxPerAU) =>
  mode === 'linear' ? d / pxPerAU : LOG_R0 * (Math.exp((d / pxPerAU) * LOG_NORM) - 1)

/** AU (y up, around `center`) → world (y down). */
export function systemToWorld(point, display, center = [0, 0]) {
  const pxPerAU = display?.pxPerAU > 0 ? display.pxPerAU : DEFAULT_PX_PER_AU
  const dx = point[0] - center[0]
  const dy = point[1] - center[1]
  const r = Math.hypot(dx, dy)
  if (r === 0) return [0, 0]
  const d = radialOut(r, display?.radial, pxPerAU)
  return [(dx / r) * d, (-dy / r) * d]
}

export function worldToSystem(point, display, center = [0, 0]) {
  const pxPerAU = display?.pxPerAU > 0 ? display.pxPerAU : DEFAULT_PX_PER_AU
  const d = Math.hypot(point[0], point[1])
  if (d === 0) return [center[0], center[1]]
  const r = radialIn(d, display?.radial, pxPerAU)
  return [center[0] + (point[0] / d) * r, center[1] - (point[1] / d) * r]
}

/* ---------- projectors ---------- */

/**
 * The projector for a map on `day`. `toWorld` returns null for a point that is not
 * drawn (the far side of a globe).
 */
export function createProjector(map, { day = 0, focusBody = null } = {}) {
  if (map?.mapKind === 'earth') {
    const { name, projection } = makeEarthProjection(map.earth)
    const rotate = projection.rotate()
    const center = [-rotate[0], -rotate[1]]
    const path = geoPath(projection)
    const [[x0, y0], [x1, y1]] = name === 'mercator'
      ? [[0, 0], [EARTH_WORLD_WIDTH, EARTH_WORLD_WIDTH]]
      : path.bounds({ type: 'Sphere' })
    return {
      kind: 'earth',
      projection,
      path,
      key: projectionKey(map.earth),
      bounds: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
      toWorld: (point) => {
        if (!point) return null
        if (name === 'orthographic' && geoDistance(center, point) > Math.PI / 2) return null
        const lat = name === 'mercator' ? Math.max(-MERCATOR_LIMIT, Math.min(MERCATOR_LIMIT, point[1])) : point[1]
        return projection([point[0], lat])
      },
      fromWorld: (point) => {
        const inverted = projection.invert(point)
        return inverted && Number.isFinite(inverted[0]) && Number.isFinite(inverted[1]) ? inverted : null
      },
      // Degrees per world unit, roughly, at the equator — for snapping and hit slop.
      unitsPerWorld: 360 / EARTH_WORLD_WIDTH,
    }
  }

  if (map?.mapKind === 'system') {
    const display = map.system?.display
    const positions = systemPositionsAt(map.system, day)
    const center = focusBody && positions.get(focusBody) ? positions.get(focusBody) : [0, 0]
    let reach = 1
    for (const position of positions.values()) reach = Math.max(reach, Math.hypot(position[0] - center[0], position[1] - center[1]))
    const extent = Math.abs(systemToWorld([reach, 0], display)[0]) * 1.15
    return {
      kind: 'system',
      positions,
      center,
      display,
      bounds: { x: -extent, y: -extent, width: extent * 2, height: extent * 2 },
      toWorld: (point) => (point ? systemToWorld(point, display, center) : null),
      fromWorld: (point) => worldToSystem(point, display, center),
      unitsPerWorld: 1 / (display?.pxPerAU || DEFAULT_PX_PER_AU),
    }
  }

  const width = map?.background?.width || BLANK_SHEET.width
  const height = map?.background?.height || BLANK_SHEET.height
  return {
    kind: 'plane',
    bounds: { x: 0, y: 0, width, height },
    toWorld: (point) => (point ? [point[0], point[1]] : null),
    fromWorld: (point) => [point[0], point[1]],
    unitsPerWorld: 1,
  }
}
