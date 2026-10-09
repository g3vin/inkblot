/**
 * SidebarTabs.jsx — the sidebars' tab strip (the inspector's panels, the left sidebar's
 * Files and Book). The active-tab indicator tracks fractional swipe progress so it
 * slides with the gesture, and can itself be grabbed and dragged to another tab: the
 * panels follow it (`onIndicatorDrag`) and letting go chooses the tab it is over
 * (`onIndicatorDrop`). While it is held or swiped (not a quick flick) it lifts and grows, as macOS's
 * segmented controls do, and settles back as it lands.
 *
 * It is placed from the buttons' measured boxes, rounded to whole device pixels,
 * rather than from a percentage of the strip: a fractional position is drawn one way
 * while the snap animates (on its own layer) and another once it stops, so the pill
 * would nudge sideways after it had landed, more the further along the tab.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SWIPE_HOLD_MS } from '../../hooks/useSpaceSwipe'
import Icon from '../../ui/Icon.jsx'
import { RIGHT_SIDEBAR_TABS } from './sidebarTabsConfig'

const TAB_GAP_PX = 4
// The strip's side padding, both sides: a kerf each in the sidebars (FileTree.css).
const TAB_BAR_PADDING_PX = 6
const TAB_SNAP_DURATION_MS = 260
const TAB_SNAP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
/** The furthest the indicator runs past the first or last tab: over the strip's and
 *  the panel's padding, never out past the panel's edge. */
const INDICATOR_OVERSHOOT_PX = 8
/** Travel before a press on the indicator becomes a drag. */
const INDICATOR_DRAG_SLOP_PX = 3

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const snapToDevicePixel = (value) => {
  const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  return Math.round(value * ratio) / ratio
}

/** Each button's left edge and width inside the strip, in its own (untransformed) px. */
const measureSlots = (strip) => {
  const box = strip.getBoundingClientRect()
  // The sidebars slide and scale in: undo any transform above the strip.
  const scale = box.width > 0 && strip.offsetWidth > 0 ? strip.offsetWidth / box.width : 1
  return [...strip.querySelectorAll(':scope > button')].map((button) => {
    const rect = button.getBoundingClientRect()
    return { left: (rect.left - box.left) * scale - strip.clientLeft, width: rect.width * scale }
  })
}

export default function SidebarTabs({
  // Which tabs exist depends on the open document (a canvas has no History), and
  // the indicator's width and travel are computed from that count — so the strip
  // and the panel track must be handed the same list.
  tabs = RIGHT_SIDEBAR_TABS,
  tab,
  setTab,
  visualProgress = 0,
  gestureActive = false,
  reducedMotion = false,
  onIndicatorDrag,
  onIndicatorDrop,
}) {
  const committedActiveIndex = Math.max(0, tabs.findIndex(({ id }) => id === tab))
  const stripRef = useRef(null)
  const dragRef = useRef(null)
  const [grabbing, setGrabbing] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [slots, setSlots] = useState(null)

  useLayoutEffect(() => {
    const strip = stripRef.current
    if (!strip) return undefined
    const update = () => {
      const next = measureSlots(strip)
      setSlots((previous) => (
        previous && previous.length === next.length
          && previous.every((slot, i) => slot.left === next[i].left && slot.width === next[i].width)
          ? previous
          : next
      ))
    }
    update()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(update)
    observer.observe(strip)
    return () => observer.disconnect()
  }, [tabs.length])

  const visualActiveIndex = gestureActive
    ? clamp(Math.round(visualProgress), 0, tabs.length - 1)
    : committedActiveIndex
  // Between the tabs it moves from one button to the next; past either end the
  // panels' rubber band is drawn as a few pixels of give.
  const restingProgress = clamp(visualProgress, 0, tabs.length - 1)
  const overshoot = visualProgress - restingProgress
  const measured = slots && slots.length === tabs.length
  let indicatorPlacement
  if (measured) {
    const from = slots[Math.floor(restingProgress)]
    const to = slots[Math.ceil(restingProgress)]
    const along = restingProgress - Math.floor(restingProgress)
    const width = from.width + (to.width - from.width) * along
    const give = clamp(overshoot * width, -INDICATOR_OVERSHOOT_PX, INDICATOR_OVERSHOOT_PX)
    const x = from.left + (to.left - from.left) * along + give
    indicatorPlacement = {
      left: 0,
      width: `${snapToDevicePixel(width)}px`,
      transform: `translateX(${snapToDevicePixel(x)}px)`,
    }
  } else {
    // Before the first measure: the same place, worked out from the strip's padding.
    indicatorPlacement = {
      width: `calc((100% - ${((tabs.length - 1) * TAB_GAP_PX) + TAB_BAR_PADDING_PX}px) / ${tabs.length})`,
      transform: `translateX(calc(${restingProgress * 100}% + ${restingProgress * TAB_GAP_PX}px`
        + ` + clamp(-${INDICATOR_OVERSHOOT_PX}px, ${overshoot * 100}%, ${INDICATOR_OVERSHOOT_PX}px)))`,
    }
  }
  // A quick flick lands without it: the pill only lifts once a press or swipe has
  // been held as long as a swipe takes to be more than a flick.
  const holding = !reducedMotion && (gestureActive || pressed)
  const [lifted, setLifted] = useState(false)
  useEffect(() => {
    if (!holding) {
      setLifted(false)
      return undefined
    }
    const timer = window.setTimeout(() => setLifted(true), SWIPE_HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [holding])

  // The indicator moves one tab per (its width + the gap) of pointer travel.
  const onIndicatorPointerDown = (event) => {
    if (event.button !== 0 || tabs.length < 2) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setPressed(true)
    dragRef.current = {
      startX: event.clientX,
      origin: committedActiveIndex,
      step: event.currentTarget.getBoundingClientRect().width + TAB_GAP_PX,
      moved: false,
      position: committedActiveIndex,
    }
  }
  const onIndicatorPointerMove = (event) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.startX
    if (!drag.moved && Math.abs(dx) < INDICATOR_DRAG_SLOP_PX) return
    if (!drag.moved) setGrabbing(true)
    drag.moved = true
    drag.position = drag.origin + dx / Math.max(drag.step, 1)
    onIndicatorDrag?.(drag.position)
  }
  const onIndicatorPointerUp = () => {
    const drag = dragRef.current
    dragRef.current = null
    setGrabbing(false)
    setPressed(false)
    if (!drag?.moved) return
    const target = clamp(Math.round(drag.position), 0, tabs.length - 1)
    if (onIndicatorDrop) onIndicatorDrop(target)
    else if (tabs[target].id !== tab) setTab(tabs[target].id)
  }

  return (
    <div
      ref={stripRef}
      className={`sidebar-tabs${gestureActive ? ' is-gesture-active' : ''}${grabbing ? ' is-grabbing' : ''}`}
      style={{ '--sidebar-tab-count': tabs.length }}
    >
      <span
        className={`sidebar-tabs-indicator${lifted ? ' is-lifted' : ''}`}
        aria-hidden="true"
        onPointerDown={onIndicatorPointerDown}
        onPointerMove={onIndicatorPointerMove}
        onPointerUp={onIndicatorPointerUp}
        onPointerCancel={onIndicatorPointerUp}
        style={{
          ...indicatorPlacement,
          transition: gestureActive || reducedMotion
            ? 'none'
            : `transform ${TAB_SNAP_DURATION_MS}ms ${TAB_SNAP_EASING}`,
          // The pill's grow (its insets, in the stylesheet) eases in and out on its
          // own, even while the position follows the fingers without one.
          '--sidebar-tabs-grow-duration': reducedMotion ? '0ms' : `${TAB_SNAP_DURATION_MS}ms`,
          '--sidebar-tabs-grow-easing': TAB_SNAP_EASING,
        }}
      >
        <span className="sidebar-tabs-indicator-pill" />
      </span>

      {tabs.map(({ id, icon, label }, index) => {
        const active = index === visualActiveIndex
        const selected = tab === id
        return (
          <button
            key={id}
            className={active ? 'active' : ''}
            onClick={() => setTab(id)}
            aria-label={label}
            title={label}
            aria-pressed={selected}
          >
            <Icon name={icon} active={active} />
          </button>
        )
      })}
    </div>
  )
}
