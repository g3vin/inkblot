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
 *     The panels then spring there from the speed the fingers left them at, so the
 *     swipe and its landing are one movement; a click or another swipe mid-way
 *     redirects the spring rather than restarting it.
 *   - Past the first or last panel they give as a rubber band (Apple's, physics.js).
 *   - The momentum after a lift is swallowed, never read as more swiping; the next
 *     swipe starts when the fingers come down again.
 *
 * The lift is AppKit's (wheelPhase.js); WKWebView's wheel events carry no phase. Where
 * the app is not there to say (a browser), a pause in the wheel events stands in.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { isMomentumWheel, knowsTrackpadPhases, onTrackpadPhase } from '../lib/wheelPhase'
import { HAPTIC_ALIGNMENT, HAPTIC_GENERIC, HAPTIC_LEVEL, performHaptic } from '../lib/haptics'
import { SPRINGS, releaseSpring, rubberBand as stretch, settleTime, springAt, trackSample, velocityFrom } from '../ui/physics.js'
import { springTransition } from '../ui/useSpring.js'

/** A click's change of panel: the quick spring from rest. */
const CLICK_SNAP = 'var(--spring-quick-dur) var(--spring-quick)'

/** Travel before a gesture is read as a swipe or a scroll. */
export const SWIPE_LOCK_PX = 6
/** How much more sideways than up-and-down a gesture must be to swipe. */
export const SWIPE_HORIZONTAL_BIAS = 1.2
/**
 * Finger speed at the lift, in px/ms, that carries on to the next panel: a speed
 * threshold, as iOS pages, rather than a projection, which would carry a slow drift
 * over too. Above GESTURE.flick because macOS speeds a trackpad's scroll deltas up.
 */
export const SWIPE_FLICK_VELOCITY = 0.5
/** The stretch of the gesture its lift speed is measured over. */
export const SWIPE_VELOCITY_WINDOW_MS = 80
/** Without phases, a pause this long is taken for the lift. */
export const SWIPE_IDLE_END_MS = 120
/** How long a swipe is held before it may travel past the next panel. */
export const SWIPE_HOLD_MS = 220
/**
 * A landing this soon after the tick for the same panel is felt as one with it: a fast
 * swipe ticks onto the panel and lifts a moment later, and two taps that close read as
 * a stutter, so the landing's is dropped.
 */
export const SWIPE_ONE_TAP_MS = 150
/** Used when the sidebar's width is not known. */
const FALLBACK_PIXELS_PER_PANEL = 240

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

/** The furthest, in panels, a swipe stretches past the first or last. */
export const SWIPE_RUBBER_BAND = 0.3

/** Past either end the panels give, less and less, never past SWIPE_RUBBER_BAND. */
export const rubberBand = (position, count) => {
  const last = Math.max(0, count - 1)
  if (position < 0) return stretch(position, SWIPE_RUBBER_BAND)
  if (position > last) return last + stretch(position - last, SWIPE_RUBBER_BAND)
  return position
}

/**
 * Where a swipe lands when the fingers lift at `position` (in panels) moving at
 * `velocity` (px/ms, positive toward the next panel).
 */
export const settleIndex = (position, velocity, count, origin = position, commitAt = 0.5) => {
  let target
  if (velocity >= SWIPE_FLICK_VELOCITY) target = Math.floor(position) + 1
  else if (velocity <= -SWIPE_FLICK_VELOCITY) target = Math.ceil(position) - 1
  else target = committedIndex(position, origin, commitAt)
  return clamp(target, 0, Math.max(0, count - 1))
}

/**
 * The panel a swipe from `origin` that has reached `position` is on: each one along
 * once the fingers are `commitAt` of the way to it (a half is the nearest).
 */
export const committedIndex = (position, origin, commitAt = 0.5) => {
  if (commitAt === 0.5) return Math.round(position)
  const travel = position - origin
  return Math.round(origin) + Math.sign(travel) * Math.floor(Math.abs(travel) + 1 - commitAt)
}

/**
 * How long after the last wheel event the lift may be heard and still be the same
 * moment: AppKit's phase crosses the bridge after the deltas it ends. A longer gap is
 * the fingers resting on the trackpad before they lift, which slows the swipe.
 */
export const SWIPE_LIFT_LATENCY_MS = 48

/**
 * The fingers' speed over the last moments of the gesture, in px/ms, as they were at
 * `at` (the lift; the last event by default).
 */
export const liftVelocity = (samples, at = samples[samples.length - 1]?.t ?? 0) => (
  velocityFrom(samples, SWIPE_VELOCITY_WINDOW_MS, at).x
)

/**
 * `targetRef` is the element whose wheel events drive it. They are listened for
 * directly rather than through React, whose wheel listeners are passive: a swipe
 * has to stop the panel under it scrolling sideways, and its coast too. Wheel events
 * from inside an element matching `ignore` (a strip that scrolls sideways itself) are
 * left to it. `commitAt` is how far toward the next panel a swipe goes before it is on
 * it (the tick, and where letting go lands): the nearest by default.
 */
export default function useSpaceSwipe({ targetRef, index, count, panelWidth, onSettle, enabled = true, ignore = null, commitAt = 0.5 }) {
  // Where the panels are, published to the parts that draw it (useSwipeProgress,
  // SwipeTrack) rather than held as this hook's state: a sidebar re-rendered on every
  // wheel event would reconcile all its panels each time.
  const [store] = useState(() => {
    const listeners = new Set()
    return {
      value: index,
      set(value) {
        if (value === this.value) return
        this.value = value
        listeners.forEach((listener) => listener())
      },
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
  })
  const [dragging, setDragging] = useState(false)
  // How the panels go to rest once nothing holds them: the consumers' CSS transition.
  const [snap, setSnap] = useState(CLICK_SNAP)

  // 'idle' → 'pending' (not yet a swipe or a scroll) → 'swipe' | 'scroll' → 'spent'
  // (lifted; its coast is not ours) → 'idle' when the fingers come down again.
  const gesture = useRef({ mode: 'idle', axis: null, origin: index, startedAt: 0, x: 0, y: 0, samples: [], lastAt: 0, width: 0 })
  const progressRef = useRef(index)
  const hapticIndexRef = useRef(index)
  const tickedAtRef = useRef(-Infinity)
  /** The landing's tap, unless the tick onto `target` has only just been felt. */
  const land = useCallback((target, from) => {
    if (target === from) return
    if (hapticIndexRef.current === target && performance.now() - tickedAtRef.current < SWIPE_ONE_TAP_MS) return
    performHaptic(HAPTIC_LEVEL)
  }, [])
  const idleTimerRef = useRef(0)
  const latest = useRef({ index, count, panelWidth, onSettle, commitAt })
  useEffect(() => { latest.current = { index, count, panelWidth, onSettle, commitAt } }, [index, count, panelWidth, onSettle, commitAt])

  const followed = useRef([])
  // The spring the panels are gliding on, if any: where the CSS transition has them.
  const glideRef = useRef(null)

  /** Put the panels under the fingers. */
  const show = useCallback((value) => {
    progressRef.current = value
    store.set(value)
  }, [store])

  /**
   * Where the panels are drawn now: mid-glide, part of the way along their spring, not
   * at the panel they are going to. A swipe that catches them starts from here.
   */
  const drawnProgress = useCallback(() => {
    const glide = glideRef.current
    if (!glide) return progressRef.current
    const t = performance.now() - glide.at
    if (t >= glide.settle) return progressRef.current
    return springAt(glide.preset, glide.from, glide.to, glide.velocity, t).value
  }, [])

  /**
   * Go to a panel: put the panels there and let the consumers' CSS transition (`snap`)
   * carry them, on the compositor, from wherever they are drawn. Let go of with
   * `velocity` (panels/ms), the transition is that spring with the hand's speed baked
   * in (springTransition); chosen any other way (a click, a command), it is the quick
   * spring from rest. Never stepped here: that would render the whole sidebar every
   * frame, and a slow render would stall the panels mid-glide.
   */
  const glideTo = useCallback((target, velocity, pixelsPerPanel = FALLBACK_PIXELS_PER_PANEL) => {
    const from = drawnProgress()
    let preset = SPRINGS.quick
    if (velocity === undefined) setSnap(CLICK_SNAP)
    else {
      preset = Math.abs(velocity) > 0.0005 ? releaseSpring(velocity * pixelsPerPanel) : SPRINGS.smooth
      setSnap(springTransition(preset, { from, to: target, velocity }))
    }
    const speed = velocity ?? 0
    glideRef.current = { from, to: target, velocity: speed, preset, at: performance.now(), settle: settleTime(preset, { from, to: target, velocity: speed }) }
    show(target)
  }, [drawnProgress, show])

  // A tab chosen any other way (a click, a command, a map asking for its panel). A
  // swipe's own landing reports its panel too, and is already on its way there.
  useEffect(() => {
    if (gesture.current.mode === 'swipe') return
    hapticIndexRef.current = index
    if (progressRef.current === index) return
    glideTo(index)
  }, [index, glideTo])

  /**
   * Show the panels part-way, ticking lightly as each one passes under the fingers. A
   * swipe brought back toward where it set off (so letting go would stay there) taps
   * differently, so going back is felt as going back. A quick swipe is felt not at all:
   * until it has been held `SWIPE_HOLD_MS` nothing ticks, and one held past that ticks
   * then for wherever it has got to.
   */
  const showFollowing = useCallback((next) => {
    show(next)
    const g = gesture.current
    const swiping = g.mode === 'swipe'
    const lastAt = g.samples.length ? g.samples[g.samples.length - 1].t : g.startedAt
    if (swiping && lastAt - g.startedAt < SWIPE_HOLD_MS) return
    const reached = swiping ? committedIndex(next, g.origin, latest.current.commitAt) : Math.round(next)
    const crossed = clamp(reached, 0, Math.max(0, latest.current.count - 1))
    if (crossed !== hapticIndexRef.current) {
      const back = swiping && Math.abs(crossed - g.origin) < Math.abs(hapticIndexRef.current - g.origin)
      hapticIndexRef.current = crossed
      tickedAtRef.current = performance.now()
      performHaptic(back ? HAPTIC_GENERIC : HAPTIC_ALIGNMENT)
    }
  }, [show])

  const release = useCallback(() => {
    window.clearTimeout(idleTimerRef.current)
    const g = gesture.current
    const phased = knowsTrackpadPhases()

    if (g.mode === 'swipe') {
      const { count: total, onSettle: settle } = latest.current
      const at = g.origin + g.x / g.width
      const lastAt = g.samples.length ? g.samples[g.samples.length - 1].t : g.startedAt
      const flicked = lastAt - g.startedAt < SWIPE_HOLD_MS
      // Without phases the lift is only guessed from the quiet after the last event, so
      // that event is the lift.
      const liftedAt = phased ? Math.min(performance.now(), lastAt + SWIPE_LIFT_LATENCY_MS) : lastAt
      const velocity = liftVelocity(g.samples, liftedAt)
      const settled = settleIndex(at, velocity, total, g.origin, latest.current.commitAt)
      // A flick turns one panel from where it set off, never two.
      const target = flicked ? clamp(settled, g.origin - 1, g.origin + 1) : settled
      // A flick turns the panel without a tap, as it ticked none on the way.
      if (!flicked) land(target, g.origin)
      hapticIndexRef.current = target
      setDragging(false)
      // Fingers moving the panels left show the next one: the panels' speed is the
      // fingers' turned into panels per ms.
      glideTo(target, velocity / g.width, g.width)
      settle?.(target)
    }

    // With phases the coast after a lift is heard as such, and swallowed until the
    // fingers come down again. Without them the pause that ended it was the coast's end.
    g.mode = phased && (g.mode === 'swipe' || g.mode === 'scroll') ? 'spent' : 'idle'
    g.samples = []
  }, [glideTo, land])

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
    if (ignore && gesture.current.mode !== 'swipe' && event.target?.closest?.(ignore)) return
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
      const { count: total, panelWidth: width } = latest.current
      g.mode = 'swipe'
      g.axis = 'x'
      g.width = Number.isFinite(width) && width > 0 ? width : FALLBACK_PIXELS_PER_PANEL
      // Caught mid-glide, the panels are held where they are drawn, not at the panel
      // they were going to.
      const drawn = drawnProgress()
      glideRef.current = null
      g.origin = clamp(Math.round(drawn), 0, Math.max(0, total - 1))
      g.x += (drawn - g.origin) * g.width
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
    trackSample(g.samples, { t: event.timeStamp, x: g.x })

    showFollowing(rubberBand(g.origin + g.x / g.width, latest.current.count))
  }, [drawnProgress, ignore, release, showFollowing])

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
    glideTo(next)
  }, [glideTo])

  /** The panels following something else being dragged (the selector's indicator). */
  const follow = useCallback((at) => {
    if (gesture.current.mode === 'swipe') return
    glideRef.current = null
    setDragging(true)
    trackSample(followed.current, { t: performance.now(), x: at })
    showFollowing(rubberBand(at, latest.current.count))
  }, [showFollowing])

  /** That drag let go over a panel: glide there and choose it. */
  const settle = useCallback((target) => {
    const { count: total, index: current, onSettle: chosen } = latest.current
    const next = clamp(target, 0, Math.max(0, total - 1))
    land(next, current)
    hapticIndexRef.current = next
    setDragging(false)
    const { panelWidth: width } = latest.current
    glideTo(next, velocityFrom(followed.current).x, Number.isFinite(width) && width > 0 ? width : undefined)
    followed.current = []
    chosen?.(next)
  }, [glideTo, land])

  /**
   * `moving`: the panels are on the hand, painted as it goes, so nothing may ease them.
   * `snap`: otherwise, the transition's timing that carries them to `progress`.
   * `drawnProgress()`: where the panels are drawn this moment, for a drag that catches
   * them mid-glide (the selector's indicator).
   */
  const getProgress = useCallback(() => store.value, [store])
  return {
    subscribe: store.subscribe,
    getProgress,
    dragging,
    moving: dragging,
    snap,
    jumpTo,
    follow,
    settle,
    drawnProgress,
  }
}

/**
 * The swipe's progress (in panels) for the part that draws it, re-rendering only that
 * part as the fingers move. `select` narrows it (the nearest panel, say) so a part that
 * needs less re-renders less; it must return a plain value.
 */
export function useSwipeProgress(swipe, select = (progress) => progress) {
  return useSyncExternalStore(swipe.subscribe, () => select(swipe.getProgress()))
}

