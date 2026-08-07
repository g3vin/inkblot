import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import SidebarTabs from './SidebarTabs'
import { RIGHT_SIDEBAR_TABS } from './sidebarTabsConfig'
import Workbench from './Workbench'
import NotesPanel from '../NotesPanel'
import HistoryPanel from './HistoryPanel'
import SearchPanel from './SearchPanel'
import ClipboardPanel from './ClipboardPanel'
import SFIcon from '../SFIcon'

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

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
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
  clearClipboardHistory,
  onDropToClipboard,
  projectName,
  jumpToText,
  onOpenSearchTarget,
}) {
  const prefersReducedMotion = useReducedMotion()
  const tabIds = useMemo(() => RIGHT_SIDEBAR_TABS.map(({ id }) => id), [])
  const activeTabIndex = Math.max(0, tabIds.indexOf(sidebarTab))
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

    visualTabProgressRef.current = nextIndex
    gestureOriginIndexRef.current = nextIndex
    gestureTotalDeltaRef.current = 0
    gestureModeRef.current = 'idle'
    gestureStartedAtRef.current = 0
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
    width: `${RIGHT_SIDEBAR_TABS.length * 100}%`,
    transform: `translateX(-${visualTabProgress * (100 / RIGHT_SIDEBAR_TABS.length)}%)`,
    transition: gestureActive || prefersReducedMotion
      ? 'none'
      : `transform ${SWIPE_SNAP_DURATION_MS}ms ${SWIPE_SNAP_EASING}`,
  }

  const renderPanel = (tabId) => {
    if (tabId === 'search') {
      return (
        <SearchPanel
          activeEditor={activeEditor}
          editor={editor}
          secondaryEditor={secondaryEditor}
          currentDoc={currentDoc}
          secondaryDoc={secondaryDoc}
          activeDoc={activeDoc}
          notesByDoc={notesByDoc}
          projectName={projectName}
          jumpToText={jumpToText}
          onOpenSearchTarget={onOpenSearchTarget}
        />
      )
    }

    if (tabId === 'clipboard') {
      return (
        <ClipboardPanel
          entries={clipboardHistory}
          onClear={clearClipboardHistory}
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
          currentDoc={currentDoc}
          secondaryDoc={secondaryDoc}
          activeDoc={activeDoc}
        />
      )
    }

    if (tabId === 'notes') {
      return (
        <NotesPanel
          notes={notes}
          setNotes={setNotes}
          jumpToText={jumpToText}
          clearActiveNoteHighlight={clearActiveNoteHighlight}
        />
      )
    }

    return (
      <HistoryPanel
        versions={versions?.[activeDoc] || []}
        setVersions={setVersions}
        editor={editor}
        projectName={projectName}
        docName={activeDoc}
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
        tab={sidebarTab}
        setTab={handleSelectTab}
        visualProgress={visualTabProgress}
        gestureActive={gestureActive}
        reducedMotion={prefersReducedMotion}
      />

      <div className="sidebar-content">
        <div className={`sidebar-panels-viewport${gestureActive ? ' is-gesture-active' : ''}`}>
          <div className="sidebar-panels-track" style={panelTrackStyle}>
            {RIGHT_SIDEBAR_TABS.map(({ id }) => (
              <section
                key={id}
                className={`sidebar-panel-pane${sidebarTab === id ? ' is-active' : ''}`}
                aria-hidden={sidebarTab !== id}
              >
                <div className="sidebar-panel-page">
                  {renderPanel(id)}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </aside>
  )
}
