/**
 * Right-sidebar tabs: every panel the inspector can show, as the header draws it.
 * Which of them a layout shows, and in what order, is the user's
 * (lib/chromeLayout.ts, useInspectorLayout).
 *
 * There is no Search tab: search is the bar above the panels, on every tab.
 */
import { INSPECTOR_TABS } from '../../lib/chromeLayout'

export const RIGHT_SIDEBAR_TABS = INSPECTOR_TABS.map(({ id, icon, title }) => ({ id, icon, label: title }))

const BY_ID = new Map(RIGHT_SIDEBAR_TABS.map((tab) => [tab.id, tab]))

/** The header's tabs for a list of ids, in that order. */
export const sidebarTabsFor = (ids) => ids.map((id) => BY_ID.get(id)).filter(Boolean)
