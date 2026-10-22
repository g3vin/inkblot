/**
 * useGlobeView.js — the Earth as a globe: the view a MapSurface works through when
 * MapLibre (GlobeView.jsx) draws the ground.
 *
 * It answers to the same calls as useMapViewport, so the surface's tools, drafts,
 * handles, hit-testing and scale bar work unchanged. The trick is the world: on the
 * globe, "world" coordinates ARE the surface's pixels (the viewport is the identity),
 * and the projector (`globeProjector`) turns a `[lon, lat]` into those pixels with
 * MapLibre's own `project`. Pan, zoom, rotate and tilt are MapLibre's gestures, not
 * ours (`native`).
 *
 * The camera changes many times a second while the globe moves. React hears of it at
 * most every 50 ms (`camera`), and it is saved (not as an edit) when it stops.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { centralAngle } from '../lib/map/geodesy'
import { unwrapLongitudes } from '../lib/map/globeFeatures'
import { ITEM_LAYERS } from '../lib/map/globeStyle'

const IDENTITY = Object.freeze({ x: 0, y: 0, zoom: 1 })
/** A point this far round from the centre is over the horizon. */
const HORIZON = (85 * Math.PI) / 180
const FRAME_MS = 50

export const DEFAULT_GLOBE_CAMERA = { center: [0, 20], zoom: 1.4, bearing: 0, pitch: 0 }

/** A saved camera, or the default for anything malformed. */
export function readGlobeCamera(raw) {
  const camera = raw && typeof raw === 'object' ? raw : {}
  const center = Array.isArray(camera.center) && camera.center.length >= 2 && camera.center.every(Number.isFinite) ? camera.center.slice(0, 2) : DEFAULT_GLOBE_CAMERA.center
  const number = (value, fallback) => (Number.isFinite(value) ? value : fallback)
  return {
    center,
    zoom: number(camera.zoom, DEFAULT_GLOBE_CAMERA.zoom),
    bearing: number(camera.bearing, 0),
    pitch: number(camera.pitch, 0),
  }
}

/**
 * Where a `[lon, lat]` is on the surface, or null when it is round the back. The
 * projector the surface's layers, drafts and handles draw with on the globe.
 */
export function globeProjector(gl, camera, size) {
  const centre = camera.center
  return {
    kind: 'globe',
    bounds: { x: 0, y: 0, width: size.width || 1, height: size.height || 1 },
    toWorld: (point) => {
      if (!point || !gl) return null
      if (centralAngle(centre, point) > HORIZON) return null
      const at = gl.project([point[0], point[1]])
      return [at.x, at.y]
    },
    fromWorld: (point) => {
      if (!gl) return null
      const at = gl.unproject([point[0], point[1]])
      return at && Number.isFinite(at.lng) && Number.isFinite(at.lat) ? [((at.lng + 540) % 360) - 180, at.lat] : null
    },
    unitsPerWorld: 1,
  }
}

export function useGlobeView({ surfaceRef, initialCamera, onCameraChange, enabled }) {
  const glRef = useRef(null)
  const worldRef = useRef(null)
  const viewportRef = useRef(IDENTITY)
  const [initial] = useState(() => readGlobeCamera(initialCamera))
  const cameraRef = useRef(initial)
  const [gl, setGl] = useState(null)
  const [camera, setCamera] = useState(initial)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const onCameraChangeRef = useRef(onCameraChange)
  useEffect(() => {
    onCameraChangeRef.current = onCameraChange
  }, [onCameraChange])

  /** Called by GlobeView once MapLibre is up (and with null when it goes). */
  const attach = useCallback((gl) => {
    glRef.current = gl
    setGl(gl)
    if (!gl) return undefined
    let timer = 0
    let last = 0
    const read = () => {
      const center = gl.getCenter()
      return { center: [center.lng, center.lat], zoom: gl.getZoom(), bearing: gl.getBearing(), pitch: gl.getPitch() }
    }
    const tick = () => {
      timer = 0
      last = performance.now()
      setCamera(read())
    }
    const onMove = () => {
      if (timer) return
      const wait = Math.max(0, FRAME_MS - (performance.now() - last))
      timer = window.setTimeout(tick, wait)
    }
    const onEnd = () => {
      window.clearTimeout(timer)
      tick()
      cameraRef.current = read()
      onCameraChangeRef.current?.(cameraRef.current)
    }
    const onResize = () => {
      const canvas = gl.getCanvas()
      setSize({ width: canvas.clientWidth, height: canvas.clientHeight })
    }
    gl.on('move', onMove)
    gl.on('moveend', onEnd)
    gl.on('resize', onResize)
    onResize()
    tick()
    return () => {
      window.clearTimeout(timer)
      gl.off('move', onMove)
      gl.off('moveend', onEnd)
      gl.off('resize', onResize)
    }
  }, [])

  const toSurfacePoint = useCallback((clientX, clientY) => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    return rect ? { x: clientX - rect.left, y: clientY - rect.top } : { x: 0, y: 0 }
  }, [surfaceRef])

  const screenToWorldAt = toSurfacePoint

  const ease = useCallback((options) => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    glRef.current?.[reduce ? 'jumpTo' : 'easeTo']({ ...options, duration: reduce ? 0 : 500 })
  }, [])

  const zoomIn = useCallback(() => ease({ zoom: (glRef.current?.getZoom() || 0) + 1 }), [ease])
  const zoomOut = useCallback(() => ease({ zoom: (glRef.current?.getZoom() || 0) - 1 }), [ease])

  /** Frame `[lon, lat]` points; the whole Earth for none. */
  const fitStored = useCallback((points) => {
    const gl = glRef.current
    if (!gl) return
    const usable = points.filter(Boolean)
    if (!usable.length) {
      ease({ center: [0, 20], zoom: 1.4, bearing: 0, pitch: 0 })
      return
    }
    const line = unwrapLongitudes(usable)
    const lons = line.map((point) => point[0])
    const lats = line.map((point) => point[1])
    const bounds = [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]]
    if (bounds[0][0] === bounds[1][0] && bounds[0][1] === bounds[1][1]) {
      ease({ center: bounds[0], zoom: Math.max(gl.getZoom(), 6) })
      return
    }
    gl.fitBounds(bounds, { padding: 80, maxZoom: 12, duration: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 700 })
  }, [ease])

  const centerOnStored = useCallback((point) => {
    if (point) ease({ center: [point[0], point[1]] })
  }, [ease])

  // The surface's world is the screen: these take screen points.
  const centerOn = useCallback((x, y) => {
    const at = glRef.current?.unproject([x, y])
    if (at) ease({ center: [at.lng, at.lat] })
  }, [ease])
  const fitTo = useCallback(() => fitStored([]), [fitStored])

  /** Hold the globe still while something on it is dragged. */
  const lockPan = useCallback((locked) => {
    const gl = glRef.current
    if (!gl) return
    if (locked) gl.dragPan.disable()
    else gl.dragPan.enable()
  }, [])

  /** The region or route under a client point: `{ kind, id }` or null. Places and labels are DOM. */
  const pick = useCallback((clientX, clientY) => {
    const gl = glRef.current
    if (!gl) return null
    const { x, y } = toSurfacePoint(clientX, clientY)
    const layers = [ITEM_LAYERS.routeHit, ITEM_LAYERS.regionFill].filter((id) => gl.getLayer(id))
    if (!layers.length) return null
    const [hit] = gl.queryRenderedFeatures([[x - 3, y - 3], [x + 3, y + 3]], { layers })
    return hit?.properties?.id ? { kind: hit.properties.kind, id: hit.properties.id } : null
  }, [toSurfacePoint])

  /**
   * The globe as a picture, `scale` times the screen's size: drawn again at that
   * sharpness, copied the moment it is drawn (MapLibre does not keep its buffer).
   */
  const picture = useCallback((scale = 1) => new Promise((resolve) => {
    const gl = glRef.current
    if (!gl) {
      resolve(null)
      return
    }
    const ratio = gl.getPixelRatio()
    let done = false
    const finish = (canvas) => {
      if (done) return
      done = true
      gl.setPixelRatio(ratio)
      resolve(canvas)
    }
    const capture = () => {
      gl.once('render', () => {
        const source = gl.getCanvas()
        const out = document.createElement('canvas')
        out.width = source.width
        out.height = source.height
        out.getContext('2d').drawImage(source, 0, 0)
        finish(out)
      })
      gl.triggerRepaint()
    }
    gl.setPixelRatio(scale)
    gl.once('idle', capture)
    // A globe still fetching pictures may never fall idle: take what is there.
    window.setTimeout(() => {
      if (!done) capture()
    }, 8000)
  }), [])

  /** Fly to a saved camera: `{ center, zoom, bearing, pitch }`. */
  const goTo = useCallback((saved) => {
    if (!saved || !Array.isArray(saved.center)) return
    ease({ center: saved.center, zoom: saved.zoom, bearing: saved.bearing || 0, pitch: saved.pitch || 0 })
  }, [ease])

  // Unused on the globe (MapLibre owns the gestures), present so callers need not ask.
  const applyViewport = useCallback(() => {}, [])

  const projector = useMemo(() => globeProjector(gl, camera, size), [camera, gl, size])

  return useMemo(() => ({
    native: true,
    enabled,
    surfaceRef,
    worldRef,
    viewportRef,
    viewport: IDENTITY,
    settledZoom: 1,
    camera,
    projector,
    cameraRef,
    glRef,
    attach,
    applyViewport,
    screenToWorldAt,
    toSurfacePoint,
    zoomIn,
    zoomOut,
    fitTo,
    fitStored,
    centerOn,
    centerOnStored,
    lockPan,
    pick,
    goTo,
    picture,
  }), [applyViewport, attach, camera, centerOn, centerOnStored, enabled, fitStored, fitTo, goTo, lockPan, pick, picture, projector, screenToWorldAt, surfaceRef, toSurfacePoint, zoomIn, zoomOut])
}
