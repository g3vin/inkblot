/**
 * spaceMath.js — where things in a star system go in the 3D scene, without three.js.
 *
 * A system's own axes are maths axes: x right, y up the page, z out of the plane
 * towards a viewer above it (orbits.js). The scene's are three.js's: y up. So the
 * system's plane is the scene's x–z floor, and a system point [x, y, z] sits at
 * scene [x, z, −y]: seen from above (looking down −y), it is laid out exactly as the
 * flat map draws it.
 *
 * Distances are squeezed as the flat view squeezes them (`systemRadius`), but in
 * three dimensions: a point keeps its direction from the centre and moves in.
 * Kept pure so the tests can check that a face-on view matches the flat map.
 */
import { systemRadius, systemRadiusInverse } from '../../lib/map/mapProjection'

/** System AU → scene units (drawn AU), around `center`. */
export function systemToScene(point, display, center = [0, 0, 0]) {
  const dx = point[0] - center[0]
  const dy = point[1] - center[1]
  const dz = (point[2] || 0) - (center[2] || 0)
  const r = Math.hypot(dx, dy, dz)
  if (r === 0) return [0, 0, 0]
  const k = systemRadius(r, display) / r
  return [dx * k, dz * k, -dy * k]
}

/** Scene units → system AU: the inverse of systemToScene. */
export function sceneToSystem(scene, display, center = [0, 0, 0]) {
  const dx = scene[0]
  const dz = scene[1]
  const dy = -scene[2]
  const d = Math.hypot(dx, dy, dz)
  if (d === 0) return [center[0], center[1], center[2] || 0]
  const k = systemRadiusInverse(d, display) / d
  return [center[0] + dx * k, center[1] + dy * k, (center[2] || 0) + dz * k]
}

/**
 * How many scene units one AU is drawn as, `r` AU from the centre: what a body's
 * true radius is scaled by, so a giant star near the centre is drawn as big as the
 * squeeze makes its neighbourhood.
 */
export function sceneScaleAt(r, display) {
  const step = Math.max(1e-6, r * 1e-3)
  return (systemRadius(r + step, display) - systemRadius(r, display)) / step
}

/** The camera a system opens with: three-quarters from above, looking at the centre. */
export const DEFAULT_SPACE_CAMERA = Object.freeze({ position: [0, 9, 14], target: [0, 0, 0], fov: 40, ortho: false })

const isPoint = (value) => Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(Number.isFinite)

/** A saved space camera, or the default for anything malformed (a globe's camera, say). */
export function readSpaceCamera(raw) {
  const camera = raw && typeof raw === 'object' ? raw : {}
  if (!isPoint(camera.position) || !isPoint(camera.target)) return { ...DEFAULT_SPACE_CAMERA, position: DEFAULT_SPACE_CAMERA.position.slice(), target: DEFAULT_SPACE_CAMERA.target.slice() }
  return {
    position: camera.position.slice(0, 3),
    target: camera.target.slice(0, 3),
    fov: Number.isFinite(camera.fov) && camera.fov > 5 && camera.fov < 120 ? camera.fov : DEFAULT_SPACE_CAMERA.fov,
    ortho: Boolean(camera.ortho),
  }
}

/** The extent (scene units) a system's bodies reach on `positions`, for framing. */
export function sceneReach(positions, display) {
  let reach = 0.5
  for (const position of positions.values()) reach = Math.max(reach, Math.hypot(...systemToScene(position, display)))
  return reach
}
