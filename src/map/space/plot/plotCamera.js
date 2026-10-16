/**
 * plotCamera.js — the screen a printed plate is drawn on: a saved 3D camera (as the
 * stage keeps it: position, target, field of view, flat or not) made into a
 * projection from scene points to the plate's pixels.
 *
 * Flat is a true orthographic projection here (the stage uses a telephoto to look
 * the same), sized so the plate holds what the screen did.
 *
 * Pure three.js maths, no WebGL: a plate can be drawn anywhere, and the same camera
 * and scene always give the same drawing.
 */
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'
import { readSpaceCamera } from '../spaceMath'

const RAD = Math.PI / 180

/**
 * `{ project, depth, pxPerUnitAt }` for `saved` on a `width` × `height` plate.
 * `project(v)` is `[x, y]` in pixels, or null behind the eye; `depth(v)` how far in
 * front of the eye; `pxPerUnitAt(v)` how many pixels a scene unit spans there.
 */
export function plotCamera(saved, width, height) {
  const camera = readSpaceCamera(saved)
  const position = new Vector3(...camera.position)
  const target = new Vector3(...camera.target)
  const distance = position.distanceTo(target)
  const halfHeight = distance * Math.tan((camera.fov * RAD) / 2)
  const aspect = width / Math.max(1, height)
  const eye = camera.ortho
    ? new OrthographicCamera(-halfHeight * aspect, halfHeight * aspect, halfHeight, -halfHeight, -1e7, 1e7)
    : new PerspectiveCamera(camera.fov, aspect, Math.max(1e-6, distance * 1e-4), distance * 1e4)
  eye.position.copy(position)
  eye.up.set(0, 1, 0)
  // Straight down, the up vector is the view direction: lean it a hair.
  if (Math.abs(position.clone().sub(target).normalize().y) > 0.9999) eye.up.set(0, 0, -1)
  eye.lookAt(target)
  eye.updateMatrixWorld(true)
  eye.updateProjectionMatrix()

  const scratch = new Vector3()
  const depth = (v) => -scratch.copy(v).applyMatrix4(eye.matrixWorldInverse).z
  const project = (v) => {
    if (depth(v) <= 0 && !camera.ortho) return null
    scratch.copy(v).project(eye)
    return [((scratch.x + 1) / 2) * width, ((1 - scratch.y) / 2) * height]
  }
  const pxPerUnitAt = (v) => (camera.ortho ? height / (2 * halfHeight) : height / (2 * Math.max(1e-9, depth(v)) * Math.tan((camera.fov * RAD) / 2)))
  return { project, depth, pxPerUnitAt, ortho: camera.ortho }
}
