/**
 * Right-sidebar tab registry (order defines swipe/tab order).
 *
 * There is no Search tab: search is the bar above the panels, on every tab.
 */
export const RIGHT_SIDEBAR_TABS = [
  { id: 'clipboard', icon: 'doc.on.clipboard', label: 'Clipboard' },
  { id: 'workbench', icon: 'hammer', label: 'Workbench' },
  { id: 'notes', icon: 'doc.text', label: 'Notes' },
  { id: 'timeline', icon: 'timeline', label: 'Timeline' },
  { id: 'history', icon: 'clock', label: 'History' },
]

/**
 * The tabs available for a given document. Every document gets the same strip:
 * text documents and canvases both keep version history now (text embeds it in
 * the document file, canvases keep a `.versions/` sidecar), so History applies
 * everywhere — and a constant strip keeps the tabs from re-spacing as you move
 * between documents.
 */
export const getRightSidebarTabs = () => RIGHT_SIDEBAR_TABS
