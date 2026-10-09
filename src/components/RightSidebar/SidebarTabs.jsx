/**
 * SidebarTabs.jsx — the right sidebar's tab strip. The active-tab indicator
 * tracks fractional swipe progress so it slides with the gesture.
 */
import Icon from '../../ui/Icon.jsx'
import { RIGHT_SIDEBAR_TABS } from './sidebarTabsConfig'

const TAB_GAP_PX = 4
const TAB_BAR_PADDING_PX = 8
const TAB_SNAP_DURATION_MS = 260
const TAB_SNAP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

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
}) {
  const committedActiveIndex = Math.max(0, tabs.findIndex(({ id }) => id === tab))
  const visualActiveIndex = gestureActive
    ? clamp(Math.round(visualProgress), 0, tabs.length - 1)
    : committedActiveIndex
  const indicatorWidth = `calc((100% - ${((tabs.length - 1) * TAB_GAP_PX) + TAB_BAR_PADDING_PX}px) / ${tabs.length})`
  const indicatorTransform = `translateX(calc(${visualProgress * 100}% + ${visualProgress * TAB_GAP_PX}px))`

  return (
    <div
      className={`sidebar-tabs${gestureActive ? ' is-gesture-active' : ''}`}
      style={{ '--sidebar-tab-count': tabs.length }}
    >
      <span
        className="sidebar-tabs-indicator"
        aria-hidden="true"
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
