/**
 * SidebarTabs.jsx — the sidebars' tab strip (the inspector's panels, the left sidebar's
 * Files and Book). The active-tab indicator tracks fractional swipe progress so it
 * slides with the gesture, and can itself be grabbed and dragged to another tab: the
 * panels follow it (`onIndicatorDrag`) and letting go chooses the tab it is over
 * (`onIndicatorDrop`).
 */
import { useRef, useState } from 'react'
import Icon from '../../ui/Icon.jsx'
import { RIGHT_SIDEBAR_TABS } from './sidebarTabsConfig'

const TAB_GAP_PX = 4
const TAB_BAR_PADDING_PX = 8
const TAB_SNAP_DURATION_MS = 260
const TAB_SNAP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
/** The furthest the indicator runs past the first or last tab: over the strip's and
 *  the panel's padding, never out past the panel's edge. */
const INDICATOR_OVERSHOOT_PX = 8
/** Travel before a press on the indicator becomes a drag. */
const INDICATOR_DRAG_SLOP_PX = 3

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

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
  const dragRef = useRef(null)
  const [grabbing, setGrabbing] = useState(false)
  const visualActiveIndex = gestureActive
    ? clamp(Math.round(visualProgress), 0, tabs.length - 1)
    : committedActiveIndex
  const indicatorWidth = `calc((100% - ${((tabs.length - 1) * TAB_GAP_PX) + TAB_BAR_PADDING_PX}px) / ${tabs.length})`
  // Between the tabs it moves one tab per (its width + the gap); past either end the
  // panels' rubber band is drawn as a few pixels of give.
  const restingProgress = clamp(visualProgress, 0, tabs.length - 1)
  const overshoot = visualProgress - restingProgress
  const indicatorTransform = `translateX(calc(${restingProgress * 100}% + ${restingProgress * TAB_GAP_PX}px`
    + ` + clamp(-${INDICATOR_OVERSHOOT_PX}px, ${overshoot * 100}%, ${INDICATOR_OVERSHOOT_PX}px)))`

  // The indicator moves one tab per (its width + the gap) of pointer travel.
  const onIndicatorPointerDown = (event) => {
    if (event.button !== 0 || tabs.length < 2) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
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
    if (!drag?.moved) return
    const target = clamp(Math.round(drag.position), 0, tabs.length - 1)
    if (onIndicatorDrop) onIndicatorDrop(target)
    else if (tabs[target].id !== tab) setTab(tabs[target].id)
  }

  return (
    <div
      className={`sidebar-tabs${gestureActive ? ' is-gesture-active' : ''}${grabbing ? ' is-grabbing' : ''}`}
      style={{ '--sidebar-tab-count': tabs.length }}
    >
      <span
        className="sidebar-tabs-indicator"
        aria-hidden="true"
        onPointerDown={onIndicatorPointerDown}
        onPointerMove={onIndicatorPointerMove}
        onPointerUp={onIndicatorPointerUp}
        onPointerCancel={onIndicatorPointerUp}
        style={{
          width: indicatorWidth,
          transform: indicatorTransform,
          transition: gestureActive || reducedMotion
            ? 'none'
            : `transform ${TAB_SNAP_DURATION_MS}ms ${TAB_SNAP_EASING}`,
        }}
      />

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
