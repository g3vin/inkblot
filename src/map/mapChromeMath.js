/**
 * mapChromeMath.js — sizing the scale bar.
 *
 * The bar is measured, not assumed: it asks the map's space how far apart two points
 * 100 px either side of the view's centre are, so it is right on a calibrated
 * picture, on a projection whose scale changes with latitude, and on a star system.
 */
import { formatNumber, kmPerUnit, mapUnits } from '../lib/map/mapUnits'
import { screenToWorld } from '../lib/map/mapViewport'

const MAX_BAR_PX = 160
const NICE = [1, 2, 5]

/** The longest round length (1, 2 or 5 × 10ⁿ units) that fits in MAX_BAR_PX. */
/** Maps with no north to point to: space has no up, and a model has its own. */
export const NO_NORTH = new Set(['system', 'galaxy', 'universe', 'model'])

export function niceScale(kmPerPx, unitKm) {
  if (!(kmPerPx > 0)) return null
  const maxUnits = (kmPerPx * MAX_BAR_PX) / unitKm
  const exponent = Math.floor(Math.log10(maxUnits))
  let best = null
  for (let power = exponent - 1; power <= exponent; power += 1) {
    for (const step of NICE) {
      const value = step * 10 ** power
      if (value <= maxUnits && (!best || value > best)) best = value
    }
  }
  if (!best) return null
  return { value: best, px: (best * unitKm) / kmPerPx }
}

/** Km per screen pixel at the middle of the view, or null where the map has no ground. */
export function kmPerPixel(projector, space, viewport, width, height) {
  const a = screenToWorld(width / 2 - 50, height / 2, viewport)
  const b = screenToWorld(width / 2 + 50, height / 2, viewport)
  const pa = projector.fromWorld([a.x, a.y])
  const pb = projector.fromWorld([b.x, b.y])
  if (!pa || !pb) return null
  const km = space.distanceKm(pa, pb)
  return Number.isFinite(km) && km > 0 ? km / 100 : null
}

/**
 * A unit that suits the distance a bar spans: km near a planet, AU across a system,
 * light-years among the stars, and millions of light-years between galaxies.
 */
const KM_PER_LY = 9.4607e12
const autoUnit = (kmPerPx) => {
  const span = kmPerPx * MAX_BAR_PX
  if (span > 1e5 * KM_PER_LY) return 'Mly'
  if (span > 0.2 * KM_PER_LY) return 'ly'
  return span > 2e7 ? 'AU' : 'km'
}
const AUTO_UNIT_KINDS = new Set(['system', 'galaxy', 'universe'])

/** The scale bar for a view `width` × `height` px: `{ px, value, label }`, or null. */
export function scaleBarFor(map, projector, space, viewport, width, height) {
  const perPx = kmPerPixel(projector, space, viewport, width, height)
  if (!perPx) return null
  const unitId = AUTO_UNIT_KINDS.has(map.mapKind) ? autoUnit(perPx) : map.scale.displayUnit || 'km'
  const unit = mapUnits(map).find((candidate) => candidate.id === unitId)
  const nice = niceScale(perPx, kmPerUnit(unitId, map))
  return nice ? { ...nice, label: `${formatNumber(nice.value)} ${unit?.short || unitId}` } : null
}
