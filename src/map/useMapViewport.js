/**
 * useMapViewport.js — pan and zoom for a map.
 *
 * The arrangement is useCanvasViewport's: the viewport lives in a ref, a gesture
 * writes the world group's transform straight to the DOM, and React hears about it
 * once per frame. What differs is the target — an SVG `<g>`'s `transform` attribute
 * rather than a div's CSS transform, which is what keeps coastlines and borders
 * sharp at 200× instead of stretching a bitmap — and the zoom range.
 *
 * `--map-inv-zoom`, the zoom's reciprocal, is published on the world group for marks
 * that must hold a constant size on screen: a pin's inner group scales by it to cancel
 * the world's scale. On the world group, not the surface, because a custom property
 * restyles everything under the element it is set on — the inspector and toolbar too.
 *
 * `settledZoom` is the zoom once a gesture has gone quiet (~120ms), for what is too
 * costly to redo mid-gesture, like switching the Earth's level of detail.
 *
 * `viewport` (React's copy, for the readouts, scale bar and panel) is refreshed at most
 * every 100ms mid-gesture and again when it settles: once a frame, it re-rendered the
 * whole surface — every layer, the panel — sixty times a second for a pan.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  MAP_ZOOM_STEP,
  fitMapBounds,
  panMapBy,
  screenToWorld,
  svgWorldTransform,
  zoomMapAt,
} from '../lib/map/mapViewport'
import { coast } from '../ui/useSpring.js'

const WHEEL_ZOOM_SENSITIVITY = 0.01
/** The most one wheel event zooms by, in px of delta: ×1.22 a mouse notch. */
const MAX_ZOOM_WHEEL_DELTA = 20

export function useMapViewport({ initialViewport, onViewportChange, enabled = true }) {
  const surfaceRef = useRef(null)
  const worldRef = useRef(null)
  const viewportRef = useRef(initialViewport)
  /** Stops the coast after a thrown pan; any new touch of the map stops it. */
  const stopCoastRef = useRef(() => {})
  useEffect(() => {
    const coasting = stopCoastRef
    return () => coasting.current()
  }, [])
  const frameRef = useRef(0)
  const settleTimerRef = useRef(0)
  const surfaceRectRef = useRef(null)
  const [viewport, setViewportState] = useState(initialViewport)
  const [settledZoom, setSettledZoom] = useState(initialViewport.zoom)
  const viewportSetAtRef = useRef(0)
  // The first frame of a gesture reaches React at once; the rest are throttled.
  const leadingRef = useRef(true)
  const onViewportChangeRef = useRef(onViewportChange)

  useEffect(() => {
    onViewportChangeRef.current = onViewportChange
  }, [onViewportChange])

  const settle = useCallback(() => {
    settleTimerRef.current = 0
    surfaceRectRef.current = null
    const surface = surfaceRef.current
    if (surface) delete surface.dataset.gesturing
    setSettledZoom(viewportRef.current.zoom)
    setViewportState(viewportRef.current)
  }, [])

  const applyViewport = useCallback((next) => {
    viewportRef.current = next
    const world = worldRef.current
    if (world) {
      world.setAttribute('transform', svgWorldTransform(next))
      // Every mark on the map reads this, so writing it restyles all of them: only
      // when the zoom moved, never for a pan.
      if (world.dataset.zoom !== String(next.zoom)) {
        world.dataset.zoom = String(next.zoom)
        world.style.setProperty('--map-inv-zoom', String(1 / next.zoom))
      }
    }
    const surface = surfaceRef.current
    if (surface) {
      if (!('gesturing' in surface.dataset)) {
        surface.dataset.gesturing = ''
        leadingRef.current = true
      }
      window.clearTimeout(settleTimerRef.current)
      settleTimerRef.current = window.setTimeout(settle, 120)
    }
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      const now = performance.now()
      if (leadingRef.current || now - viewportSetAtRef.current >= 100) {
        leadingRef.current = false
        viewportSetAtRef.current = now
        setViewportState(viewportRef.current)
      }
      onViewportChangeRef.current?.(viewportRef.current)
    })
  }, [settle])

  // Resetting the id is load-bearing under StrictMode — see useCanvasViewport.
  useEffect(
    () => () => {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
      window.clearTimeout(settleTimerRef.current)
      settleTimerRef.current = 0
    },
    []
  )

  // On mount, and again whenever this view takes over from the globe: its world
  // group is a new element then, with no transform of its own yet.
  useEffect(() => {
    if (enabled) applyViewport(viewportRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  /**
   * A client point relative to the surface. Mid-gesture the rect read at the gesture's
   * first event is reused: read on every wheel tick, right after the last tick wrote a
   * transform, it forced a layout each time. Outside a gesture it is read fresh.
   */
  const toSurfacePoint = useCallback((clientX, clientY) => {
    const surface = surfaceRef.current
    let rect = surface && 'gesturing' in surface.dataset ? surfaceRectRef.current : null
    if (!rect) {
      rect = surface?.getBoundingClientRect() || null
      surfaceRectRef.current = rect
    }
    if (!rect) return { x: 0, y: 0 }
    return { x: clientX - rect.left, y: clientY - rect.top }
  }, [])

  /** A client point → map world coordinates. */
  const screenToWorldAt = useCallback(
    (clientX, clientY) => {
      const point = toSurfacePoint(clientX, clientY)
      return screenToWorld(point.x, point.y, viewportRef.current)
    },
    [toSurfacePoint]
  )

  /* ---------------- wheel and pinch ---------------- */

  useEffect(() => {
    const surface = surfaceRef.current
    // On the globe, the wheel and the pinch are MapLibre's.
    if (!surface || !enabled) return undefined

    // Native and non-passive: React's onWheel is passive, so preventDefault there is
    // ignored and the pane would scroll instead.
    const onWheel = (event) => {
      // Scrolling inside a panel (the inspector, a list) stays a scroll.
      if (event.target.closest?.('[data-map-scrolls]')) return
      stopCoastRef.current()
      event.preventDefault()
      // deltaMode 1 is lines, 2 is pages — normalize both to pixels.
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? surface.clientHeight : 1
      if (event.ctrlKey || event.metaKey) {
        // Trackpad pinch arrives as ctrl+wheel; a mouse wheel with ⌘ zooms too.
        const point = toSurfacePoint(event.clientX, event.clientY)
        // Clamped: a mouse notch is ~100px, which unclamped zoomed ×2.7 a click; a
        // trackpad pinch sends a few px an event and is untouched.
        const delta = Math.max(-MAX_ZOOM_WHEEL_DELTA, Math.min(MAX_ZOOM_WHEEL_DELTA, event.deltaY * unit))
        const factor = Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY)
        applyViewport(zoomMapAt(viewportRef.current, point.x, point.y, factor))
      } else {
        applyViewport(panMapBy(viewportRef.current, -event.deltaX * unit, -event.deltaY * unit))
      }
    }

    // Safari/WebKit's own pinch events, which the Tauri webview delivers instead of
    // ctrl+wheel on some trackpads.
    let gestureScale = 1
    const onGestureStart = (event) => {
      event.preventDefault()
      gestureScale = 1
    }
    const onGestureChange = (event) => {
      event.preventDefault()
      const point = toSurfacePoint(event.clientX, event.clientY)
      const factor = event.scale / gestureScale
      gestureScale = event.scale
      applyViewport(zoomMapAt(viewportRef.current, point.x, point.y, factor))
    }

    surface.addEventListener('wheel', onWheel, { passive: false })
    surface.addEventListener('gesturestart', onGestureStart)
    surface.addEventListener('gesturechange', onGestureChange)
    return () => {
      surface.removeEventListener('wheel', onWheel)
      surface.removeEventListener('gesturestart', onGestureStart)
      surface.removeEventListener('gesturechange', onGestureChange)
    }
  }, [applyViewport, enabled, toSurfacePoint])

  /* ---------------- dragging the map ---------------- */

  /** Catch the map if it is coasting: any press on it does (useMapInput). */
  const stopCoast = useCallback(() => stopCoastRef.current(), [])

  /** Let a pan go at `velocity` ({ x, y } px/ms): the map coasts on under friction. */
  const throwPan = useCallback(
    (velocity) => {
      stopCoastRef.current()
      stopCoastRef.current = coast(velocity, (dx, dy) => {
        applyViewport(panMapBy(viewportRef.current, dx, dy))
      })
    },
    [applyViewport]
  )

  /* ---------------- commands ---------------- */

  const viewSize = useCallback(() => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    return { width: rect?.width || 0, height: rect?.height || 0 }
  }, [])

  /** A command's jump (zoom in, fit, centre): the whole gesture at once, so it settles at once. */
  const jumpTo = useCallback(
    (next) => {
      applyViewport(next)
      window.clearTimeout(settleTimerRef.current)
      settle()
    },
    [applyViewport, settle]
  )

  const zoomBy = useCallback(
    (factor) => {
      const { width, height } = viewSize()
      jumpTo(zoomMapAt(viewportRef.current, width / 2, height / 2, factor))
    },
    [jumpTo, viewSize]
  )

  const zoomIn = useCallback(() => zoomBy(MAP_ZOOM_STEP), [zoomBy])
  const zoomOut = useCallback(() => zoomBy(1 / MAP_ZOOM_STEP), [zoomBy])

  /** Frame a world rect ({x, y, width, height}). */
  const fitTo = useCallback(
    (bounds, padding) => {
      if (!bounds) return
      const { width, height } = viewSize()
      if (!width || !height) return
      jumpTo(fitMapBounds(bounds, width, height, padding))
    },
    [jumpTo, viewSize]
  )

  /** Center a world point, keeping the zoom (or taking `zoom`). */
  const centerOn = useCallback(
    (x, y, zoom = viewportRef.current.zoom) => {
      const { width, height } = viewSize()
      jumpTo({ x: x - width / 2 / zoom, y: y - height / 2 / zoom, zoom })
    },
    [jumpTo, viewSize]
  )

  // One object per change of what it holds: the surface's callbacks depend on it.
  return useMemo(() => ({
    surfaceRef,
    worldRef,
    viewportRef,
    viewport,
    settledZoom,
    applyViewport,
    screenToWorldAt,
    toSurfacePoint,
    stopCoast,
    throwPan,
    zoomIn,
    zoomOut,
    fitTo,
    centerOn,
  }), [viewport, settledZoom, applyViewport, screenToWorldAt, toSurfacePoint, stopCoast, throwPan, zoomIn, zoomOut, fitTo, centerOn])
}
