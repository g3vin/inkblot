/**
 * geodesy.js — distances and paths on the Earth, treated as a sphere.
 *
 * Points are `[lon, lat]` in degrees. The mean radius (IUGG R₁) puts every figure
 * within about 0.5% of the ellipsoid, which is far inside what a story needs and lets
 * a route be drawn along the same great circle it is measured on.
 *
 * Hand-written rather than taken from d3-geo, so that `inkblot_core::map::geodesy`
 * can mirror the exact formulas and `npm run parity` can hold them together; d3 only
 * draws.
 */

export const EARTH_RADIUS_KM = 6371.0088

const RAD = Math.PI / 180

/** Longitude folded into [-180, 180). */
export const normalizeLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180

/** Great-circle distance (haversine). */
export function haversineKm(a, b) {
  const phi1 = a[1] * RAD
  const phi2 = b[1] * RAD
  const dPhi = (b[1] - a[1]) * RAD
  const dLambda = (b[0] - a[0]) * RAD
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Initial compass bearing from a to b, degrees clockwise from north, [0, 360). */
export function initialBearing(a, b) {
  const phi1 = a[1] * RAD
  const phi2 = b[1] * RAD
  const dLambda = (b[0] - a[0]) * RAD
  const y = Math.sin(dLambda) * Math.cos(phi2)
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda)
  return ((Math.atan2(y, x) / RAD) % 360 + 360) % 360
}

/** The point a fraction `t` of the way along the great circle from a to b. */
export function interpolateGreatCircle(a, b, t) {
  const phi1 = a[1] * RAD
  const lambda1 = a[0] * RAD
  const phi2 = b[1] * RAD
  const lambda2 = b[0] * RAD
  const delta = haversineKm(a, b) / EARTH_RADIUS_KM
  if (delta < 1e-12) return [a[0], a[1]]
  const sinDelta = Math.sin(delta)
  const wa = Math.sin((1 - t) * delta) / sinDelta
  const wb = Math.sin(t * delta) / sinDelta
  const x = wa * Math.cos(phi1) * Math.cos(lambda1) + wb * Math.cos(phi2) * Math.cos(lambda2)
  const y = wa * Math.cos(phi1) * Math.sin(lambda1) + wb * Math.cos(phi2) * Math.sin(lambda2)
  const z = wa * Math.sin(phi1) + wb * Math.sin(phi2)
  return [Math.atan2(y, x) / RAD, Math.atan2(z, Math.sqrt(x * x + y * y)) / RAD]
}

/**
 * The great circle from a to b as points no more than `maxStepKm` apart, ends
 * included. What a route is measured and drawn along, and what terrain is sampled
 * against.
 */
export function densifyGreatCircle(a, b, maxStepKm = 50) {
  const distance = haversineKm(a, b)
  const steps = Math.max(1, Math.ceil(distance / Math.max(maxStepKm, 1e-6)))
  const out = [[a[0], a[1]]]
  for (let step = 1; step < steps; step += 1) out.push(interpolateGreatCircle(a, b, step / steps))
  out.push([b[0], b[1]])
  return out
}

/**
 * The area of a ring on the sphere, km² (the spherical-excess sum of Chamberlain
 * and Duquette). Accurate for rings that do not enclose a pole.
 */
export function sphericalRingAreaKm2(ring) {
  if (ring.length < 3) return 0
  let sum = 0
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index]
    const b = ring[(index + 1) % ring.length]
    sum += (b[0] - a[0]) * RAD * (2 + Math.sin(a[1] * RAD) + Math.sin(b[1] * RAD))
  }
  return Math.abs((sum * EARTH_RADIUS_KM * EARTH_RADIUS_KM) / 2)
}
