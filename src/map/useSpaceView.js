/**
 * useSpaceView.js — a star system in three dimensions: the view a MapSurface works
 * through when three.js (space/SpaceView.jsx) draws it.
 *
 * Like the globe (useGlobeView.js) it answers to the same calls as useMapViewport,
 * and its world is the screen: the projector turns a point in the system (AU) into
 * surface pixels through the 3D camera, and a click back into a point on the
 * system's plane. Orbiting, zooming and panning are the scene's own gestures
 * (`native`). The scene hands this hook a small API when it is up (`attach`).
 *
 * The camera is published once per drawn frame, so what the surface draws over the
 * scene — names, places, handles — moves with it, and it is saved when it settles.
 * A map without a saved camera calls `onReady` once the scene is up, to be framed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { readSpaceCamera } from './space/spaceMath'

const IDENTITY = Object.freeze({ x: 0, y: 0, zoom: 1 })

/** The projector the surface's layers draw with over the scene. */
export function spaceProjector(api, camera, size) {
  return {
    kind: 'space',
    bounds: { x: 0, y: 0, width: size.width || 1, height: size.height || 1 },
    toWorld: (point) => (point && api ? api.project(point) : null),
    fromWorld: (point) => (api ? api.unproject(point[0], point[1]) : null),
    unitsPerWorld: 1,
    // What changes the projection, so memos that hold a projector notice.
    camera,
  }
}

export function useSpaceView({ surfaceRef, initialCamera, onCameraChange, onReady, enabled }) {
  const apiRef = useRef(null)
  const worldRef = useRef(null)
  const viewportRef = useRef(IDENTITY)
  const [initial] = useState(() => readSpaceCamera(initialCamera))
  // Null until there is a camera worth keeping, so a new map is framed rather than restored.
  const cameraRef = useRef(initialCamera ? initial : null)
  const [api, setApi] = useState(null)
  const [camera, setCamera] = useState(initial)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const onCameraChangeRef = useRef(onCameraChange)
  const onReadyRef = useRef(onReady)
  useEffect(() => {
    onCameraChangeRef.current = onCameraChange
    onReadyRef.current = onReady
  }, [onCameraChange, onReady])

  /**
   * Called by the scene with its API (null when it goes): `project`, `unproject`,
   * `fit`, `centerOn`, `dolly`, `pick`, `lock`, and `subscribe(onFrame, onSettle)`.
   */
  const attach = useCallback((next) => {
    apiRef.current = next
    setApi(next)
    if (!next) return undefined
    // A map with no camera of its own is framed once its scene is up (a frame later).
    if (!cameraRef.current) requestAnimationFrame(() => onReadyRef.current?.())
    return next.subscribe(
      (frame) => {
        setCamera(frame.camera)
        setSize((current) => (current.width === frame.width && current.height === frame.height ? current : { width: frame.width, height: frame.height }))
      },
      (settled) => {
        cameraRef.current = settled
        onCameraChangeRef.current?.(settled)
      }
    )
  }, [])

  const toSurfacePoint = useCallback((clientX, clientY) => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    return rect ? { x: clientX - rect.left, y: clientY - rect.top } : { x: 0, y: 0 }
  }, [surfaceRef])

  const zoomIn = useCallback(() => apiRef.current?.dolly(1 / 1.6), [])
  const zoomOut = useCallback(() => apiRef.current?.dolly(1.6), [])
  const fitStored = useCallback((points) => apiRef.current?.fit(points.filter(Boolean)), [])
  const fitTo = useCallback(() => apiRef.current?.fit([]), [])
  const centerOnStored = useCallback((point) => {
    if (point) apiRef.current?.centerOn(point)
  }, [])
  const centerOn = useCallback((x, y) => {
    const point = apiRef.current?.unproject(x, y)
    if (point) apiRef.current.centerOn(point)
  }, [])
  const lockPan = useCallback((locked) => apiRef.current?.lock(locked), [])
  const pick = useCallback((clientX, clientY) => {
    const { x, y } = toSurfacePoint(clientX, clientY)
    return apiRef.current?.pick(x, y) || null
  }, [toSurfacePoint])
  const applyViewport = useCallback(() => {}, [])

  const projector = useMemo(() => spaceProjector(api, camera, size), [api, camera, size])

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
    attach,
    applyViewport,
    screenToWorldAt: toSurfacePoint,
    toSurfacePoint,
    zoomIn,
    zoomOut,
    fitTo,
    fitStored,
    centerOn,
    centerOnStored,
    lockPan,
    pick,
  }), [applyViewport, attach, camera, centerOn, centerOnStored, enabled, fitStored, fitTo, lockPan, pick, projector, surfaceRef, toSurfacePoint, zoomIn, zoomOut])
}
