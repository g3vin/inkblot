/**
 * useSpaceSwipe — a sidebar's two-finger swipe between its panels, after Arc's spaces:
 * the inspector's tabs, and the left sidebar's Files and Book.
 *
 *   - The panels follow the fingers, one panel per sidebar width, so a swipe held
 *     down can travel through as many panels as the fingers carry it.
 *   - Until a swipe has been held that long (`SWIPE_HOLD_MS`) it goes no further than
 *     the next panel, however hard the flick: macOS speeds the deltas of a fast flick
 *     up so much that it would otherwise sail past a panel before the fingers lift.
 *   - When the fingers lift, the speed they were moving at decides where it lands
 *     (`settleIndex`): a flick goes on to the next panel that way, anything slower
 *     settles on the nearest. A quick swipe-and-release therefore turns one panel.
 *   - The momentum after a lift is swallowed, never read as more swiping; the next
 *     swipe starts when the fingers come down again.
 *
 * The lift is AppKit's (wheelPhase.js); WKWebView's wheel events carry no phase. Where
 * the app is not there to say (a browser), a pause in the wheel events stands in.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { isMomentumWheel, knowsTrackpadPhases, onTrackpadPhase } from '../lib/wheelPhase'
import { HAPTIC_ALIGNMENT, HAPTIC_LEVEL, performHaptic } from '../lib/haptics'

/** Travel before a gesture is read as a swipe or a scroll. */
export const SWIPE_LOCK_PX = 6
/** How much more sideways than up-and-down a gesture must be to swipe. */
export const SWIPE_HORIZONTAL_BIAS = 1.2
/** Finger speed at the lift, in px/ms, that carries on to the next panel. */
export const SWIPE_FLICK_VELOCITY = 0.5
/** The stretch of the gesture its lift speed is measured over. */
export const SWIPE_VELOCITY_WINDOW_MS = 80
/** Without phases, a pause this long is taken for the lift. */
export const SWIPE_IDLE_END_MS = 120
/** How long a swipe is held before it may travel past the next panel. */
export const SWIPE_HOLD_MS = 220
/** The furthest, in panels, a swipe stretches past the first or last. */
export const SWIPE_RUBBER_BAND = 0.3
/** Used when the sidebar's width is not known. */
const FALLBACK_PIXELS_PER_PANEL = 240

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

/** Past either end the panels give, but less and less. */
export const rubberBand = (position, count) => {
  const last = Math.max(0, count - 1)
  if (position >= 0 && position <= last) return position
  const over = position < 0 ? -position : position - last
  const give = SWIPE_RUBBER_BAND * (1 - 1 / (1 + over * 2))
  return position < 0 ? -give : last + give
}

/**
 * Where a swipe lands when the fingers lift at `position` (in panels) moving at
 * `velocity` (px/ms, positive toward the next panel).
 */
export const settleIndex = (position, velocity, count) => {
  let target
  if (velocity >= SWIPE_FLICK_VELOCITY) target = Math.floor(position) + 1
  else if (velocity <= -SWIPE_FLICK_VELOCITY) target = Math.ceil(position) - 1
  else target = Math.round(position)
  return clamp(target, 0, Math.max(0, count - 1))
}

/** The fingers' speed over the last moments of the gesture, in px/ms. */
export const liftVelocity = (samples) => {
  if (samples.length < 2) return 0
  const last = samples[samples.length - 1]
  let first = samples[0]
  for (const sample of samples) {
    if (last.t - sample.t <= SWIPE_VELOCITY_WINDOW_MS) { first = sample; break }
  }
  if (first === last) first = samples[samples.length - 2]
  return (last.x - first.x) / Math.max(last.t - first.t, 1)
}

/**
 * `targetRef` is the element whose wheel events drive it. They are listened for
 * directly rather than through React, whose wheel listeners are passive: a swipe
 * has to stop the panel under it scrolling sideways, and its coast too.
 */
export default function useSpaceSwipe({ targetRef, index, count, panelWidth, onSettle, enabled = true }) {
  const [progress, setProgress] = useState(index)
  const [dragging, setDragging] = useState(false)

  // 'idle' → 'pending' (not yet a swipe or a scroll) → 'swipe' | 'scroll' → 'spent'
  // (lifted; its coast is not ours) → 'idle' when the fingers come down again.
  const gesture = useRef({ mode: 'idle', axis: null, origin: index, startedAt: 0, x: 0, y: 0, samples: [], lastAt: 0, width: 0 })
  const progressRef = useRef(index)
  const hapticIndexRef = useRef(index)
  const idleTimerRef = useRef(0)
  const latest = useRef({ index, count, panelWidth, onSettle })
  useEffect(() => { latest.current = { index, count, panelWidth, onSettle } }, [index, count, panelWidth, onSettle])

  const show = useCallback((value) => {
    progressRef.current = value
    setProgress(value)
  }, [])

  // A tab chosen any other way (a click, a command, a map asking for its panel).
  useEffect(() => {
    if (gesture.current.mode === 'swipe') return
    hapticIndexRef.current = index
    show(index)
  }, [index, show])

  /** Show the panels part-way, ticking lightly as each one passes under the fingers. */
  const showFollowing = useCallback((next) => {
    show(next)
    const crossed = clamp(Math.round(next), 0, Math.max(0, latest.current.count - 1))
    if (crossed !== hapticIndexRef.current) {
      hapticIndexRef.current = crossed
      performHaptic(HAPTIC_ALIGNMENT)
    }
  }, [show])

  const release = useCallback(() => {
    window.clearTimeout(idleTimerRef.current)
    const g = gesture.current
    const phased = knowsTrackpadPhases()

    if (g.mode === 'swipe') {
      const { count: total, onSettle: settle } = latest.current
      const position = g.origin + g.x / g.width
      const lastAt = g.samples.length ? g.samples[g.samples.length - 1].t : g.startedAt
      const flicked = lastAt - g.startedAt < SWIPE_HOLD_MS
      const settled = settleIndex(position, liftVelocity(g.samples), total)
      // A flick turns one panel from where it set off, never two.
      const target = flicked ? clamp(settled, g.origin - 1, g.origin + 1) : settled
      if (target !== g.origin) performHaptic(HAPTIC_LEVEL)
      hapticIndexRef.current = target
      setDragging(false)
      show(target)
      settle?.(target)
    }

    // With phases the coast after a lift is heard as such, and swallowed until the
    // fingers come down again. Without them the pause that ended it was the coast's end.
    g.mode = phased && (g.mode === 'swipe' || g.mode === 'scroll') ? 'spent' : 'idle'
    g.samples = []
  }, [show])

  useEffect(() => onTrackpadPhase((phase) => {
    const g = gesture.current
    if (phase === 'ended') release()
    else if (phase === 'began') {
      if (g.mode === 'swipe') release()
      g.mode = 'idle'
    }
  }), [release])

  useEffect(() => () => window.clearTimeout(idleTimerRef.current), [])

  const onWheel = useCallback((event) => {
    if (event.ctrlKey) return
    const g = gesture.current
    const phased = knowsTrackpadPhases()

    // The coast after a swipe, until the fingers come down again — or until the wheel
    // goes quiet, since a mouse wheel never says the fingers did.
    if (g.mode === 'spent' && event.timeStamp - g.lastAt < SWIPE_IDLE_END_MS) {
      g.lastAt = event.timeStamp
      if (g.axis === 'x' && Math.abs(event.deltaX) >= Math.abs(event.deltaY)) event.preventDefault()
      return
    }
    if (g.mode === 'spent') g.mode = 'idle'
    // A coast that began somewhere else, carried in under the pointer.
    if (g.mode === 'idle' && isMomentumWheel(event)) return

    const step = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? 48 : 1
    const dx = event.deltaX * step
    const dy = event.deltaY * step
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return

    if (!phased) {
      window.clearTimeout(idleTimerRef.current)
      idleTimerRef.current = window.setTimeout(release, SWIPE_IDLE_END_MS)
    }
    g.lastAt = event.timeStamp

    if (g.mode === 'idle') {
      Object.assign(g, { mode: 'pending', axis: null, x: 0, y: 0, samples: [] })
    }

    if (g.mode === 'pending') {
      g.x += dx
      g.y += dy
      if (Math.hypot(g.x, g.y) < SWIPE_LOCK_PX) return
      if (Math.abs(g.x) <= Math.abs(g.y) * SWIPE_HORIZONTAL_BIAS) {
        g.mode = 'scroll'
        g.axis = 'y'
        return
      }
      const { index: current, count: total, panelWidth: width } = latest.current
      g.mode = 'swipe'
      g.axis = 'x'
      g.origin = clamp(Math.round(progressRef.current ?? current), 0, Math.max(0, total - 1))
      g.width = Number.isFinite(width) && width > 0 ? width : FALLBACK_PIXELS_PER_PANEL
      g.startedAt = event.timeStamp
      setDragging(true)
    } else if (g.mode === 'swipe') {
      event.preventDefault()
      // The still event a lift sends would read as the fingers having stopped.
      if (dx === 0) return
      g.x += dx
    } else {
      return
    }

    // Not yet held: no further than the next panel either way. The travel past it is
    // dropped, not banked, so a swipe that turns into a hold carries on from there.
    if (event.timeStamp - g.startedAt < SWIPE_HOLD_MS) g.x = clamp(g.x, -g.width, g.width)

    event.preventDefault()
    g.samples.push({ t: event.timeStamp, x: g.x })
    if (g.samples.length > 24) g.samples.shift()

    showFollowing(rubberBand(g.origin + g.x / g.width, latest.current.count))
  }, [release, showFollowing])

  useEffect(() => {
    const target = targetRef.current
    if (!target || !enabled) return undefined
    target.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => target.removeEventListener('wheel', onWheel, { capture: true })
  }, [enabled, onWheel, targetRef])

  /** Go straight to a panel, as a click does: no gesture, no haptics. */
  const jumpTo = useCallback((next) => {
    window.clearTimeout(idleTimerRef.current)
    gesture.current.mode = gesture.current.mode === 'spent' ? 'spent' : 'idle'
    hapticIndexRef.current = next
    setDragging(false)
    show(next)
  }, [show])

  /** The panels following something else being dragged (the selector's indicator). */
  const follow = useCallback((position) => {
    if (gesture.current.mode === 'swipe') return
    setDragging(true)
    showFollowing(rubberBand(position, latest.current.count))
  }, [showFollowing])

  /** That drag let go over a panel: glide there and choose it. */
  const settle = useCallback((target) => {
    const { count: total, index: current, onSettle: chosen } = latest.current
    const next = clamp(target, 0, Math.max(0, total - 1))
    if (next !== current) performHaptic(HAPTIC_LEVEL)
    hapticIndexRef.current = next
    setDragging(false)
    show(next)
    chosen?.(next)
  }, [show])

  return { progress, dragging, jumpTo, follow, settle }
}
