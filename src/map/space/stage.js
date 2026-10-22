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
 * The Cinematic look adds bloom: a glow round what is brighter than white (stars,
 * cores, jets), drawn at half size. A governor watches how long frames take while
 * the view moves, and if they are slow it steps quality down — bloom off first,
 * then fewer pixels — never the frame rate. It does not step back up while the
 * view is open, so it never see-saws.
 *
 * The space view (systems) and the planet view (one world) build on it; each adds
 * its own scene and the projector API the map surface talks to.
 */
import { ACESFilmicToneMapping, Color, PerspectiveCamera, Scene, Vector2, Vector3, WebGLRenderer } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { CAMERA_ANGLES, DEFAULT_SPACE_CAMERA, FLAT_FOV } from './spaceMath'

const SETTLE_MS = 250
const MAX_PIXEL_RATIO = 2
/** Bloom: how strong, how wide, and how bright a pixel must be to glow. */
const BLOOM = { strength: 0.55, radius: 0.35, threshold: 0.82 }
/** A frame slower than this while moving (about 40 a second) is slow. */
const FRAME_BUDGET_MS = 25
/** Frames in a row the governor looks at before it judges. */
const GOVERNOR_FRAMES = 24
/** The steps down, best first: bloom allowed, and the most pixels per CSS pixel. */
export const QUALITY_STEPS = [
  { bloom: true, pixelRatio: MAX_PIXEL_RATIO },
  { bloom: false, pixelRatio: MAX_PIXEL_RATIO },
  { bloom: false, pixelRatio: 1.5 },
  { bloom: false, pixelRatio: 1 },
]

/**
 * The governor's judgement: given the last frames' times (ms) and the step it is
 * at, the step to be at. Slow on the whole (the median over budget) steps down
 * one; it never steps up.
 */
export function governQuality(times, step) {
  if (times.length < GOVERNOR_FRAMES || step >= QUALITY_STEPS.length - 1) return step
  const sorted = [...times].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] > FRAME_BUDGET_MS ? step + 1 : step
}

export const reducedMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

/**
 * Set up a stage in `container`, the camera where `saved` says. Throws if WebGL is
 * not available. `beforeRender(camera, size)` runs before each frame. Under bloom
 * the sky is cleared to `bloomBackground`, which comes out as `background`.
 */
export function createStage(container, { saved, background, bloomBackground = null, near = 1e-6, far = 1e7, beforeRender, bloom = false }) {
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true })
  // The governor's step (QUALITY_STEPS) and whether the look wants bloom.
  let quality = 0
  let wantsBloom = bloom
  const screenRatio = () => Math.min(window.devicePixelRatio || 1, QUALITY_STEPS[quality].pixelRatio)
  renderer.setPixelRatio(screenRatio())
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

  // Flat (orthographic, as a telephoto: spaceMath FLAT_FOV) and the angle held still.
  let ortho = Boolean(saved.ortho)
  let locked = Boolean(saved.locked)
  // The field of view to come back to from flat.
  const roundFov = saved.ortho ? DEFAULT_SPACE_CAMERA.fov : saved.fov
  controls.enableRotate = !locked

  const snapshot = () => ({
    position: camera.position.toArray(),
    target: controls.target.toArray(),
    fov: camera.fov,
    ortho,
    locked,
    distance: camera.position.distanceTo(controls.target),
  })

  // Bloom is a chain of passes made the first time it is wanted, at half size.
  let composer = null
  let bloomPass = null
  const glowing = () => wantsBloom && QUALITY_STEPS[quality].bloom
  function ensureComposer() {
    if (composer) return composer
    composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera, null, new Color(bloomBackground || background), 1))
    bloomPass = new UnrealBloomPass(new Vector2(size.width / 2, size.height / 2), BLOOM.strength, BLOOM.radius, BLOOM.threshold)
    composer.addPass(bloomPass)
    composer.addPass(new OutputPass())
    sizeComposer()
    return composer
  }
  function sizeComposer() {
    if (!composer) return
    composer.setPixelRatio(renderer.getPixelRatio())
    composer.setSize(size.width, size.height)
    bloomPass.resolution.set(size.width / 2, size.height / 2)
  }
  /** One frame, with bloom when the look and the governor allow it. */
  function render() {
    if (glowing()) ensureComposer().render()
    else renderer.render(scene, camera)
  }

  // Frame times while the view is moving: a frame that follows straight on from the
  // last (the controls still settling) is how fast the view can go.
  const times = []
  let lastDraw = 0
  let chained = false
  function govern(now) {
    if (chained && lastDraw) times.push(now - lastDraw)
    if (times.length > GOVERNOR_FRAMES) times.shift()
    const next = governQuality(times, quality)
    if (next === quality) return
    quality = next
    times.length = 0
    renderer.setPixelRatio(screenRatio())
    renderer.setSize(size.width, size.height, false)
    sizeComposer()
  }

  function draw(now = performance.now()) {
    frame = 0
    if (disposed || recording) return
    govern(now)
    const moving = controls.update()
    beforeRender?.(camera, size)
    render()
    listeners.frame?.({ camera: snapshot(), width: size.width, height: size.height })
    lastDraw = now
    chained = moving
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
    sizeComposer()
    camera.aspect = size.width / size.height
    camera.updateProjectionMatrix()
  }
  // A new size is drawn at once, not on the next frame: resizing the canvas clears
  // it, and the observer runs before the browser paints, so waiting shows a blank frame.
  const observer = new ResizeObserver(() => {
    if (container.clientWidth === size.width && container.clientHeight === size.height) return
    resize()
    if (disposed || recording) return
    cancelAnimationFrame(frame)
    draw()
  })
  observer.observe(container)
  resize()
  invalidate()

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

  /** Look from a preset angle (`CAMERA_ANGLES`: face-on, edge-on, three-quarter), as far away. */
  function setAngle(name) {
    const direction = CAMERA_ANGLES[name]
    if (!direction) return
    const target = controls.target.clone()
    const distance = camera.position.distanceTo(target)
    moveTo(target, target.clone().add(new Vector3(...direction).normalize().multiplyScalar(distance)))
  }

  /**
   * Flat or in depth: a dolly zoom, the camera backing away as the lens narrows (or
   * coming in as it widens), so what is in the middle stays the same size.
   */
  function setOrtho(on) {
    if (on === ortho) return
    ortho = on
    const target = controls.target.clone()
    const direction = camera.position.clone().sub(target)
    const fromDistance = direction.length()
    direction.normalize()
    const fromFov = camera.fov
    const toFov = on ? FLAT_FOV : roundFov
    const half = (fov) => Math.tan((fov * Math.PI) / 360)
    const toDistance = (fromDistance * half(fromFov)) / half(toFov)
    const apply = (t) => {
      const fov = fromFov + (toFov - fromFov) * t
      camera.fov = fov
      camera.updateProjectionMatrix()
      // Keep the target the same size on screen at every step of the way.
      camera.position.copy(target).addScaledVector(direction, (fromDistance * half(fromFov)) / half(fov))
    }
    cancelAnimationFrame(glide)
    if (reducedMotion()) {
      apply(1)
      camera.position.copy(target).addScaledVector(direction, toDistance)
      controls.update()
      invalidate()
      settle()
      return
    }
    const start = performance.now()
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / 700)
      apply(1 - (1 - t) ** 3)
      controls.update()
      invalidate()
      if (t < 1) glide = requestAnimationFrame(step)
      else settle()
    }
    glide = requestAnimationFrame(step)
  }

  /** Hold the angle (only pan and zoom), or let it turn again. */
  function setLocked(on) {
    locked = on
    controls.enableRotate = !on
    invalidate()
    settle()
  }

  /** Bloom on or off (the Cinematic look has it); the governor may still hold it off. */
  function setBloom(on) {
    if (wantsBloom === on) return
    wantsBloom = on
    invalidate()
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
  function picture(scale = 1, { filter = null } = {}) {
    const ratio = renderer.getPixelRatio()
    renderer.setPixelRatio(scale)
    renderer.setSize(size.width, size.height, false)
    sizeComposer()
    beforeRender?.(camera, size)
    // An export is drawn at its best, whatever the governor chose for the screen.
    if (wantsBloom) ensureComposer().render()
    else renderer.render(scene, camera)
    const out = document.createElement('canvas')
    out.width = renderer.domElement.width
    out.height = renderer.domElement.height
    const context = out.getContext('2d')
    // The look's filter (Atlas, Ink), as the screen shows it.
    if (filter) context.filter = filter
    context.drawImage(renderer.domElement, 0, 0)
    renderer.setPixelRatio(ratio)
    renderer.setSize(size.width, size.height, false)
    sizeComposer()
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
        if (wantsBloom) ensureComposer().render()
        else renderer.render(scene, camera)
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
    composer?.dispose()
    bloomPass?.dispose()
    renderer.dispose()
    renderer.domElement.remove()
  }

  return { renderer, camera, controls, scene, size, invalidate, settle, moveTo, setAngle, setOrtho, setLocked, setBloom, quality: () => quality, screenOf, subscribe, picture, canRecord, record, dispose }
}
