/**
 * SpaceView.jsx — a star system in three dimensions, drawn by three.js. Loaded only
 * when a system is shown in 3D.
 *
 * It owns the renderer, the camera and its controls (drag to orbit, scroll or pinch
 * to zoom, right-drag or ⇧-drag to pan), and the scene (systemScene.js). Places,
 * names and handles are the surface's SVG overlay, drawn through the projector the
 * view hands back (useSpaceView.js).
 *
 * It draws only when something changes — the camera, the day, the system, the size
 * — never in a loop, and gives everything back to the GPU when it goes.
 */
import { useEffect, useRef } from 'react'
import { ACESFilmicToneMapping, Color, PerspectiveCamera, Plane, Raycaster, Scene, Vector2, Vector3, WebGLRenderer } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { seedOf } from '../../lib/map/seeded'
import { CINEMATIC } from '../../lib/map/spacePalette'
import { createBackdrop } from './backdrop'
import { createSystemScene } from './systemScene'
import { readSpaceCamera, sceneToSystem, systemToScene } from './spaceMath'

const SETTLE_MS = 250
const MAX_PIXEL_RATIO = 2

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export default function SpaceView({ view, map, space, day, focusBody, skySeed, onError }) {
  const containerRef = useRef(null)
  const stateRef = useRef(null)
  const dayRef = useRef(day)
  const followRef = useRef(null)
  // A camera saved with the map means it is shown as it was left; otherwise it is framed.
  const framedRef = useRef(Boolean(view.cameraRef.current?.target))

  /* ---------------- the renderer, camera and controls ---------------- */

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined
    let renderer
    try {
      renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true })
    } catch (error) {
      console.error('[map] the 3D view could not start:', error)
      onError?.(error)
      return undefined
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO))
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.setClearColor(new Color(CINEMATIC.background), 1)
    renderer.domElement.className = 'map-space-canvas'
    container.appendChild(renderer.domElement)

    const saved = readSpaceCamera(view.cameraRef.current)
    const camera = new PerspectiveCamera(saved.fov, 1, 1e-6, 1e7)
    camera.position.set(...saved.position)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(...saved.target)
    controls.enableDamping = !reducedMotion()
    controls.dampingFactor = 0.12
    controls.zoomSpeed = 1.2
    controls.screenSpacePanning = true
    controls.minDistance = 1e-5
    controls.maxDistance = 1e5
    controls.update()

    const scene = new Scene()
    const backdrop = createBackdrop(seedOf(skySeed), { pixelRatio: renderer.getPixelRatio() })
    scene.add(backdrop.object)

    const size = { width: 1, height: 1 }
    const listeners = { frame: null, settle: null }
    let frame = 0
    let settleTimer = 0
    let disposed = false

    const snapshot = () => ({
      position: camera.position.toArray(),
      target: controls.target.toArray(),
      fov: camera.fov,
      ortho: false,
      distance: camera.position.distanceTo(controls.target),
    })

    const draw = () => {
      frame = 0
      if (disposed) return
      const moving = controls.update()
      backdrop.follow(camera)
      stateRef.current?.content?.beforeRender(camera, size.height)
      renderer.render(scene, camera)
      listeners.frame?.({ camera: snapshot(), width: size.width, height: size.height })
      if (moving) invalidate()
    }
    const invalidate = () => {
      if (!frame && !disposed) frame = requestAnimationFrame(draw)
    }
    const settle = () => {
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => listeners.settle?.(snapshot()), SETTLE_MS)
    }
    controls.addEventListener('change', () => {
      invalidate()
      settle()
    })

    const resize = () => {
      const width = container.clientWidth || 1
      const height = container.clientHeight || 1
      size.width = width
      size.height = height
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      invalidate()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    resize()

    const onLost = (event) => {
      event.preventDefault()
      onError?.(new Error('The graphics context was lost.'))
    }
    renderer.domElement.addEventListener('webglcontextlost', onLost)

    /* ---- moving the camera on request: a short glide, or a cut ---- */
    let glide = 0
    const moveTo = (target, position) => {
      cancelAnimationFrame(glide)
      const fromTarget = controls.target.clone()
      const fromPosition = camera.position.clone()
      if (reducedMotion()) {
        controls.target.copy(target)
        camera.position.copy(position)
        controls.update()
        invalidate()
        settle()
        return
      }
      const start = performance.now()
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / 600)
        const ease = 1 - (1 - t) ** 3
        controls.target.lerpVectors(fromTarget, target, ease)
        camera.position.lerpVectors(fromPosition, position, ease)
        controls.update()
        invalidate()
        if (t < 1) glide = requestAnimationFrame(step)
        else settle()
      }
      glide = requestAnimationFrame(step)
    }

    const content = () => stateRef.current?.content
    const toWorld = (point) => {
      const scene3 = content()
      if (!scene3) return null
      const local = new Vector3(...systemToScene(point, map.system.display))
      return scene3.plane.localToWorld(local)
    }
    const screenOf = (world) => {
      const ndc = world.clone().project(camera)
      if (ndc.z > 1 || ndc.z < -1) return null
      return [((ndc.x + 1) / 2) * size.width, ((1 - ndc.y) / 2) * size.height]
    }
    const raycaster = new Raycaster()
    const api = {
      project: (point) => {
        const world = toWorld(point)
        return world ? screenOf(world) : null
      },
      unproject: (x, y) => {
        const scene3 = content()
        if (!scene3) return null
        raycaster.setFromCamera(new Vector2((x / size.width) * 2 - 1, -(y / size.height) * 2 + 1), camera)
        scene3.plane.updateMatrixWorld()
        const normal = new Vector3(0, 1, 0).transformDirection(scene3.plane.matrixWorld)
        const floor = new Plane().setFromNormalAndCoplanarPoint(normal, scene3.plane.getWorldPosition(new Vector3()))
        const hit = raycaster.ray.intersectPlane(floor, new Vector3())
        if (!hit) return null
        const local = scene3.plane.worldToLocal(hit)
        const point = sceneToSystem([local.x, local.y, local.z], map.system.display)
        return [point[0], point[1]]
      },
      fit: (points) => {
        const scene3 = content()
        if (!scene3) return
        const worlds = points.length
          ? points.map(toWorld).filter(Boolean)
          : scene3.hitList().map((entry) => entry.object.getWorldPosition(new Vector3()))
        if (!worlds.length) worlds.push(new Vector3())
        const centre = worlds.reduce((sum, point) => sum.add(point), new Vector3()).divideScalar(worlds.length)
        const radius = Math.max(0.05, ...worlds.map((point) => point.distanceTo(centre)))
        const distance = (radius / Math.sin(((camera.fov * Math.PI) / 180) / 2)) * 1.1
        const direction = camera.position.clone().sub(controls.target)
        if (direction.lengthSq() < 1e-12) direction.set(0, 0.55, 0.83)
        direction.normalize()
        moveTo(centre, centre.clone().addScaledVector(direction, distance))
      },
      centerOn: (point) => {
        const world = toWorld(point)
        if (!world) return
        const offset = camera.position.clone().sub(controls.target)
        moveTo(world, world.clone().add(offset))
      },
      dolly: (factor) => {
        const offset = camera.position.clone().sub(controls.target).multiplyScalar(factor)
        moveTo(controls.target.clone(), controls.target.clone().add(offset))
      },
      lock: (locked) => {
        controls.enabled = !locked
      },
      pick: (x, y) => {
        const scene3 = content()
        if (!scene3) return null
        let best = null
        for (const entry of scene3.hitList()) {
          const world = entry.object.getWorldPosition(new Vector3())
          const at = screenOf(world)
          if (!at) continue
          const edge = screenOf(world.clone().add(camera.up.clone().multiplyScalar(entry.radius)))
          const radiusPx = Math.max(10, edge ? Math.hypot(edge[0] - at[0], edge[1] - at[1]) : 0)
          const distance = Math.hypot(at[0] - x, at[1] - y)
          if (distance <= radiusPx && (!best || distance < best.distance)) best = { id: entry.id, distance }
        }
        return best ? { kind: 'body', id: best.id } : null
      },
      subscribe: (onFrame, onSettle) => {
        listeners.frame = onFrame
        listeners.settle = onSettle
        invalidate()
        return () => {
          listeners.frame = null
          listeners.settle = null
        }
      },
    }

    stateRef.current = { renderer, camera, controls, scene, invalidate, content: null, moveTo, fit: api.fit }
    const detach = view.attach(api)

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      cancelAnimationFrame(glide)
      window.clearTimeout(settleTimer)
      observer.disconnect()
      detach?.()
      view.attach(null)
      renderer.domElement.removeEventListener('webglcontextlost', onLost)
      stateRef.current?.content?.dispose()
      backdrop.dispose()
      controls.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      stateRef.current = null
    }
    // One renderer per mounted view; the camera and the attach are read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------- the scene: rebuilt when the system changes ---------------- */

  useEffect(() => {
    const state = stateRef.current
    if (!state) return undefined
    const content = createSystemScene(map, space, { colors: CINEMATIC })
    state.scene.add(content.root)
    state.content = content
    content.setDay(dayRef.current)
    if (!framedRef.current) {
      framedRef.current = true
      state.fit([])
    }
    state.invalidate()
    return () => {
      state.scene.remove(content.root)
      content.dispose()
      if (state.content === content) state.content = null
    }
    // The scene is the system's: its bodies, plane and display (space follows the system).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map.system, space])

  /* ---------------- the day, and the body the camera follows ---------------- */

  useEffect(() => {
    dayRef.current = day
    const state = stateRef.current
    if (!state?.content) return
    state.content.setDay(day)
    if (focusBody) {
      const at = state.content.bodyAt(focusBody)
      if (at) {
        const world = state.content.plane.localToWorld(at.clone())
        if (followRef.current?.id === focusBody) {
          const delta = world.clone().sub(followRef.current.at)
          state.camera.position.add(delta)
          state.controls.target.add(delta)
        } else {
          const offset = state.camera.position.clone().sub(state.controls.target)
          state.moveTo(world, world.clone().add(offset))
        }
        followRef.current = { id: focusBody, at: world }
      }
    } else {
      followRef.current = null
    }
    state.invalidate()
  }, [day, focusBody, map.system])

  return <div ref={containerRef} className="map-space" aria-hidden="true" />
}
