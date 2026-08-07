/**
 * RightSidebar.jsx — right panel with Search / Clipboard / Workbench /
 * Notes / History tabs.
 *
 * Tabs can be switched by clicking or by horizontal trackpad swipe. Most of
 * this file is the swipe-gesture engine: it distinguishes slow drags (panels
 * track the finger, snapping at a 25% threshold) from quick flicks (advance
 * exactly one tab), while filtering out vertical scrolling and macOS wheel
 * momentum events so tabs don't keep sliding after the fingers lift.
 * The SWIPE_* constants below are its tuning knobs.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useReducedMotion } from 'framer-motion'
import SidebarTabs from './SidebarTabs'
import { getRightSidebarTabs } from './sidebarTabsConfig'
import Workbench from './Workbench'
import NotesPanel from '../NotesPanel'
import HistoryPanel from './HistoryPanel'
import SidebarSearch from './SidebarSearch'
import ClipboardPanel from './ClipboardPanel'
import SFIcon from '../SFIcon'
import { isFilterScope } from '../../lib/sidebarSearch'
import { HAPTIC_ALIGNMENT, HAPTIC_LEVEL, performHaptic } from '../../lib/haptics'

const SWIPE_PIXELS_PER_TAB = 220
const SWIPE_INTENT_THRESHOLD_PX = 1.5
const SWIPE_HORIZONTAL_DOMINANCE = 0.95
const SWIPE_SETTLE_DELAY_MS = 220
const SWIPE_FLICK_SETTLE_DELAY_MS = 20
const SWIPE_DRAG_MOMENTUM_LOCK_MS = 90
const SWIPE_DRAG_RESTART_DELTA_PX = 10
const SWIPE_DRAG_SNAP_THRESHOLD = 0.25
const SWIPE_SNAP_DURATION_MS = 260
const SWIPE_SNAP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
const SWIPE_VERTICAL_SCROLL_LOCK_MS = 90
const SWIPE_VERTICAL_RELEASE_GAP_MS = 70
const SWIPE_VERTICAL_HORIZONTAL_RESTART_PX = 12
const SWIPE_VERTICAL_DOMINANCE = 1.15
const SWIPE_FLICK_FORCE_THRESHOLD_PX = 42
const SWIPE_FLICK_WINDOW_MS = 150
const SWIPE_FLICK_ACCUMULATED_THRESHOLD_PX = 64
const SWIPE_FLICK_VELOCITY_THRESHOLD = 0.45
const SWIPE_FLICK_RELEASE_WINDOW_MS = 260
const SWIPE_FLICK_RELEASE_THRESHOLD_PX = 52
const SWIPE_FLICK_RELEASE_VELOCITY_THRESHOLD = 0.28
const SWIPE_WHEEL_END_DELAY_MS = 90
const SWIPE_FLICK_REARM_MIN_DELAY_MS = 140
const SWIPE_FLICK_REARM_MIN_DELTA_PX = 28
const SWIPE_FLICK_REARM_DECAYED_DELTA_PX = 18
const SWIPE_FLICK_REARM_GROWTH = 1.85
const SWIPE_FLICK_REARM_GROWTH_DELTA_PX = 14
const EDGE_REVEAL_ZONE_PX = 12
/** Must match .search-overlay-card's width in Editor.css — the fly-in scales against it. */
const SEARCH_OVERLAY_WIDTH = 640

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

// WebKit exposes wheel gesture phase as a bitmask on wheel events
// (webkitPhase / webkitMomentumPhase); used to tell live finger input
// from post-release momentum.
const WHEEL_PHASE_BEGAN = 1
const WHEEL_PHASE_STATIONARY = 2
const WHEEL_PHASE_CHANGED = 4
const WHEEL_PHASE_ENDED = 8
const WHEEL_PHASE_CANCELLED = 16
const WHEEL_PHASE_MAY_BEGIN = 32

const hasWheelPhase = (phase, flag) => Number.isFinite(phase) && (phase & flag) === flag
const hasActiveWheelPhase = (phase) => (
  hasWheelPhase(phase, WHEEL_PHASE_BEGAN) ||
  hasWheelPhase(phase, WHEEL_PHASE_STATIONARY) ||
  hasWheelPhase(phase, WHEEL_PHASE_CHANGED) ||
  hasWheelPhase(phase, WHEEL_PHASE_MAY_BEGIN)
)
const hasMomentumPhase = (phase) => Number.isFinite(phase) && phase !== 0
const hasEndedWheelPhase = (phase) => (
  hasWheelPhase(phase, WHEEL_PHASE_ENDED) ||
  hasWheelPhase(phase, WHEEL_PHASE_CANCELLED)
)

/** Snap a fractional tab position to an index once 25% of the next tab is revealed. */
const getThresholdSnapIndex = (rawIndex, direction) => {
  if (direction > 0) {
    const baseIndex = Math.floor(rawIndex)
    const revealedAmount = rawIndex - baseIndex
    return baseIndex + (revealedAmount >= SWIPE_DRAG_SNAP_THRESHOLD ? 1 : 0)
  }

  if (direction < 0) {
    const baseIndex = Math.ceil(rawIndex)
    const revealedAmount = baseIndex - rawIndex
    return baseIndex - (revealedAmount >= SWIPE_DRAG_SNAP_THRESHOLD ? 1 : 0)
  }

  return Math.round(rawIndex)
}

export default function RightSidebar({
  width,
  onResize,
  resizing,
  collapsed,
  peeked,
  pinned,
  togglePin,
  onAutoCollapse,
  sidebarTab,
  setSidebarTab,
  tiles,
  setTiles,
  activeEditor,
  currentDoc,
  secondaryDoc,
  activeDoc,
  notesByDoc,
  secondaryEditor,
  notes,
  setNotes,
  clearActiveNoteHighlight,
  versions = [],
  editor,
  setVersions,
  clipboardHistory,
  onDropToClipboard,
  projectName,
  jumpToText,
  onOpenSearchTarget,
  refreshFiles,
  onOpenDocInTab,
  onOpenCompare,
}) {
  const prefersReducedMotion = useReducedMotion()
  const tabs = useMemo(() => getRightSidebarTabs(activeDoc), [activeDoc])
  const tabIds = useMemo(() => tabs.map(({ id }) => id), [tabs])
  const activeTabIndex = Math.max(0, tabIds.indexOf(sidebarTab))

  // If the strip ever changes shape again, never leave the sidebar on a tab that
  // no longer exists — no panel active, and the strip pointing at nothing.
  useEffect(() => {
    if (!tabIds.includes(sidebarTab)) setSidebarTab(tabIds[0])
  }, [sidebarTab, setSidebarTab, tabIds])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchScope, setSearchScope] = useState('panel')
  const [searchOverlay, setSearchOverlay] = useState(null)
  const searchAnchorRef = useRef(null)
  const [visualTabProgress, setVisualTabProgress] = useState(activeTabIndex)
  const [gestureActive, setGestureActive] = useState(false)
  const settleTimerRef = useRef(null)
  const visualTabProgressRef = useRef(activeTabIndex)
  const gestureOriginIndexRef = useRef(activeTabIndex)
  const gestureTotalDeltaRef = useRef(0)
  const gestureModeRef = useRef('idle')
  const gestureStartedAtRef = useRef(0)
  const wheelGestureEndTimerRef = useRef(null)
  const wheelFlickCommittedRef = useRef(false)
  const wheelFlickCommittedAtRef = useRef(0)
  const wheelFlickDirectionRef = useRef(0)
  const wheelFlickLastDeltaRef = useRef(0)
  const wheelFlickLastEventAtRef = useRef(0)
  const verticalScrollLockedRef = useRef(false)
  const verticalScrollLockTimerRef = useRef(null)
  const dragMomentumLockedRef = useRef(false)
  const dragMomentumLockTimerRef = useRef(null)
  const lastWheelEventAtRef = useRef(0)
  const hoveredRef = useRef(false)
  const lastPointerXRef = useRef(null)
  // Which panel the swipe was last felt over, so a crossing taps exactly once.
  const hapticIndexRef = useRef(activeTabIndex)

  /**
   * Open the centered search.
   *
   * When the sidebar is on screen the overlay grows out of the search bar's real
   * position, so it reads as the same bar moving rather than a new thing
   * appearing. With the sidebar collapsed there is nothing to fly from, so it
   * simply pops in the middle.
   *
   * The scope goes to 'All documents': `panel` means "filter the panel below
   * me", which is meaningless for a box floating in the middle of the screen.
   */
  const openSearchOverlay = useCallback(() => {
    const onScreen = !collapsed || peeked
    const rect = onScreen ? searchAnchorRef.current?.getBoundingClientRect() : null

    /*
     * The overlay centers in the gap between the two sidebars' inner edges —
     * or a window edge where a sidebar is collapsed. Measured from the DOM at
     * open time: this component only knows its own collapsed state, not the
     * left sidebar's, and both are always mounted (collapsed means width 0).
     */
    const leftRect = document.querySelector('.main-layout > .left-sidebar')?.getBoundingClientRect()
    const rightRect = document.querySelector('.main-layout > .right-sidebar')?.getBoundingClientRect()
    const leftEdge = leftRect && leftRect.width > 1 ? leftRect.right : 0
    const rightEdge = rightRect && rightRect.width > 1 ? rightRect.left : window.innerWidth

    setSearchScope((current) => (current === 'panel' ? 'project' : current))
    setSearchOverlay({
      centerX: (leftEdge + rightEdge) / 2,
      zoneWidth: Math.max(rightEdge - leftEdge, 320),
      origin: rect && rect.width > 0
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width }
        : null,
    })
  }, [collapsed, peeked])

  const closeSearchOverlay = useCallback(() => setSearchOverlay(null), [])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
      event.preventDefault()

      if (searchOverlay) closeSearchOverlay()
      else openSearchOverlay()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeSearchOverlay, openSearchOverlay, searchOverlay])

  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current) {
      window.clearTimeout(settleTimerRef.current)
      settleTimerRef.current = null
    }
  }, [])

  const clearWheelGestureEndTimer = useCallback(() => {
    if (wheelGestureEndTimerRef.current) {
      window.clearTimeout(wheelGestureEndTimerRef.current)
      wheelGestureEndTimerRef.current = null
    }
  }, [])

  const clearVerticalScrollLockTimer = useCallback(() => {
    if (verticalScrollLockTimerRef.current) {
      window.clearTimeout(verticalScrollLockTimerRef.current)
      verticalScrollLockTimerRef.current = null
    }
  }, [])

  const clearDragMomentumLockTimer = useCallback(() => {
    if (dragMomentumLockTimerRef.current) {
      window.clearTimeout(dragMomentumLockTimerRef.current)
      dragMomentumLockTimerRef.current = null
    }
  }, [])

  const scheduleDragMomentumUnlock = useCallback(() => {
    clearDragMomentumLockTimer()
    dragMomentumLockedRef.current = true
    dragMomentumLockTimerRef.current = window.setTimeout(() => {
      dragMomentumLockedRef.current = false
      dragMomentumLockTimerRef.current = null
    }, SWIPE_DRAG_MOMENTUM_LOCK_MS)
  }, [clearDragMomentumLockTimer])

  const scheduleVerticalScrollUnlock = useCallback(() => {
    clearVerticalScrollLockTimer()
    verticalScrollLockedRef.current = true
    verticalScrollLockTimerRef.current = window.setTimeout(() => {
      verticalScrollLockedRef.current = false
      verticalScrollLockTimerRef.current = null
    }, SWIPE_VERTICAL_SCROLL_LOCK_MS)
  }, [clearVerticalScrollLockTimer])

  const scheduleWheelGestureEnd = useCallback(() => {
    clearWheelGestureEndTimer()
    wheelGestureEndTimerRef.current = window.setTimeout(() => {
      wheelGestureEndTimerRef.current = null
      wheelFlickCommittedRef.current = false
      wheelFlickCommittedAtRef.current = 0
      wheelFlickDirectionRef.current = 0
      wheelFlickLastDeltaRef.current = 0
      wheelFlickLastEventAtRef.current = 0
      lastWheelEventAtRef.current = 0
      gestureStartedAtRef.current = 0
    }, SWIPE_WHEEL_END_DELAY_MS)
  }, [clearWheelGestureEndTimer])

  useEffect(() => {
    visualTabProgressRef.current = visualTabProgress
  }, [visualTabProgress])

  useEffect(() => {
    if (gestureActive) return
    visualTabProgressRef.current = activeTabIndex
    gestureOriginIndexRef.current = activeTabIndex
    gestureTotalDeltaRef.current = 0
    gestureModeRef.current = 'idle'
    gestureStartedAtRef.current = 0
    setVisualTabProgress(activeTabIndex)
  }, [activeTabIndex, gestureActive])

  useEffect(() => () => {
    clearSettleTimer()
    clearWheelGestureEndTimer()
    clearDragMomentumLockTimer()
    clearVerticalScrollLockTimer()
  }, [clearDragMomentumLockTimer, clearSettleTimer, clearVerticalScrollLockTimer, clearWheelGestureEndTimer])

  // End the current gesture: pick the final tab (flicks move exactly one tab,
  // drags snap by threshold), reset gesture state, and commit the tab change.
  const finalizeGesture = useCallback((rawIndex = visualTabProgressRef.current) => {
    clearSettleTimer()

    const originIndex = gestureOriginIndexRef.current
    const isFlick = gestureModeRef.current === 'flick'
    const minGestureIndex = isFlick ? Math.max(0, originIndex - 1) : 0
    const maxGestureIndex = isFlick ? Math.min(tabIds.length - 1, originIndex + 1) : tabIds.length - 1
    let nextIndex = originIndex

    if (isFlick) {
      const quickSwipeDirection = Math.sign(gestureTotalDeltaRef.current)
      if (quickSwipeDirection !== 0) {
        nextIndex = originIndex + quickSwipeDirection
      }
    } else {
      const dragDirection = Math.sign(gestureTotalDeltaRef.current || rawIndex - originIndex)
      nextIndex = getThresholdSnapIndex(rawIndex, dragDirection)
    }

    nextIndex = clamp(nextIndex, minGestureIndex, maxGestureIndex)
    const nextTab = tabIds[nextIndex]

    // Landing. Only ever reached from the swipe engine — selecting a tab by
    // click goes through handleSelectTab and stays silent, as asked.
    if (gestureTotalDeltaRef.current !== 0) performHaptic(HAPTIC_LEVEL)

    visualTabProgressRef.current = nextIndex
    gestureOriginIndexRef.current = nextIndex
    gestureTotalDeltaRef.current = 0
    gestureModeRef.current = 'idle'
    gestureStartedAtRef.current = 0
    hapticIndexRef.current = nextIndex
    setGestureActive(false)
    setVisualTabProgress(nextIndex)

    if (nextTab && nextTab !== sidebarTab) {
      setSidebarTab(nextTab)
    }
  }, [clearSettleTimer, setSidebarTab, sidebarTab, tabIds])

  const handleSelectTab = useCallback((nextTab) => {
    clearSettleTimer()
    setGestureActive(false)

    const nextIndex = tabIds.indexOf(nextTab)
    if (nextIndex === -1) return

    visualTabProgressRef.current = nextIndex
    gestureOriginIndexRef.current = nextIndex
    gestureTotalDeltaRef.current = 0
    gestureModeRef.current = 'idle'
    gestureStartedAtRef.current = 0
    // Silent (a click is not a swipe), but the crossing tracker still has to
    // follow along, or the next swipe would tick for a panel it never crossed.
    hapticIndexRef.current = nextIndex
    wheelFlickCommittedRef.current = false
    wheelFlickCommittedAtRef.current = 0
    wheelFlickDirectionRef.current = 0
    wheelFlickLastDeltaRef.current = 0
    wheelFlickLastEventAtRef.current = 0
    clearWheelGestureEndTimer()
    setVisualTabProgress(nextIndex)
    setSidebarTab(nextTab)
  }, [clearSettleTimer, clearWheelGestureEndTimer, setSidebarTab, tabIds])

  const isPointerInRevealZone = useCallback(() => (
    Number.isFinite(lastPointerXRef.current) &&
    lastPointerXRef.current >= window.innerWidth - EDGE_REVEAL_ZONE_PX
  ), [])

  const handleSidebarMouseEnter = useCallback((event) => {
    hoveredRef.current = true
    lastPointerXRef.current = event.clientX
  }, [])

  const handleSidebarMouseLeave = useCallback(() => {
    hoveredRef.current = false
    if (!pinned) onAutoCollapse?.()
  }, [onAutoCollapse, pinned])

  const handleSidebarMouseMove = useCallback((event) => {
    lastPointerXRef.current = event.clientX
  }, [])

  // Cmd+S while hovering the sidebar toggles its pinned state (mirrors LeftSidebar).
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!hoveredRef.current) return
      if (!event.metaKey || event.key.toLowerCase() !== 's') return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()

      if (pinned && !isPointerInRevealZone()) {
        hoveredRef.current = false
        onAutoCollapse?.()
        return
      }

      togglePin?.()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isPointerInRevealZone, onAutoCollapse, pinned, togglePin])

  // The swipe engine. Classifies each wheel event (fresh horizontal intent,
  // vertical scroll, momentum tail, flick re-arm) and drives the gesture state
  // machine: idle → undecided → hold (drag) or flick → finalize.
  const handleSidebarWheel = useCallback((event) => {
    const nativeEvent = event.nativeEvent || event
    const eventTime = Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now()
    const elapsedSinceWheelEvent = eventTime - lastWheelEventAtRef.current
    const absX = Math.abs(event.deltaX)
    const absY = Math.abs(event.deltaY)
    const hasHorizontalIntent =
      absX > SWIPE_INTENT_THRESHOLD_PX &&
      absX >= absY * SWIPE_HORIZONTAL_DOMINANCE
    const hasActiveWheelGesture = gestureModeRef.current !== 'idle'
    const hasVerticalScrollIntent =
      absY > SWIPE_INTENT_THRESHOLD_PX &&
      absY >= absX * SWIPE_VERTICAL_DOMINANCE
    const wheelMomentumPhase = nativeEvent.webkitMomentumPhase ?? nativeEvent.momentumPhase
    const wheelPhase = nativeEvent.webkitPhase ?? nativeEvent.phase
    const isMomentumEvent =
      hasMomentumPhase(wheelMomentumPhase) &&
      !hasActiveWheelPhase(wheelPhase)
    const isWheelPhaseEnded = hasEndedWheelPhase(wheelPhase)

    if (!hasActiveWheelGesture && isMomentumEvent) {
      event.preventDefault()
      scheduleDragMomentumUnlock()
      return
    }

    if (!hasActiveWheelGesture && verticalScrollLockedRef.current) {
      const hasFreshHorizontalGesture =
        elapsedSinceWheelEvent >= SWIPE_VERTICAL_RELEASE_GAP_MS &&
        hasHorizontalIntent &&
        absX >= SWIPE_VERTICAL_HORIZONTAL_RESTART_PX

      lastWheelEventAtRef.current = eventTime

      if (!hasFreshHorizontalGesture) {
        scheduleVerticalScrollUnlock()
        return
      }

      verticalScrollLockedRef.current = false
      clearVerticalScrollLockTimer()
    }

    lastWheelEventAtRef.current = eventTime

    if (!hasActiveWheelGesture && hasVerticalScrollIntent) {
      scheduleVerticalScrollUnlock()
      return
    }

    if (!hasHorizontalIntent && !hasActiveWheelGesture) return

    const stepMultiplier = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? 48 : 1
    const delta = event.deltaX * stepMultiplier
    if (!Number.isFinite(delta)) return

    if (delta === 0) {
      if (hasActiveWheelGesture && (isWheelPhaseEnded || isMomentumEvent)) {
        event.preventDefault()
        finalizeGesture(visualTabProgressRef.current)
        scheduleDragMomentumUnlock()
      }
      return
    }

    const absDelta = Math.abs(delta)
    const deltaDirection = Math.sign(delta)

    event.preventDefault()

    if (hasActiveWheelGesture && gestureModeRef.current !== 'flick' && isMomentumEvent) {
      const originIndex = gestureOriginIndexRef.current
      const totalDelta = Math.abs(gestureTotalDeltaRef.current)
      const elapsed = gestureStartedAtRef.current ? eventTime - gestureStartedAtRef.current : 0
      const velocity = totalDelta / Math.max(elapsed, 1)
      const releaseFlickDirection = Math.sign(gestureTotalDeltaRef.current || delta)
      const isReleaseFlick =
        gestureModeRef.current === 'undecided' &&
        releaseFlickDirection !== 0 &&
        elapsed <= SWIPE_FLICK_RELEASE_WINDOW_MS &&
        totalDelta >= SWIPE_FLICK_RELEASE_THRESHOLD_PX &&
        velocity >= SWIPE_FLICK_RELEASE_VELOCITY_THRESHOLD

      if (isReleaseFlick) {
        gestureModeRef.current = 'flick'
        wheelFlickCommittedRef.current = true
        wheelFlickCommittedAtRef.current = eventTime
        wheelFlickDirectionRef.current = releaseFlickDirection
        wheelFlickLastDeltaRef.current = delta
        wheelFlickLastEventAtRef.current = eventTime
        scheduleWheelGestureEnd()
        finalizeGesture(originIndex + releaseFlickDirection)
      } else {
        finalizeGesture(visualTabProgressRef.current)
      }

      scheduleDragMomentumUnlock()
      return
    }

    if (!hasActiveWheelGesture && dragMomentumLockedRef.current) {
      if (absDelta < SWIPE_DRAG_RESTART_DELTA_PX) {
        scheduleDragMomentumUnlock()
        return
      }

      dragMomentumLockedRef.current = false
      clearDragMomentumLockTimer()
    }

    if (wheelFlickCommittedRef.current) {
      const elapsedSinceFlick = eventTime - wheelFlickCommittedAtRef.current
      const previousAbsDelta = Math.abs(wheelFlickLastDeltaRef.current)
      const hasReversedDirection =
        deltaDirection !== 0 &&
        wheelFlickDirectionRef.current !== 0 &&
        deltaDirection !== wheelFlickDirectionRef.current
      const hasSameDirection = deltaDirection === wheelFlickDirectionRef.current
      const hasDecayedThenBurst =
        previousAbsDelta <= SWIPE_FLICK_REARM_DECAYED_DELTA_PX &&
        absDelta >= SWIPE_FLICK_REARM_MIN_DELTA_PX
      const hasSharpGrowth =
        absDelta >= previousAbsDelta + SWIPE_FLICK_REARM_GROWTH_DELTA_PX &&
        absDelta >= previousAbsDelta * SWIPE_FLICK_REARM_GROWTH
      const hasFreshImpulse =
        hasSameDirection &&
        elapsedSinceFlick >= SWIPE_FLICK_REARM_MIN_DELAY_MS &&
        (hasDecayedThenBurst || hasSharpGrowth)

      if (!hasReversedDirection && !hasFreshImpulse) {
        wheelFlickLastDeltaRef.current = delta
        wheelFlickLastEventAtRef.current = eventTime
        scheduleWheelGestureEnd()
        return
      }

      wheelFlickCommittedRef.current = false
      wheelFlickCommittedAtRef.current = 0
      wheelFlickDirectionRef.current = 0
      wheelFlickLastDeltaRef.current = 0
      wheelFlickLastEventAtRef.current = 0
      clearWheelGestureEndTimer()
    }

    if (!hasActiveWheelGesture) {
      gestureOriginIndexRef.current = clamp(
        Math.round(visualTabProgressRef.current),
        0,
        tabIds.length - 1
      )
      gestureTotalDeltaRef.current = 0
      gestureModeRef.current = 'undecided'
      gestureStartedAtRef.current = eventTime
      setGestureActive(true)
    }

    gestureTotalDeltaRef.current += delta

    const originIndex = gestureOriginIndexRef.current
    const totalOffset = gestureTotalDeltaRef.current / SWIPE_PIXELS_PER_TAB

    if (gestureModeRef.current === 'undecided') {
      const elapsed = eventTime - gestureStartedAtRef.current
      const totalDelta = Math.abs(gestureTotalDeltaRef.current)
      const accumulatedVelocity = totalDelta / Math.max(elapsed, 1)
      const isFastAccumulatedSwipe = elapsed <= SWIPE_FLICK_WINDOW_MS
        && totalDelta >= SWIPE_FLICK_ACCUMULATED_THRESHOLD_PX
        && accumulatedVelocity >= SWIPE_FLICK_VELOCITY_THRESHOLD

      if (absDelta >= SWIPE_FLICK_FORCE_THRESHOLD_PX || isFastAccumulatedSwipe) {
        gestureModeRef.current = 'flick'
        wheelFlickCommittedRef.current = true
        wheelFlickCommittedAtRef.current = eventTime
        wheelFlickDirectionRef.current = Math.sign(gestureTotalDeltaRef.current)
        wheelFlickLastDeltaRef.current = delta
        wheelFlickLastEventAtRef.current = eventTime
        scheduleWheelGestureEnd()
        finalizeGesture(originIndex + Math.sign(gestureTotalDeltaRef.current))
        return
      }

      if (elapsed > SWIPE_FLICK_WINDOW_MS) {
        gestureModeRef.current = 'hold'
      }
    }

    const gestureMode = gestureModeRef.current
    const shouldTrackDragSwipe = gestureMode !== 'flick'
    const minGestureIndex = gestureMode === 'flick' ? Math.max(0, originIndex - 1) : 0
    const maxGestureIndex = gestureMode === 'flick'
      ? Math.min(tabIds.length - 1, originIndex + 1)
      : tabIds.length - 1

    const nextProgress = shouldTrackDragSwipe
      ? clamp(originIndex + totalOffset, minGestureIndex, maxGestureIndex)
      : originIndex

    visualTabProgressRef.current = nextProgress
    setVisualTabProgress(nextProgress)

    // Crossing. A light tick each time the drag passes over another panel, which
    // is the moment the panel under the finger changes.
    const crossedIndex = clamp(Math.round(nextProgress), 0, tabIds.length - 1)
    if (crossedIndex !== hapticIndexRef.current) {
      hapticIndexRef.current = crossedIndex
      performHaptic(HAPTIC_ALIGNMENT)
    }

    if (isWheelPhaseEnded && gestureModeRef.current !== 'flick') {
      finalizeGesture(nextProgress)
      scheduleDragMomentumUnlock()
      return
    }

    clearSettleTimer()
    const settleDelay = gestureModeRef.current === 'flick'
      ? SWIPE_FLICK_SETTLE_DELAY_MS
      : SWIPE_SETTLE_DELAY_MS
    settleTimerRef.current = window.setTimeout(() => {
      finalizeGesture(nextProgress)
    }, settleDelay)
  }, [clearDragMomentumLockTimer, clearSettleTimer, clearVerticalScrollLockTimer, clearWheelGestureEndTimer, finalizeGesture, scheduleDragMomentumUnlock, scheduleVerticalScrollUnlock, scheduleWheelGestureEnd, tabIds.length])

  const panelTrackStyle = {
    '--sidebar-pane-count': tabs.length,
    width: `${tabs.length * 100}%`,
    transform: `translateX(-${visualTabProgress * (100 / tabs.length)}%)`,
    transition: gestureActive || prefersReducedMotion
      ? 'none'
      : `transform ${SWIPE_SNAP_DURATION_MS}ms ${SWIPE_SNAP_EASING}`,
  }

  // Only mount the active panel — plus the neighbors while swiping, so
  // partially revealed panels have content.
  const renderedPanelIds = useMemo(() => {
    const ids = new Set([sidebarTab])
    if (!gestureActive) return ids

    const visualIndex = clamp(Math.round(visualTabProgress), 0, tabIds.length - 1)
    ;[
      activeTabIndex,
      visualIndex - 1,
      visualIndex,
      visualIndex + 1,
    ].forEach((index) => {
      const id = tabIds[index]
      if (id) ids.add(id)
    })

    return ids
  }, [activeTabIndex, gestureActive, sidebarTab, tabIds, visualTabProgress])

  // Panels only filter while the bar is in its `panel` scope. Once it is
  // searching a document, notes, or files, the list underneath must be left
  // alone — otherwise a document search would also empty out the panel behind it.
  const panelQuery = isFilterScope(searchScope) ? searchQuery : ''

  // One search, two places it can be drawn. Both copies share this state, so the
  // overlay opens on whatever you had already typed.
  const searchProps = {
    query: searchQuery,
    setQuery: setSearchQuery,
    scope: searchScope,
    setScope: setSearchScope,
    tab: sidebarTab,
    activeEditor,
    editor,
    secondaryEditor,
    currentDoc,
    secondaryDoc,
    activeDoc,
    notesByDoc,
    projectName,
    onOpenSearchTarget,
  }

  const searchOverlayNode = searchOverlay ? createPortal(
    <div
      className="search-overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) closeSearchOverlay()
      }}
    >
      <div
        className={`search-overlay-card${searchOverlay.origin ? ' is-flying' : ''}`}
        style={{
          '--search-center-x': `${searchOverlay.centerX}px`,
          '--search-zone-width': `${searchOverlay.zoneWidth}px`,
          ...(searchOverlay.origin ? {
            // The fly-in lands on the zone's center, so it starts offset from THAT.
            '--search-fly-dx': `${searchOverlay.origin.x - searchOverlay.centerX}px`,
            '--search-fly-dy': `${searchOverlay.origin.y - window.innerHeight / 2}px`,
            '--search-fly-scale': searchOverlay.origin.width / SEARCH_OVERLAY_WIDTH,
          } : null),
        }}
      >
        <SidebarSearch
          {...searchProps}
          variant="overlay"
          onCloseOverlay={closeSearchOverlay}
          onOpenSearchTarget={(target) => {
            closeSearchOverlay()
            onOpenSearchTarget?.(target)
          }}
        />
      </div>
    </div>,
    document.body,
  ) : null

  const renderPanel = (tabId) => {
    if (tabId === 'clipboard') {
      return (
        <ClipboardPanel
          entries={clipboardHistory}
          query={panelQuery}
          onDropToClipboard={onDropToClipboard}
        />
      )
    }

    if (tabId === 'workbench') {
      return (
        <Workbench
          tiles={tiles}
          setTiles={setTiles}
          editor={editor}
          secondaryEditor={secondaryEditor}
          secondaryDoc={secondaryDoc}
          query={panelQuery}
        />
      )
    }

    if (tabId === 'notes') {
      return (
        <NotesPanel
          notes={notes}
          setNotes={setNotes}
          docName={activeDoc}
          projectName={projectName}
          query={panelQuery}
          jumpToText={jumpToText}
          clearActiveNoteHighlight={clearActiveNoteHighlight}
        />
      )
    }

    return (
      <HistoryPanel
        versions={versions?.[activeDoc] || []}
        setVersions={setVersions}
        // The history acts on the ACTIVE document, which may live in either pane.
        editor={activeDoc === secondaryDoc && activeDoc !== currentDoc ? secondaryEditor : editor}
        projectName={projectName}
        docName={activeDoc}
        query={panelQuery}
        refreshFiles={refreshFiles}
        onOpenDocInTab={onOpenDocInTab}
        onOpenCompare={onOpenCompare}
      />
    )
  }

  return (
    <aside
      className={`sidebar right-sidebar${collapsed && !peeked ? ' collapsed' : ''}${peeked ? ' is-peeked' : ''}${resizing ? ' is-resizing' : ''}`}
      style={{ width }}
      onWheelCapture={handleSidebarWheel}
      onMouseEnter={handleSidebarMouseEnter}
      onMouseLeave={handleSidebarMouseLeave}
      onMouseMove={handleSidebarMouseMove}
    >
      <div className="resizer resizer-left" onMouseDown={onResize} />

      <div className="sidebar-topbar">
        <div className="right-sidebar-global-title" aria-hidden="true">
          <div
            className="right-sidebar-global-title-track"
            style={{
              '--right-sidebar-title-progress': visualTabProgress,
              transition: gestureActive || prefersReducedMotion
                ? 'none'
                : `transform ${SWIPE_SNAP_DURATION_MS}ms ${SWIPE_SNAP_EASING}`,
            }}
          >
            {tabs.map(({ id, label }) => (
              <span key={id} className="panel-header-label right-sidebar-global-title-label">
                {label}
              </span>
            ))}
          </div>
        </div>
        <button
          className={`sidebar-pin${pinned ? ' active' : ''}`}
          onClick={togglePin}
          title={pinned ? 'Unpin sidebar' : 'Pin sidebar'}
          aria-label={pinned ? 'Unpin sidebar' : 'Pin sidebar'}
        >
          <SFIcon name="pin" filled={pinned} />
        </button>
      </div>

      <SidebarTabs
        tabs={tabs}
        tab={sidebarTab}
        setTab={handleSelectTab}
        visualProgress={visualTabProgress}
        gestureActive={gestureActive}
        reducedMotion={prefersReducedMotion}
      />

      {/* While the overlay is up it IS this bar, so the copy here would be a
          duplicate. It is hidden rather than unmounted: the header keeps its box,
          so the panels below do not jump as the overlay opens and closes. */}
      <div
        className={`right-sidebar-global-header${searchOverlay ? ' is-search-detached' : ''}`}
        ref={searchAnchorRef}
      >
        <SidebarSearch
          {...searchProps}
          active={!searchOverlay}
          onOpenOverlay={openSearchOverlay}
        />
      </div>

      <div className="sidebar-content">
        <div className={`sidebar-panels-viewport${gestureActive ? ' is-gesture-active' : ''}`}>
          <div className="sidebar-panels-track" style={panelTrackStyle}>
            {tabs.map(({ id }) => (
              <section
                key={id}
                className={`sidebar-panel-pane${sidebarTab === id ? ' is-active' : ''}`}
                aria-hidden={sidebarTab !== id}
              >
                <div className="sidebar-panel-page">
                  {renderedPanelIds.has(id) ? renderPanel(id) : null}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>

      {searchOverlayNode}
    </aside>
  )
}
