/**
 * useMapViewport.js — pan and zoom for a map.
 *
 * The arrangement is useCanvasViewport's: the viewport lives in a ref, a gesture
 * writes the world group's transform straight to the DOM, and React hears about it
 * once per frame. What differs is the target — an SVG `<g>`'s `transform` attribute
 * rather than a div's CSS transform, which is what keeps coastlines and borders
 * sharp at 200× instead of stretching a bitmap — and the zoom range.
 *
 * Two CSS variables are published on the surface for marks that must hold a constant
 * size on screen: `--map-zoom`, and `--map-inv-zoom` (its reciprocal), which a pin's
 * inner group scales by to cancel the world's scale.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MAP_ZOOM_STEP,
  fitMapBounds,
  panMapBy,
  screenToWorld,
  svgWorldTransform,
  zoomMapAt,
} from '../lib/map/mapViewport'

const WHEEL_ZOOM_SENSITIVITY = 0.01

export function useMapViewport({ initialViewport, onViewportChange }) {
  const surfaceRef = useRef(null)
  const worldRef = useRef(null)
  const viewportRef = useRef(initialViewport)
  const frameRef = useRef(0)
  const [viewport, setViewportState] = useState(initialViewport)
  const onViewportChangeRef = useRef(onViewportChange)

  useEffect(() => {
    onViewportChangeRef.current = onViewportChange
  }, [onViewportChange])

  const applyViewport = useCallback((next) => {
    viewportRef.current = next
    worldRef.current?.setAttribute('transform', svgWorldTransform(next))
    const style = surfaceRef.current?.style
    if (style) {
      style.setProperty('--map-zoom', String(next.zoom))
      style.setProperty('--map-inv-zoom', String(1 / next.zoom))
    }
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      setViewportState(viewportRef.current)
      onViewportChangeRef.current?.(viewportRef.current)
    })
  }, [])

  // Resetting the id is load-bearing under StrictMode — see useCanvasViewport.
  useEffect(
    () => () => {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
    },
    []
  )

  useEffect(() => {
    applyViewport(viewportRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toSurfacePoint = useCallback((clientX, clientY) => {
    const rect = surfaceRef.current?.getBoundingClientRect()
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
    if (!surface) return undefined

    // Native and non-passive: React's onWheel is passive, so preventDefault there is
    // ignored and the pane would scroll instead.
    const onWheel = (event) => {
      // Scrolling inside a panel (the inspector, a list) stays a scroll.
      if (event.target.closest?.('[data-map-scrolls]')) return
      event.preventDefault()
      const point = toSurfacePoint(event.clientX, event.clientY)
      if (event.ctrlKey || event.metaKey) {
        // Trackpad pinch arrives as ctrl+wheel; a mouse wheel with ⌘ zooms too.
        const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY)
        applyViewport(zoomMapAt(viewportRef.current, point.x, point.y, factor))
      } else {
        applyViewport(panMapBy(viewportRef.current, -event.deltaX, -event.deltaY))
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
  }, [applyViewport, toSurfacePoint])

  /* ---------------- dragging the map ---------------- */

  /** Begin a pan from a pointerdown; returns a function that ends it early. */
  const startPan = useCallback(
    (event) => {
      let lastX = event.clientX
      let lastY = event.clientY
      const onMove = (moveEvent) => {
        applyViewport(panMapBy(viewportRef.current, moveEvent.clientX - lastX, moveEvent.clientY - lastY))
        lastX = moveEvent.clientX
        lastY = moveEvent.clientY
      }
      const stop = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', stop)
        window.removeEventListener('pointercancel', stop)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', stop)
      window.addEventListener('pointercancel', stop)
      return stop
    },
    [applyViewport]
  )

  /* ---------------- commands ---------------- */

  const viewSize = useCallback(() => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    return { width: rect?.width || 0, height: rect?.height || 0 }
  }, [])

  const zoomBy = useCallback(
    (factor) => {
      const { width, height } = viewSize()
      applyViewport(zoomMapAt(viewportRef.current, width / 2, height / 2, factor))
    },
    [applyViewport, viewSize]
  )

  const zoomIn = useCallback(() => zoomBy(MAP_ZOOM_STEP), [zoomBy])
  const zoomOut = useCallback(() => zoomBy(1 / MAP_ZOOM_STEP), [zoomBy])

  /** Frame a world rect ({x, y, width, height}). */
  const fitTo = useCallback(
    (bounds, padding) => {
      if (!bounds) return
      const { width, height } = viewSize()
      if (!width || !height) return
      applyViewport(fitMapBounds(bounds, width, height, padding))
    },
    [applyViewport, viewSize]
  )

  /** Center a world point, keeping the zoom (or taking `zoom`). */
  const centerOn = useCallback(
    (x, y, zoom = viewportRef.current.zoom) => {
      const { width, height } = viewSize()
      applyViewport({ x: x - width / 2 / zoom, y: y - height / 2 / zoom, zoom })
    },
    [applyViewport, viewSize]
  )

  return {
    surfaceRef,
    worldRef,
    viewportRef,
    viewport,
    applyViewport,
    screenToWorldAt,
    toSurfacePoint,
    startPan,
    zoomIn,
    zoomOut,
    fitTo,
    centerOn,
  }
}
