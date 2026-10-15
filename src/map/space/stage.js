/**
 * stage.js — what every 3D map view stands on: a renderer in a container, a
 * camera with orbit controls, a scene, and drawing on demand.
 *
 * `invalidate()` asks for a frame; nothing draws otherwise (the controls' damping
 * asks for more while it settles). After each frame the view's `onFrame` hears the
 * camera, and a quarter-second after the camera stops, `onSettle` (to save it).
 * `moveTo` glides the camera somewhere (or cuts, under reduced motion); `picture`
 * draws the view into a canvas, for an export, and `record` films a turntable.
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
  // While a turntable records, it alone draws.
  let recording = false

  const snapshot = () => ({
    position: camera.position.toArray(),
    target: controls.target.toArray(),
    fov: camera.fov,
    ortho: false,
    distance: camera.position.distanceTo(controls.target),
  })

  function draw() {
    frame = 0
    if (disposed || recording) return
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

  /**
   * The view as a picture, `scale` times the screen's size in pixels: a canvas,
   * drawn now (the drawing buffer is not kept between frames, so it is copied at once).
   */
  function picture(scale = 1) {
    const ratio = renderer.getPixelRatio()
    renderer.setPixelRatio(scale)
    renderer.setSize(size.width, size.height, false)
    beforeRender?.(camera, size)
    renderer.render(scene, camera)
    const out = document.createElement('canvas')
    out.width = renderer.domElement.width
    out.height = renderer.domElement.height
    out.getContext('2d').drawImage(renderer.domElement, 0, 0)
    renderer.setPixelRatio(ratio)
    renderer.setSize(size.width, size.height, false)
    invalidate()
    return out
  }

  /** Whether this browser can record the view as a video. */
  const canRecord = () => typeof renderer.domElement.captureStream === 'function' && typeof MediaRecorder !== 'undefined'

  /**
   * A turntable: the camera goes once round what it looks at, about the scene's up,
   * over `seconds`, recorded from the canvas. Resolves to `{ blob, extension }`.
   * Frames are drawn one by one and paced in real time, which is how the recorder
   * stamps them; the camera comes back to where it was.
   */
  async function record({ seconds = 8, fps = 30, onProgress } = {}) {
    if (!canRecord()) throw new Error('Video recording is not available here.')
    const stream = renderer.domElement.captureStream(0)
    const [track] = stream.getVideoTracks()
    const mimeType = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type))
    if (!mimeType) throw new Error('Video recording is not available here.')
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12e6 })
    const chunks = []
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data)
    }
    const stopped = new Promise((resolve) => {
      recorder.onstop = resolve
    })
    cancelAnimationFrame(frame)
    frame = 0
    recording = true
    controls.enabled = false
    const target = controls.target.clone()
    const start = camera.position.clone()
    const offset = start.clone().sub(target)
    const frames = Math.round(seconds * fps)
    recorder.start()
    try {
      for (let index = 0; index <= frames; index += 1) {
        const angle = (index / frames) * Math.PI * 2
        camera.position.copy(target).add(offset.clone().applyAxisAngle(camera.up, angle))
        camera.lookAt(target)
        beforeRender?.(camera, size)
        renderer.render(scene, camera)
        track.requestFrame?.()
        onProgress?.(index / frames)
        await new Promise((resolve) => window.setTimeout(resolve, 1000 / fps))
      }
    } finally {
      recorder.stop()
      track.stop()
      recording = false
      camera.position.copy(start)
      controls.enabled = true
      controls.update()
      invalidate()
    }
    await stopped
    return { blob: new Blob(chunks, { type: mimeType }), extension: mimeType.startsWith('video/mp4') ? 'mp4' : 'webm' }
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

  return { renderer, camera, controls, scene, size, invalidate, settle, moveTo, screenOf, subscribe, picture, canRecord, record, dispose }
}
