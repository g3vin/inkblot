/**
 * useCanvasViewport.js — pan/zoom for the canvas surface.
 *
 * The viewport lives in a ref, not React state: a pan or zoom writes the world
 * layer's transform directly, so a gesture never costs one render per event. Read
 * `viewportRef.current` for the live value. What React holds is the zoom alone,
 * rounded to a percent, for the readout: a pan leaves it unchanged, so a pan renders
 * nothing, and mid-zoom it is refreshed at most every 100ms and again on settling.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clampZoom,
  fitViewport,
  nodesBounds,
  panBy,
  screenToWorld,
  worldTransform,
  zoomAt,
  zoomTo,
} from '../lib/canvasGeometry'

/** World units. Exported so snap-to-grid lands on the grid the user can see. */
export const GRID_SIZE = 24
const WHEEL_ZOOM_SENSITIVITY = 0.01
/** The most one wheel event zooms by, in px of delta: ×1.22 a mouse notch. */
const MAX_ZOOM_WHEEL_DELTA = 20

/** The zoom as the readout shows it: to the percent. */
const roundZoom = (zoom) => Math.round(zoom * 100) / 100
const ZOOM_STEP = 1.2

/**
 * Can this element still scroll in the direction the wheel is going?
 *
 * Checked at the boundary too, so that once a board is scrolled to its end the wheel
 * goes back to panning the canvas instead of dead-ending on the card.
 */
function canScrollBy(el, deltaY) {
  const scrollable = el.scrollHeight - el.clientHeight
  if (scrollable <= 1) return false
  if (deltaY < 0) return el.scrollTop > 0
  if (deltaY > 0) return el.scrollTop < scrollable - 1
  return false
}

export function useCanvasViewport({ initialViewport, onViewportChange, lockedRef }) {
  const surfaceRef = useRef(null)
  const worldRef = useRef(null)
  const gridRef = useRef(null)
  const viewportRef = useRef(initialViewport)
  const frameRef = useRef(0)
  const settleTimerRef = useRef(0)
  const surfaceRectRef = useRef(null)
  const [zoom, setZoomState] = useState(() => roundZoom(initialViewport.zoom))
  const zoomSetAtRef = useRef(0)
  // The first frame of a gesture reaches the readout at once; the rest are throttled.
  const leadingRef = useRef(true)
  const [isPanning, setIsPanning] = useState(false)
  const onViewportChangeRef = useRef(onViewportChange)

  useEffect(() => {
    onViewportChangeRef.current = onViewportChange
  }, [onViewportChange])

  /** The gesture has gone quiet: what a moving canvas skips is brought up to date. */
  const settle = useCallback(() => {
    settleTimerRef.current = 0
    const surface = surfaceRef.current
    if (!surface) return
    // Read by the chrome inside the world (resize strips, ports, hit strokes) to hold
    // a constant on-screen size. Inherited by every element under it, so writing it
    // restyles the whole canvas — once here, never per frame.
    surface.style.setProperty('--canvas-zoom', String(viewportRef.current.zoom))
    delete surface.dataset.gesturing
    surfaceRectRef.current = null
    setZoomState(roundZoom(viewportRef.current.zoom))
  }, [])

  /** Write the viewport to the DOM now; sync React (and the saver) on the next frame. */
  const applyViewport = useCallback((next) => {
    viewportRef.current = next

    if (worldRef.current) {
      worldRef.current.style.transform = worldTransform(next)
    }
    // The dot grid is a background on its own layer, so it has to be panned/scaled
    // by hand rather than riding the world layer's transform. Its variables live on
    // it alone: set on the surface they would restyle every card each frame.
    if (gridRef.current) {
      const style = gridRef.current.style
      style.setProperty('--canvas-grid-size', `${GRID_SIZE * next.zoom}px`)
      style.setProperty('--canvas-grid-x', `${-next.x * next.zoom}px`)
      style.setProperty('--canvas-grid-y', `${-next.y * next.zoom}px`)
    }

    // While the canvas moves, hover effects and hit-testing are off (Canvas.css):
    // cards sliding under a still cursor would otherwise flip :hover card after card.
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
      if (leadingRef.current || now - zoomSetAtRef.current >= 100) {
        leadingRef.current = false
        zoomSetAtRef.current = now
        setZoomState(roundZoom(viewportRef.current.zoom))
      }
      onViewportChangeRef.current?.(viewportRef.current)
    })
  }, [settle])

  /*
   * Resetting the id to 0 is load-bearing, not tidiness.
   *
   * `applyViewport` skips scheduling when frameRef is non-zero ("a sync is already
   * pending"). StrictMode mounts, tears down, and re-mounts on the SAME refs, so if
   * this cleanup only cancelled the frame and left the id behind, the guard above
   * would see a stale non-zero id forever and never schedule again. React state —
   * and so the zoom readout — would freeze at its initial value while the canvas
   * kept zooming, because the transform is written to the DOM directly a few lines
   * up.
   */
  useEffect(
    () => () => {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
      window.clearTimeout(settleTimerRef.current)
      settleTimerRef.current = 0
    },
    []
  )

  // Push the initial viewport into the DOM on mount (the layer starts untransformed).
  useEffect(() => {
    applyViewport(viewportRef.current)
    settle()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Pointer position relative to the surface, which is what the math expects.
   *
   * Mid-gesture the surface's rect is the one read at the gesture's first event: a
   * wheel tick that measured it right after the last tick wrote a transform forced a
   * layout on every tick. Outside a gesture it is always read fresh (`settle` drops
   * the kept one), since a pane can move without resizing.
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

  const screenToWorldAt = useCallback((clientX, clientY) => {
    const point = toSurfacePoint(clientX, clientY)
    return screenToWorld(point.x, point.y, viewportRef.current)
  }, [toSurfacePoint])

  /* ---------------- wheel: pan, and zoom on ctrl/⌘ ---------------- */

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return

    // Must be a native listener: React attaches `wheel` passively, so
    // preventDefault() inside an onWheel prop is silently ignored and the
    // surrounding pane scrolls instead.
    const onWheel = (event) => {
      /*
       * The canvas normally swallows every wheel event to pan and zoom, which
       * leaves the contents of a card — a Pinterest board, a long note thread —
       * with no way to scroll at all. Two states hand the wheel back to the card:
       *
       *   - READ MODE (locked): every scrollable card scrolls, because reading
       *     is the whole point of the mode.
       *   - a SELECTED card: clicking a board says "I'm looking at this one",
       *     so the wheel scrolls it instead of dragging the world out from
       *     under it. Click the background to deselect and pan again.
       *
       * No preventDefault, so the browser scrolls natively — and once the card
       * hits its end the wheel goes back to panning, so the gesture never
       * dead-ends.
       */
      if (event.target instanceof Element) {
        const scroller = event.target.closest('[data-canvas-scroll]')
        if (
          scroller &&
          (lockedRef?.current || scroller.closest('.canvas-node.is-selected')) &&
          canScrollBy(scroller, event.deltaY)
        ) return
      }

      event.preventDefault()
      event.stopPropagation()

      // deltaMode 1 is lines, 2 is pages — normalize both to pixels.
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? surface.clientHeight : 1

      // A trackpad pinch arrives as a wheel event with ctrlKey set.
      if (event.ctrlKey || event.metaKey) {
        const point = toSurfacePoint(event.clientX, event.clientY)
        // Clamped: a mouse notch is ~100px, which unclamped zoomed ×2.7 a click; a
        // trackpad pinch sends a few px an event and is untouched.
        const delta = Math.max(-MAX_ZOOM_WHEEL_DELTA, Math.min(MAX_ZOOM_WHEEL_DELTA, event.deltaY * unit))
        const factor = Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY)
        applyViewport(zoomAt(viewportRef.current, factor, point.x, point.y))
        return
      }

      applyViewport(panBy(viewportRef.current, event.deltaX * unit, event.deltaY * unit))
    }

    surface.addEventListener('wheel', onWheel, { passive: false })
    return () => surface.removeEventListener('wheel', onWheel)
  }, [applyViewport, lockedRef, toSurfacePoint])

  /* ---------------- pinch: WebKit gesture events ---------------- */

  /*
   * A trackpad pinch in WKWebView does NOT always arrive as a ctrl+wheel the way it
   * does in Chrome. WebKit has its own non-standard gesture events, and if nothing
   * handles them the webview applies its own page magnification — which scales the
   * whole app, canvas and toolbar together. That looks like the canvas zoomed while
   * the zoom readout sits at 100% forever, because the canvas's own zoom never moved.
   *
   * Handling them here (and preventing the default) puts pinch back under our control.
   * These events do not exist outside WebKit, so elsewhere this is simply inert.
   */
  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return

    // Zoom at gesture start; event.scale is cumulative and relative to it.
    let baseZoom = 1
    let anchor = { x: 0, y: 0 }

    const onGestureStart = (event) => {
      event.preventDefault()
      baseZoom = viewportRef.current.zoom
      anchor = toSurfacePoint(event.clientX, event.clientY)
    }

    const onGestureChange = (event) => {
      event.preventDefault()
      const target = clampZoom(baseZoom * event.scale)
      const current = viewportRef.current
      applyViewport(zoomAt(current, target / current.zoom, anchor.x, anchor.y))
    }

    const onGestureEnd = (event) => event.preventDefault()

    surface.addEventListener('gesturestart', onGestureStart, { passive: false })
    surface.addEventListener('gesturechange', onGestureChange, { passive: false })
    surface.addEventListener('gestureend', onGestureEnd, { passive: false })
    return () => {
      surface.removeEventListener('gesturestart', onGestureStart)
      surface.removeEventListener('gesturechange', onGestureChange)
      surface.removeEventListener('gestureend', onGestureEnd)
    }
  }, [applyViewport, toSurfacePoint])

  /* ---------------- drag to pan: middle mouse, or space held ---------------- */

  const spaceHeldRef = useRef(false)
  /** Ends the finger pan in progress, if there is one — see `startPan`. */
  const touchPanRef = useRef(null)
  const [spaceHeld, setSpaceHeld] = useState(false)

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.code !== 'Space' || spaceHeldRef.current) return
      // Space is a legitimate keystroke while typing in a card.
      const target = event.target
      if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"]')) {
        return
      }
      spaceHeldRef.current = true
      setSpaceHeld(true)
    }
    const onKeyUp = (event) => {
      if (event.code !== 'Space') return
      spaceHeldRef.current = false
      setSpaceHeld(false)
    }
    // Releasing space outside the window would otherwise leave the hand cursor stuck.
    const onBlur = () => {
      spaceHeldRef.current = false
      setSpaceHeld(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  /**
   * Call from the surface's onPointerDown. Returns true if it started a pan.
   *
   * On a touch screen a finger on the empty canvas pans, as it does in every canvas app
   * on iPad, and the Pencil is the mouse: it draws the selection box. A second finger
   * ends the first finger's pan rather than starting another, because two fingers are a
   * pinch — which the gesture events above turn into a zoom.
   */
  const startPan = useCallback((event) => {
    const isMiddleButton = event.button === 1
    const isSpaceDrag = event.button === 0 && spaceHeldRef.current
    const isFinger = event.pointerType === 'touch'
    if (!isMiddleButton && !isSpaceDrag && !isFinger) return false

    event.preventDefault()
    if (isFinger && touchPanRef.current) {
      touchPanRef.current()
      return true
    }
    setIsPanning(true)

    let lastX = event.clientX
    let lastY = event.clientY
    const pointerId = event.pointerId

    const onMove = (moveEvent) => {
      if (isFinger && moveEvent.pointerId !== pointerId) return
      // Dragging the surface right should pull the world right, i.e. move the
      // viewport left — hence the negated delta.
      applyViewport(
        panBy(viewportRef.current, -(moveEvent.clientX - lastX), -(moveEvent.clientY - lastY))
      )
      lastX = moveEvent.clientX
      lastY = moveEvent.clientY
    }

    const onUp = (upEvent) => {
      if (isFinger && upEvent && upEvent.pointerId !== pointerId) return
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      if (touchPanRef.current === end) touchPanRef.current = null
      setIsPanning(false)
    }
    const end = () => onUp()
    if (isFinger) touchPanRef.current = end

    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    return true
  }, [applyViewport])

  /* ---------------- zoom commands ---------------- */

  const surfaceSize = useCallback(() => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    return { width: rect?.width || 0, height: rect?.height || 0 }
  }, [])

  /** A command's jump (zoom in, fit, centre): the whole gesture at once, so it settles at once. */
  const jumpTo = useCallback((next) => {
    applyViewport(next)
    window.clearTimeout(settleTimerRef.current)
    settle()
  }, [applyViewport, settle])

  const zoomBy = useCallback((factor) => {
    const { width, height } = surfaceSize()
    jumpTo(zoomAt(viewportRef.current, factor, width / 2, height / 2))
  }, [jumpTo, surfaceSize])

  const zoomIn = useCallback(() => zoomBy(ZOOM_STEP), [zoomBy])
  const zoomOut = useCallback(() => zoomBy(1 / ZOOM_STEP), [zoomBy])

  const setZoom = useCallback((zoom) => {
    const { width, height } = surfaceSize()
    jumpTo(zoomTo(viewportRef.current, clampZoom(zoom), width, height))
  }, [jumpTo, surfaceSize])

  const resetZoom = useCallback(() => setZoom(1), [setZoom])

  /** Frame `nodes` (all of them, or just a selection) in the visible area. */
  const zoomToFit = useCallback((nodes, options) => {
    const { width, height } = surfaceSize()
    jumpTo(fitViewport(nodesBounds(nodes), width, height, options))
  }, [jumpTo, surfaceSize])

  /**
   * Center one node, holding the current zoom. Revealing a search hit should move
   * the user to it, not rescale their canvas out from under them — which is what
   * zoomToFit([node]) would do.
   */
  const centerOn = useCallback((node) => {
    if (!node) return
    const { width, height } = surfaceSize()
    const { zoom } = viewportRef.current
    jumpTo({
      zoom,
      x: node.x + node.width / 2 - width / (2 * zoom),
      y: node.y + node.height / 2 - height / (2 * zoom),
    })
  }, [jumpTo, surfaceSize])

  return {
    surfaceRef,
    worldRef,
    gridRef,
    zoom,
    viewportRef,
    applyViewport,
    screenToWorldAt,
    startPan,
    isPanning,
    spaceHeld,
    zoomIn,
    zoomOut,
    setZoom,
    resetZoom,
    zoomToFit,
    centerOn,
  }
}
