/**
 * stage.js — what every 3D map view stands on: a renderer in a container, a
 * camera with orbit controls, a scene, and drawing on demand.
 *
 * `invalidate()` asks for a frame; nothing draws otherwise (the controls' damping
 * asks for more while it settles). After each frame the view's `onFrame` hears the
 * camera, and a quarter-second after the camera stops, `onSettle` (to save it).
 * `moveTo` glides the camera somewhere (or cuts, under reduced motion).
 *
 * The space view (systems) and the planet view (one world) build on it; each adds
 * its own scene and the projector API the map surface talks to.
 */
import { ACESFilmicToneMapping, Color, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const SETTLE_MS = 250
const MAX_PIXEL_RATIO = 2

export const reducedMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

/**
 * Set up a stage in `container`, the camera where `saved` says. Throws if WebGL is
 * not available. `beforeRender(camera, size)` runs before each frame.
 */
export function createStage(container, { saved, background, near = 1e-6, far = 1e7, beforeRender }) {
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.setClearColor(new Color(background), 1)
  renderer.domElement.className = 'map-space-canvas'
  container.appendChild(renderer.domElement)

  const camera = new PerspectiveCamera(saved.fov, 1, near, far)
  camera.position.set(...saved.position)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(...saved.target)
  controls.enableDamping = !reducedMotion()
  controls.dampingFactor = 0.12
  controls.zoomSpeed = 1.2
  controls.screenSpacePanning = true
  controls.update()

  const scene = new Scene()
  const size = { width: 1, height: 1 }
  const listeners = { frame: null, settle: null }
  let frame = 0
  let glide = 0
  let settleTimer = 0
  let disposed = false

  const snapshot = () => ({
    position: camera.position.toArray(),
    target: controls.target.toArray(),
    fov: camera.fov,
    ortho: false,
    distance: camera.position.distanceTo(controls.target),
  })

  function draw() {
    frame = 0
    if (disposed) return
    const moving = controls.update()
    beforeRender?.(camera, size)
    renderer.render(scene, camera)
    listeners.frame?.({ camera: snapshot(), width: size.width, height: size.height })
    if (moving) invalidate()
  }
  function invalidate() {
    if (!frame && !disposed) frame = requestAnimationFrame(draw)
  }
  function settle() {
    window.clearTimeout(settleTimer)
    settleTimer = window.setTimeout(() => listeners.settle?.(snapshot()), SETTLE_MS)
  }
  controls.addEventListener('change', () => {
    invalidate()
    settle()
  })

  const resize = () => {
    size.width = container.clientWidth || 1
    size.height = container.clientHeight || 1
    renderer.setSize(size.width, size.height, false)
    camera.aspect = size.width / size.height
    camera.updateProjectionMatrix()
    invalidate()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(container)
  resize()

  /** Glide the camera to look at `target` from `position` (Vector3s). */
  function moveTo(target, position, { duration = 600, onStep } = {}) {
    cancelAnimationFrame(glide)
    if (reducedMotion() || duration <= 0) {
      controls.target.copy(target)
      camera.position.copy(position)
      onStep?.(1)
      controls.update()
      invalidate()
      settle()
      return
    }
    const fromTarget = controls.target.clone()
    const fromPosition = camera.position.clone()
    const start = performance.now()
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / duration)
      const ease = 1 - (1 - t) ** 3
      controls.target.lerpVectors(fromTarget, target, ease)
      camera.position.lerpVectors(fromPosition, position, ease)
      onStep?.(ease)
      controls.update()
      invalidate()
      if (t < 1) glide = requestAnimationFrame(step)
      else settle()
    }
    glide = requestAnimationFrame(step)
  }

  /** Screen pixels of a world point, or null behind the camera. */
  function screenOf(world) {
    const ndc = world.clone().project(camera)
    if (ndc.z > 1 || ndc.z < -1) return null
    return [((ndc.x + 1) / 2) * size.width, ((1 - ndc.y) / 2) * size.height]
  }

  function subscribe(onFrame, onSettle) {
    listeners.frame = onFrame
    listeners.settle = onSettle
    invalidate()
    return () => {
      listeners.frame = null
      listeners.settle = null
    }
  }

  function dispose() {
    disposed = true
    cancelAnimationFrame(frame)
    cancelAnimationFrame(glide)
    window.clearTimeout(settleTimer)
    observer.disconnect()
    controls.dispose()
    renderer.dispose()
    renderer.domElement.remove()
  }

  return { renderer, camera, controls, scene, size, invalidate, settle, moveTo, screenOf, subscribe, dispose }
}
