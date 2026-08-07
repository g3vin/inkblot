import SFIcon from '../SFIcon'
import { RIGHT_SIDEBAR_TABS } from './sidebarTabsConfig'

const TAB_GAP_PX = 4
const TAB_BAR_PADDING_PX = 8
const TAB_SNAP_DURATION_MS = 260
const TAB_SNAP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export default function SidebarTabs({
  tab,
  setTab,
  visualProgress = 0,
  gestureActive = false,
  reducedMotion = false,
}) {
  const committedActiveIndex = Math.max(0, RIGHT_SIDEBAR_TABS.findIndex(({ id }) => id === tab))
  const visualActiveIndex = gestureActive
    ? clamp(Math.round(visualProgress), 0, RIGHT_SIDEBAR_TABS.length - 1)
    : committedActiveIndex
  const indicatorWidth = `calc((100% - ${((RIGHT_SIDEBAR_TABS.length - 1) * TAB_GAP_PX) + TAB_BAR_PADDING_PX}px) / ${RIGHT_SIDEBAR_TABS.length})`
  const indicatorTransform = `translateX(calc(${visualProgress * 100}% + ${visualProgress * TAB_GAP_PX}px))`

  return (
    <div className={`sidebar-tabs${gestureActive ? ' is-gesture-active' : ''}`}>
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

      {RIGHT_SIDEBAR_TABS.map(({ id, icon, label }, index) => {
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
            <SFIcon name={icon} filled={active} forceAnimate={gestureActive && active} />
          </button>
        )
      })}
    </div>
  )
}
