/**
 * PlanetView.jsx — a planet or a star as a globe you can turn and zoom down to,
 * drawn by three.js. Loaded only when a planet map is open.
 *
 * The world's surface is generated from its look (planetSurface.js, in a worker),
 * or a picture the writer gave it, or — for a star — the star's own shader. Regions
 * and routes are painted on a second, transparent skin just above it
 * (planetOverlay.js); places, labels and handles are the surface's SVG overlay,
 * drawn through the projector this view hands back (useSpaceView.js), hidden round
 * the far side.
 *
 * Sunlight follows the story: the day turns the world, and its axial tilt and year
 * bring the seasons (`surface.daylight` off lights it evenly instead). It draws
 * only when something changes.
 */
import { useEffect, useRef } from 'react'
import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  CanvasTexture,
  Color,
  DataTexture,
  DirectionalLight,
  Group,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  RedFormat,
  RGBAFormat,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
} from 'three'
import { assetUrl } from '../../lib/assets'
import { CINEMATIC, WORLD_PARTS } from '../../lib/map/spacePalette'
import { overlayColors, paintOverlay } from '../../lib/map/planetOverlay'
import { GAS_PALETTES } from '../../lib/map/planetTexture'
import { isItemShown } from '../../lib/map/mapVisibility'
import { measuredLine, routeCoords } from '../../lib/map/mapSpace'
import { pointInRegion } from '../../lib/map/mapGeometry'
import { seedOf } from '../../lib/map/seeded'
import { createBackdrop } from './backdrop'
import { SPHERE_VERTEX } from './glsl'
import { drawSurface, regionMask } from './planetSurface'
import { createStage } from './stage'
import { createStar } from './starMeshes'
import { lonLatToUnit, readSpaceCamera, subsolarPoint, unitToLonLat } from './spaceMath'

/** A quick draft of the surface first, then the full one. */
const SURFACE_SIZES = [{ width: 512, height: 256 }, { width: 2048, height: 1024 }]
const OVERLAY_SIZE = { width: 2048, height: 1024 }
/** Closest the camera comes, as height above the surface in world radii. */
const MIN_ALTITUDE = 0.0006
const MAX_ALTITUDE = 30
const DEFAULT_CAMERA = { position: [0, 0.9, 3.1], target: [0, 0, 0], fov: 35, ortho: false }

const lonLatToDirection = (point) => new Vector3(...lonLatToUnit(point))
const directionToLonLat = (direction) => unitToLonLat(direction.clone().normalize().toArray())

const RIM_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying vec3 vDir;
varying vec3 vViewNormal;
varying vec3 vViewPos;
void main() {
  float rim = 1.0 - abs(dot(normalize(vViewNormal), normalize(-vViewPos)));
  gl_FragColor = vec4(uColor, pow(rim, 3.5) * 0.9);
}
`

export default function PlanetView({ view, map, space, day, selection, projectName, skySeed, surfaceRef, onError }) {
  const containerRef = useRef(null)
  const stateRef = useRef(null)
  const { surface } = map
  const look = surface.look
  const isStar = look.kind === 'star'

  /* ---------------- the stage, the world and the API ---------------- */

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined
    let stage
    let backdrop
    const saved = view.cameraRef.current?.target ? readSpaceCamera(view.cameraRef.current) : { ...DEFAULT_CAMERA }
    try {
      stage = createStage(container, {
        saved,
        background: CINEMATIC.background,
        near: 1e-5,
        far: 5000,
        beforeRender: (camera) => {
          backdrop?.follow(camera)
          if (stateRef.current?.headlight) stateRef.current.headlight.position.copy(camera.position)
        },
      })
    } catch (error) {
      console.error('[map] the planet view could not start:', error)
      onError?.(error)
      return undefined
    }
    const { camera, controls, renderer, size } = stage
    // Turning the world, never sliding it about: zoom is the view's own (below).
    controls.enablePan = false
    controls.enableZoom = false
    controls.minDistance = 1 + MIN_ALTITUDE
    controls.maxDistance = 1 + MAX_ALTITUDE
    backdrop = createBackdrop(seedOf(skySeed), { pixelRatio: renderer.getPixelRatio() })
    stage.scene.add(backdrop.object)

    const world = new Group()
    stage.scene.add(world)
    const sphere = new SphereGeometry(1, 128, 64)
    const owned = [sphere]
    const ambient = new AmbientLight(0xffffff, 0.16)
    const sun = new DirectionalLight(0xffffff, 2.4)
    const headlight = new DirectionalLight(0xffffff, 0)
    stage.scene.add(ambient, sun, headlight)

    // The skin regions and routes are painted on, a hair above the ground.
    const overlayCanvas = document.createElement('canvas')
    overlayCanvas.width = OVERLAY_SIZE.width
    overlayCanvas.height = OVERLAY_SIZE.height
    const overlayTexture = new CanvasTexture(overlayCanvas)
    overlayTexture.colorSpace = SRGBColorSpace
    overlayTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
    const overlayMaterial = new MeshStandardMaterial({ map: overlayTexture, transparent: true, depthWrite: false, roughness: 1 })
    const overlay = new Mesh(sphere, overlayMaterial)
    overlay.scale.setScalar(1.0008)
    overlay.renderOrder = 3
    world.add(overlay)
    owned.push(overlayTexture, overlayMaterial)

    // How fast a drag turns the world: slower the closer you are to the ground.
    const tuneControls = () => {
      const altitude = camera.position.length() - 1
      controls.rotateSpeed = Math.max(0.02, Math.min(0.9, altitude * 0.45))
    }
    controls.addEventListener('change', tuneControls)
    tuneControls()

    // Zoom by altitude, so the last mile is as smooth as the first thousand.
    const onWheel = (event) => {
      event.preventDefault()
      const altitude = camera.position.length() - 1
      const next = Math.max(MIN_ALTITUDE, Math.min(MAX_ALTITUDE, altitude * Math.exp(event.deltaY * (event.ctrlKey ? 0.01 : 0.0018))))
      camera.position.setLength(1 + next)
      controls.update()
      stage.invalidate()
      stage.settle()
    }
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false })
    const onLost = (event) => {
      event.preventDefault()
      onError?.(new Error('The graphics context was lost.'))
    }
    renderer.domElement.addEventListener('webglcontextlost', onLost)

    const visible = (direction) => {
      // Round the far side when the surface faces away from the camera.
      const normal = world.localToWorld(direction.clone()).normalize()
      return normal.dot(camera.position.clone().sub(normal)) > 0
    }
    const hitSphere = (x, y) => {
      const ndc = new Vector2((x / size.width) * 2 - 1, -(y / size.height) * 2 + 1)
      const origin = camera.position.clone()
      const direction = new Vector3(ndc.x, ndc.y, 0.5).unproject(camera).sub(origin).normalize()
      // |origin + t·direction| = 1
      const b = origin.dot(direction)
      const c = origin.lengthSq() - 1
      const discriminant = b * b - c
      if (discriminant < 0) return null
      const t = -b - Math.sqrt(discriminant)
      if (t < 0) return null
      return world.worldToLocal(origin.addScaledVector(direction, t))
    }
    const lookAt = (direction, altitude) => {
      const height = 1 + (altitude ?? camera.position.length() - 1)
      const target = new Vector3()
      stage.moveTo(target, direction.clone().normalize().multiplyScalar(height))
    }

    const api = {
      project: (point) => {
        const direction = lonLatToDirection(point)
        if (!visible(direction)) return null
        return stage.screenOf(world.localToWorld(direction))
      },
      unproject: (x, y) => {
        const hit = hitSphere(x, y)
        return hit ? directionToLonLat(hit) : null
      },
      fit: (points) => {
        if (!points.length) {
          lookAt(camera.position.lengthSq() > 0 ? camera.position : new Vector3(0, 0.3, 1), 2.2)
          return
        }
        const directions = points.map(lonLatToDirection)
        const centre = directions.reduce((sum, d) => sum.add(d), new Vector3())
        if (centre.lengthSq() < 1e-9) {
          lookAt(camera.position, 2.2)
          return
        }
        centre.normalize()
        const spread = Math.max(...directions.map((d) => d.angleTo(centre)))
        // Far enough to see the spread, with room round it.
        const altitude = Math.max(0.02, Math.min(2.2, spread * 1.9))
        lookAt(centre, altitude)
      },
      centerOn: (point) => lookAt(lonLatToDirection(point)),
      dolly: (factor) => {
        const altitude = camera.position.length() - 1
        const next = Math.max(MIN_ALTITUDE, Math.min(MAX_ALTITUDE, altitude * factor))
        lookAt(camera.position, next)
      },
      lock: (locked) => {
        controls.enabled = !locked
      },
      pick: (x, y) => {
        const state = stateRef.current
        const hit = hitSphere(x, y)
        if (!hit || !state) return null
        const at = directionToLonLat(hit)
        const { map: current, day: currentDay } = state.inputs
        // A route within a few pixels, then the region underneath.
        let best = null
        for (const route of current.routes) {
          if (!isItemShown(current, route, currentDay)) continue
          const line = state.routeLines?.get(route.id) || []
          for (let index = 1; index < line.length; index += 1) {
            const a = api.project(line[index - 1])
            const b = api.project(line[index])
            if (!a || !b) continue
            const distance = distanceToSegment([x, y], a, b)
            if (distance < 8 && (!best || distance < best.distance)) best = { kind: 'route', id: route.id, distance }
          }
        }
        if (best) return { kind: best.kind, id: best.id }
        for (let index = current.regions.length - 1; index >= 0; index -= 1) {
          const region = current.regions[index]
          if (!isItemShown(current, region, currentDay)) continue
          if (region.rings.some((ring) => pointInRegion(unwrappedNear(ring, at[0]), at))) return { kind: 'region', id: region.id }
        }
        return null
      },
      /** Glide to a saved camera: `{ position, target }` in scene units. */
      goTo: (saved) => stage.moveTo(new Vector3(...saved.target), new Vector3(...saved.position)),
      subscribe: stage.subscribe,
    }

    stateRef.current = {
      stage, world, sphere, sun, headlight, ambient, overlayCanvas, overlayTexture, owned,
      ground: null, inputs: { map, space, day }, routeLines: null,
    }
    const detach = view.attach(api)

    return () => {
      detach?.()
      view.attach(null)
      renderer.domElement.removeEventListener('wheel', onWheel)
      renderer.domElement.removeEventListener('webglcontextlost', onLost)
      stateRef.current?.ground?.dispose()
      for (const item of owned) item.dispose()
      backdrop.dispose()
      stage.dispose()
      stateRef.current = null
    }
    // One stage per mounted view; the camera and the attach are read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (stateRef.current) stateRef.current.inputs = { map, space, day }
  })

  /* ---------------- the ground: a star, a picture, or a generated world ---------------- */

  const shownRegions = map.regions.filter((region) => isItemShown(map, region, day)).map((region) => region.id).join(',')
  const growsLand = !isStar && look.kind !== 'texture' && surface.terrainFromRegions
  const groundKey = JSON.stringify([look, growsLand ? map.regions : null, growsLand ? map.terrains : null, surface.atmosphere, shownRegions])

  useEffect(() => {
    const state = stateRef.current
    if (!state) return undefined
    let cancelled = false
    const parts = []
    const group = new Group()
    state.world.add(group)
    const ground = {
      dispose() {
        state.world.remove(group)
        for (const item of parts) item.dispose()
      },
    }
    state.ground?.dispose()
    state.ground = ground

    if (isStar) {
      const star = createStar({ id: skySeed || 'star', kind: 'star', color: null, star: { spectral: look.spectral || 'G2V', temperatureK: look.temperatureK } }, { closeUp: true })
      star.setRadius(1)
      group.add(star.object)
      parts.push(star)
      state.star = star
    } else {
      state.star = null
      const material = new MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.95, metalness: 0 })
      parts.push(material)
      const mesh = new Mesh(state.sphere, material)
      group.add(mesh)
      if (surface.atmosphere && look.kind !== 'texture') {
        const rim = new Mesh(state.sphere, new ShaderMaterial({
          uniforms: { uColor: { value: new Color(look.kind === 'gas' ? rgbOf(GAS_PALETTES[look.palette]?.light) : WORLD_PARTS.atmosphere) } },
          vertexShader: SPHERE_VERTEX,
          fragmentShader: RIM_FRAGMENT,
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          side: BackSide,
        }))
        rim.scale.setScalar(1.035)
        parts.push(rim.material)
        group.add(rim)
      }
      const apply = (texture, relief) => {
        if (cancelled) {
          texture.dispose()
          relief?.dispose()
          return
        }
        material.color.set(0xffffff)
        material.map = texture
        if (relief) {
          material.bumpMap = relief
          material.bumpScale = 3
        }
        material.needsUpdate = true
        parts.push(texture)
        if (relief) parts.push(relief)
        state.stage.invalidate()
      }
      if (look.kind === 'texture' && look.texture) {
        void assetUrl(projectName, look.texture).then((url) => {
          if (cancelled || !url) return
          new TextureLoader().load(url, (texture) => {
            texture.colorSpace = SRGBColorSpace
            texture.anisotropy = Math.min(8, state.stage.renderer.capabilities.getMaxAnisotropy())
            apply(texture, null)
          })
        })
      } else {
        const draw = async () => {
          for (const size of SURFACE_SIZES) {
            const { mask, key } = growsLand ? regionMask(map, size) : { mask: null, key: '' }
            const result = await drawSurface(look, size, mask, key)
            if (cancelled) return
            const texture = new DataTexture(result.color, result.width, result.height, RGBAFormat)
            texture.colorSpace = SRGBColorSpace
            texture.flipY = true
            texture.magFilter = LinearFilter
            texture.generateMipmaps = true
            texture.anisotropy = Math.min(8, state.stage.renderer.capabilities.getMaxAnisotropy())
            texture.needsUpdate = true
            const relief = new DataTexture(result.relief, result.width, result.height, RedFormat)
            relief.flipY = true
            relief.needsUpdate = true
            const previous = [material.map, material.bumpMap]
            apply(texture, relief)
            // The draft gives way to the full surface.
            for (const old of previous) if (old) old.dispose()
          }
        }
        draw().catch((error) => console.error('[map] the surface could not be drawn:', error))
      }
    }
    state.stage.invalidate()
    return () => {
      cancelled = true
    }
    // The ground depends on exactly what groundKey names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groundKey])

  /* ---------------- regions and routes, painted on ---------------- */

  useEffect(() => {
    const state = stateRef.current
    if (!state) return
    paintOverlay(state.overlayCanvas, map, space, day, {
      selection,
      colors: overlayColors(surfaceRef.current),
      filled: !growsLand,
      grid: Boolean(surface.graticule),
    })
    state.overlayTexture.needsUpdate = true
    state.routeLines = routeLinesFor(map, space, day)
    state.stage.invalidate()
    // Painted when what it shows changes (the day moves pins a route may follow).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map.regions, map.routes, map.pins, map.terrains, map.layers, selection, growsLand, space, day])

  /* ---------------- sunlight ---------------- */

  useEffect(() => {
    const state = stateRef.current
    if (!state) return
    const daylight = surface.daylight !== false && !isStar
    const overhead = lonLatToDirection(subsolarPoint(surface, day))
    state.sun.position.copy(overhead.multiplyScalar(10))
    state.sun.intensity = daylight ? 2.4 : 0
    state.headlight.intensity = daylight ? 0 : 1.6
    state.ambient.intensity = daylight ? 0.12 : 0.55
    state.star?.update(day)
    state.stage.invalidate()
  }, [day, isStar, surface])

  return <div ref={containerRef} className="map-space" aria-hidden="true" />
}

/* ---------------- helpers ---------------- */

/** A palette's [r, g, b] (0–255) as a three.js colour, or a pale haze when missing. */
const rgbOf = (rgb) => (rgb ? new Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255) : new Color(0.8, 0.8, 0.8))

/** A ring's longitudes moved to lie near `lon`, so point-in-region works across the antimeridian. */
function unwrappedNear(ring, lon) {
  return ring.map((point) => {
    let next = point[0]
    while (next - lon > 180) next -= 360
    while (next - lon < -180) next += 360
    return [next, point[1]]
  })
}

function distanceToSegment(p, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** Every route's line on `day`, along its great circles, for picking. */
function routeLinesFor(map, space, day) {
  const lines = new Map()
  for (const route of map.routes) {
    if (!isItemShown(map, route, day)) continue
    lines.set(route.id, measuredLinePoints(map, space, route, day))
  }
  return lines
}

const measuredLinePoints = (map, space, route, day) => measuredLine(space, routeCoords(map, space, route, day)).points
