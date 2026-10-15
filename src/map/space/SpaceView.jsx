/**
 * SpaceView.jsx — a star system, a galaxy or a group of galaxies in three
 * dimensions, drawn by three.js. Loaded only when one is shown in 3D.
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
import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import { seedOf } from '../../lib/map/seeded'
import { CINEMATIC } from '../../lib/map/spacePalette'
import { createBackdrop } from './backdrop'
import { createSystemScene } from './systemScene'
import { createGalaxyScene } from './galaxyScene'
import { createModelScene } from './modelScene'
import { readSpaceCamera } from './spaceMath'
import { createStage } from './stage'

export default function SpaceView({ view, map, space, day, focusBody, skySeed, projectName, lookAround = false, onError, onProblem }) {
  const containerRef = useRef(null)
  const stateRef = useRef(null)
  const dayRef = useRef(day)
  const followRef = useRef(null)

  /* ---------------- the stage, and the API the surface talks to ---------------- */

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined
    let stage
    let backdrop
    try {
      stage = createStage(container, {
        saved: readSpaceCamera(view.cameraRef.current),
        background: CINEMATIC.background,
        beforeRender: (camera, size) => {
          backdrop?.follow(camera)
          stateRef.current?.content?.beforeRender(camera, size.height)
        },
      })
    } catch (error) {
      console.error('[map] the 3D view could not start:', error)
      onError?.(error)
      return undefined
    }
    const { camera, controls, renderer, size } = stage
    controls.minDistance = 1e-5
    controls.maxDistance = 1e5
    backdrop = createBackdrop(seedOf(skySeed), { pixelRatio: renderer.getPixelRatio() })
    stage.scene.add(backdrop.object)
    const onLost = (event) => {
      event.preventDefault()
      onError?.(new Error('The graphics context was lost.'))
    }
    renderer.domElement.addEventListener('webglcontextlost', onLost)

    const content = () => stateRef.current?.content
    const toWorld = (point) => {
      const scene3 = content()
      if (!scene3) return null
      return scene3.plane.localToWorld(new Vector3(...scene3.toScene(point)))
    }
    const raycaster = new Raycaster()
    const api = {
      project: (point) => {
        const world = toWorld(point)
        return world ? stage.screenOf(world) : null
      },
      unproject: (x, y) => {
        const scene3 = content()
        if (!scene3) return null
        raycaster.setFromCamera(new Vector2((x / size.width) * 2 - 1, -(y / size.height) * 2 + 1), camera)
        scene3.plane.updateMatrixWorld()
        // A model is clicked on its surface; everything else on its plane.
        if (scene3.raycast) return scene3.raycast(raycaster)
        const normal = new Vector3(0, 1, 0).transformDirection(scene3.plane.matrixWorld)
        const floor = new Plane().setFromNormalAndCoplanarPoint(normal, scene3.plane.getWorldPosition(new Vector3()))
        const hit = raycaster.ray.intersectPlane(floor, new Vector3())
        if (!hit) return null
        const local = scene3.plane.worldToLocal(hit)
        const point = scene3.fromScene([local.x, local.y, local.z])
        return [point[0], point[1]]
      },
      fit: (points) => {
        const scene3 = content()
        if (!scene3) return
        const worlds = points.length
          ? points.map(toWorld).filter(Boolean)
          : scene3.hitList().map((entry) => entry.object.getWorldPosition(new Vector3()))
        let centre
        let radius
        if (scene3.extent) {
          // A galaxy or a group: the whole of it, and any place set out beyond it.
          ;({ centre, radius } = scene3.extent())
          for (const point of worlds) radius = Math.max(radius, point.distanceTo(centre) * 1.05)
        } else {
          if (!worlds.length) worlds.push(new Vector3())
          centre = worlds.reduce((sum, point) => sum.add(point), new Vector3()).divideScalar(worlds.length)
          radius = Math.max(0.05, ...worlds.map((point) => point.distanceTo(centre)))
        }
        const distance = (radius / Math.sin(((camera.fov * Math.PI) / 180) / 2)) * 1.1
        const direction = camera.position.clone().sub(controls.target)
        if (direction.lengthSq() < 1e-12) direction.set(0, 0.55, 0.83)
        direction.normalize()
        stage.moveTo(centre, centre.clone().addScaledVector(direction, distance))
      },
      centerOn: (point) => {
        const world = toWorld(point)
        if (!world) return
        const offset = camera.position.clone().sub(controls.target)
        stage.moveTo(world, world.clone().add(offset))
      },
      dolly: (factor) => {
        const offset = camera.position.clone().sub(controls.target).multiplyScalar(factor)
        stage.moveTo(controls.target.clone(), controls.target.clone().add(offset))
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
          const at = stage.screenOf(world)
          if (!at) continue
          const edge = stage.screenOf(world.clone().add(camera.up.clone().multiplyScalar(entry.radius)))
          const radiusPx = Math.max(10, edge ? Math.hypot(edge[0] - at[0], edge[1] - at[1]) : 0)
          const distance = Math.hypot(at[0] - x, at[1] - y)
          if (distance <= radiusPx && (!best || distance < best.distance)) best = { id: entry.id, distance }
        }
        return best ? { kind: 'body', id: best.id } : null
      },
      /** Glide to a saved camera: `{ position, target }` in scene units. */
      goTo: (saved) => stage.moveTo(new Vector3(...saved.target), new Vector3(...saved.position)),
      subscribe: stage.subscribe,
    }

    stateRef.current = { stage, content: null, fit: api.fit }
    const detach = view.attach(api)

    return () => {
      detach?.()
      view.attach(null)
      renderer.domElement.removeEventListener('webglcontextlost', onLost)
      stateRef.current?.content?.dispose()
      backdrop.dispose()
      stage.dispose()
      stateRef.current = null
    }
    // One stage per mounted view; the camera and the attach are read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------- the scene: rebuilt when the system changes ---------------- */

  useEffect(() => {
    const state = stateRef.current
    if (!state) return undefined
    const content = map.mapKind === 'system'
      ? createSystemScene(map, space, { colors: CINEMATIC })
      : map.mapKind === 'model'
        ? createModelScene(map, {
            projectName,
            renderer: state.stage.renderer,
            scene: state.stage.scene,
            onLoaded: () => {
              // Framed once it is in, unless the map remembers where it was looked at from.
              if (!view.cameraRef.current?.target) state.fit?.([])
              state.stage.invalidate()
            },
            onError: (message) => onProblem?.(message),
          })
        : createGalaxyScene(map, { colors: CINEMATIC })
    state.stage.scene.add(content.root)
    state.content = content
    content.setDay(dayRef.current)
    state.stage.invalidate()
    return () => {
      state.stage.scene.remove(content.root)
      content.dispose()
      if (state.content === content) state.content = null
    }
    // The scene is the system's: its bodies, plane and display (space follows the system).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map.mapKind, map.system, map.galaxy, map.universe, map.model, map.mapKind === 'universe' ? map.pins : null, space])

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
        const { camera, controls } = state.stage
        if (followRef.current?.id === focusBody) {
          const delta = world.clone().sub(followRef.current.at)
          camera.position.add(delta)
          controls.target.add(delta)
        } else {
          const offset = camera.position.clone().sub(controls.target)
          state.stage.moveTo(world, world.clone().add(offset))
        }
        followRef.current = { id: focusBody, at: world }
      }
    } else {
      followRef.current = null
    }
    state.stage.invalidate()
  }, [day, focusBody, map.system, map.galaxy, map.universe])

  /* ---------------- looking around: turn in place, walk with the keys ---------------- */

  useEffect(() => {
    const state = stateRef.current
    if (!state || !lookAround) return undefined
    const { camera, controls } = state.stage
    const saved = { target: controls.target.clone(), rotateSpeed: controls.rotateSpeed, enableZoom: controls.enableZoom }
    // Orbit a point just in front of the eye: dragging turns the view where you stand.
    const ahead = () => controls.target.clone().sub(camera.position).normalize()
    const reach = Math.max(1e-4, camera.position.distanceTo(controls.target) * 0.002)
    const facing = ahead()
    controls.target.copy(camera.position).addScaledVector(facing, reach)
    controls.rotateSpeed = -0.35
    controls.enableZoom = false
    controls.update()
    const held = new Set()
    let frame = 0
    const scale = state.content?.extent?.().radius || 1
    const walk = () => {
      frame = 0
      if (!held.size) return
      const forward = ahead()
      const right = new Vector3().crossVectors(forward, camera.up).normalize()
      const step = new Vector3()
      if (held.has('w') || held.has('arrowup')) step.add(forward)
      if (held.has('s') || held.has('arrowdown')) step.sub(forward)
      if (held.has('d') || held.has('arrowright')) step.add(right)
      if (held.has('a') || held.has('arrowleft')) step.sub(right)
      if (held.has('e')) step.add(camera.up)
      if (held.has('q')) step.sub(camera.up)
      step.multiplyScalar(scale * 0.006 * (held.has('shift') ? 4 : 1))
      camera.position.add(step)
      controls.target.add(step)
      controls.update()
      state.stage.invalidate()
      state.stage.settle()
      frame = requestAnimationFrame(walk)
    }
    const typing = (event) => event.target?.closest?.('input, textarea, [contenteditable="true"]')
    const onDown = (event) => {
      if (typing(event) || event.metaKey || event.ctrlKey) return
      const key = event.key.toLowerCase()
      if (!['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) return
      event.preventDefault()
      held.add(key)
      if (!frame) frame = requestAnimationFrame(walk)
    }
    const onUp = (event) => held.delete(event.key.toLowerCase())
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', () => held.clear())
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      controls.rotateSpeed = saved.rotateSpeed
      controls.enableZoom = saved.enableZoom
      // Step back out to orbiting what is in front of you.
      const facingNow = ahead()
      controls.target.copy(camera.position).addScaledVector(facingNow, Math.max(camera.position.distanceTo(saved.target), scale * 0.5))
      controls.update()
      state.stage.invalidate()
    }
  }, [lookAround])

  return <div ref={containerRef} className="map-space" aria-hidden="true" />
}
