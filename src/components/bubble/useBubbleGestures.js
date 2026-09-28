/**
 * useBubbleGestures — the trackpad gestures of the bubble editor.
 *
 *   - Pinch: in, over the gap between two bubbles of the sentence, merges them; out,
 *     over a bubble of several words, splits it one level finer. One pinch makes one
 *     change. WebKit reports a pinch as gesture events (event.scale), Chromium as a
 *     wheel with ctrlKey; both are taken, and neither is left to zoom the page.
 *   - Two-finger swipe sideways: turns to the next or previous form when it ends, if it
 *     went far enough or was a flick that way (`decideFormSwipe`), with the bubbles
 *     following the fingers until then. One swipe turns one page: the momentum after
 *     it is swallowed, not read as more swiping.
 *
 * `onPinch(spreading, x, y)` returns whether it made a change. `onSwipe(offset, armed)`
 * draws the bubbles following the fingers; `onTurn(step)` turns the form.
 */
import { useEffect, useRef } from 'react'
import { SWIPE_DISTANCE, SWIPE_LOCK, decideFormSwipe, swipeOffset } from '../../lib/bubbleDrop'
import { hasEndedWheelPhase, isMomentumWheel, wheelPhases } from '../../lib/wheelPhase'

/** A pause this long ends a wheel gesture that reports no phases (Chromium). */
export const GESTURE_IDLE_MS = 200
/** Ctrl-wheel travel that makes a pinch. */
export const PINCH_TRAVEL = 24
/** A WebKit pinch this far from 1 makes a pinch. */
export const PINCH_SCALE = 1.2

export default function useBubbleGestures(overlayRef, { onPinch, onSwipe, onTurn, canTurn, enabled = true }) {
  const handlers = useRef({ onPinch, onSwipe, onTurn, canTurn })
  useEffect(() => { handlers.current = { onPinch, onSwipe, onTurn, canTurn } }, [onPinch, onSwipe, onTurn, canTurn])

  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay || !enabled) return undefined

    /* ---- pinch, as Chromium sends it ---- */
    let pinchTravel = 0
    let pinchSpent = false
    let pinchIdle = 0

    /* ---- swipe ---- */
    let travel = { x: 0, y: 0 }
    let axis = null
    let samples = []
    let swallowMomentum = false
    let swipeIdle = 0

    const resetSwipe = () => {
      travel = { x: 0, y: 0 }
      axis = null
      samples = []
    }

    const endSwipe = () => {
      window.clearTimeout(swipeIdle)
      if (axis === 'x') {
        const step = decideFormSwipe(travel.x, samples)
        handlers.current.onSwipe?.(0, 0)
        if (step && handlers.current.canTurn?.(step)) handlers.current.onTurn?.(step)
        swallowMomentum = true
      }
      resetSwipe()
    }

    const onSwipeWheel = (event) => {
      if (isMomentumWheel(event)) {
        if (swallowMomentum) event.preventDefault()
        return
      }
      window.clearTimeout(swipeIdle)
      swipeIdle = window.setTimeout(endSwipe, GESTURE_IDLE_MS)
      if (!axis && !travel.x && !travel.y) swallowMomentum = false

      // Where the fingers went. Under natural scrolling (WebKit says whether it is on)
      // a positive deltaX is the fingers moving left, toward the next form.
      const sign = event.webkitDirectionInvertedFromDevice === false ? 1 : -1
      travel = { x: travel.x + sign * event.deltaX, y: travel.y + sign * event.deltaY }
      if (!axis) {
        if (Math.hypot(travel.x, travel.y) < SWIPE_LOCK) return
        axis = Math.abs(travel.x) > 2 * Math.abs(travel.y) ? 'x' : 'y'
      }
      if (axis !== 'x') return
      event.preventDefault()
      samples.push({ t: event.timeStamp, x: travel.x })
      if (samples.length > 12) samples.shift()

      if (hasEndedWheelPhase(wheelPhases(event).phase)) {
        endSwipe()
        return
      }
      const step = travel.x < 0 ? 1 : -1
      const possible = Boolean(handlers.current.canTurn?.(step))
      const armed = possible && Math.abs(travel.x) >= SWIPE_DISTANCE ? step : 0
      handlers.current.onSwipe?.(swipeOffset(travel.x, possible), armed)
    }

    const onWheel = (event) => {
      if (!event.ctrlKey) {
        onSwipeWheel(event)
        return
      }
      event.preventDefault()
      window.clearTimeout(pinchIdle)
      pinchIdle = window.setTimeout(() => { pinchTravel = 0; pinchSpent = false }, 220)
      if (pinchSpent) return
      pinchTravel -= event.deltaY
      if (Math.abs(pinchTravel) < PINCH_TRAVEL) return
      pinchSpent = Boolean(handlers.current.onPinch?.(pinchTravel > 0, event.clientX, event.clientY))
      pinchTravel = 0
    }

    /* ---- pinch, as WebKit sends it: one gesture, its scale relative to where it began ---- */
    let gestureSpent = false
    const onGestureStart = (event) => {
      event.preventDefault()
      gestureSpent = false
    }
    const onGestureChange = (event) => {
      event.preventDefault()
      if (gestureSpent || (event.scale < PINCH_SCALE && event.scale > 1 / PINCH_SCALE)) return
      gestureSpent = Boolean(handlers.current.onPinch?.(event.scale > 1, event.clientX, event.clientY))
    }
    const onGestureEnd = (event) => event.preventDefault()

    overlay.addEventListener('wheel', onWheel, { passive: false })
    overlay.addEventListener('gesturestart', onGestureStart)
    overlay.addEventListener('gesturechange', onGestureChange)
    overlay.addEventListener('gestureend', onGestureEnd)
    return () => {
      window.clearTimeout(pinchIdle)
      window.clearTimeout(swipeIdle)
      overlay.removeEventListener('wheel', onWheel)
      overlay.removeEventListener('gesturestart', onGestureStart)
      overlay.removeEventListener('gesturechange', onGestureChange)
      overlay.removeEventListener('gestureend', onGestureEnd)
    }
  }, [overlayRef, enabled])
}
