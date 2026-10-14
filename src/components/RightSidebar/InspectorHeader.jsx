/**
 * InspectorHeader — the inspector's selector bar: the layout's panels as icons (the
 * indicator slides with a swipe), a circle that swaps Write's panels for Typeset's,
 * and on right-click the two layouts and Customize Layout….
 */
import Icon from '../../ui/Icon.jsx'
import SidebarTabs from './SidebarTabs'
import { INSPECTOR_LAYOUT_INFO } from '../../lib/chromeLayout'
import { popUpNativeMenu } from '../../ui/useNativeMenu'
import { CUSTOMIZE_INSPECTOR_EVENT } from '../../hooks/contextMenu/toolbarMenu'

export default function InspectorHeader({ tabs, tab, setTab, layout, onChooseLayout, visualProgress, gestureActive, reducedMotion, onIndicatorDrag, onIndicatorDrop }) {
  const other = layout === 'finishing' ? 'drafting' : 'finishing'
  const menu = (event) => popUpNativeMenu(event, [
    { text: 'Write layout', checked: layout === 'drafting', action: () => onChooseLayout('drafting') },
    { text: 'Typeset layout', checked: layout === 'finishing', action: () => onChooseLayout('finishing') },
    { separator: true },
    { text: 'Customize layout…', action: () => window.dispatchEvent(new CustomEvent(CUSTOMIZE_INSPECTOR_EVENT)) },
  ])

  return (
    <div className="inspector-header" onContextMenu={menu}>
      <SidebarTabs
        tabs={tabs}
        tab={tab}
        setTab={setTab}
        visualProgress={visualProgress}
        gestureActive={gestureActive}
        reducedMotion={reducedMotion}
        onIndicatorDrag={onIndicatorDrag}
        onIndicatorDrop={onIndicatorDrop}
      />
      <button
        type="button"
        className="inspector-layout-switch"
        onClick={() => onChooseLayout(other)}
        title={`Switch to ${INSPECTOR_LAYOUT_INFO[other].title}`}
        aria-label={`Switch to the ${INSPECTOR_LAYOUT_INFO[other].title} panels`}
        data-layout={layout}
      >
        {/* Where it goes, not where you are: the tabs already say that. */}
        <Icon name={INSPECTOR_LAYOUT_INFO[other].icon} />
      </button>
    </div>
  )
}
