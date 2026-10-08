/**
 * useInspectorLayout — the inspector's two sets of panels, as Customize Layout… left
 * them, and which one is up.
 *
 * The layouts are the window's two modes' panels: Write's while writing, Typeset's
 * while typesetting (lib/chromeLayout.ts). Choosing a layout switches the mode, and a
 * mode change brings its layout with the tab it last showed. Kept under
 * inkblot.inspector.layouts, read synchronously from the preference cache.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { shellBridge } from '../../bridge'
import { getPreference, setPreference } from '../../lib/preferences'
import {
  INSPECTOR_LAYOUTS_KEY,
  INSPECTOR_LAYOUT_INFO,
  layoutForMode,
  moveTab,
  normalizeInspectorLayouts,
  rememberTab,
  restoreInspectorDefaults,
  serializeInspectorLayouts,
  setTabShown,
  visibleTabs,
} from '../../lib/chromeLayout'

export const INSPECTOR_LAYOUTS_CHANGED = 'inkblot:inspector-layouts-changed'

export const readInspectorLayouts = () => normalizeInspectorLayouts(getPreference(INSPECTOR_LAYOUTS_KEY))

export function writeInspectorLayouts(layouts) {
  setPreference(INSPECTOR_LAYOUTS_KEY, serializeInspectorLayouts(layouts))
  window.dispatchEvent(new CustomEvent(INSPECTOR_LAYOUTS_CHANGED))
}

/** Every change to the layouts, saved as it is made. */
export function useInspectorLayouts() {
  const [layouts, setLayouts] = useState(readInspectorLayouts)
  useEffect(() => {
    const reread = () => setLayouts(readInspectorLayouts())
    window.addEventListener(INSPECTOR_LAYOUTS_CHANGED, reread)
    return () => window.removeEventListener(INSPECTOR_LAYOUTS_CHANGED, reread)
  }, [])

  const update = useCallback((change) => {
    const next = change(readInspectorLayouts())
    writeInspectorLayouts(next)
    setLayouts(next)
  }, [])

  return {
    layouts,
    setShown: useCallback((layout, tab, shown) => update((l) => setTabShown(l, layout, tab, shown)), [update]),
    move: useCallback((layout, from, to) => update((l) => moveTab(l, layout, from, to)), [update]),
    restore: useCallback((which) => update((l) => restoreInspectorDefaults(l, which)), [update]),
    remember: useCallback((layout, tab) => update((l) => rememberTab(l, layout, tab)), [update]),
  }
}

/**
 * The layout for the window's mode, the tabs its header shows, and switching.
 * `mode` is pageLayoutState's; `hasMap` puts the map's panel first.
 */
export default function useInspectorLayout({ mode, hasMap, tab, setTab }) {
  const { layouts, remember, ...edits } = useInspectorLayouts()
  const layout = layoutForMode(mode)
  const tabs = useMemo(() => visibleTabs(layouts, layout, hasMap), [layouts, layout, hasMap])

  // A mode change brings its layout on the tab it last showed there.
  const [shownLayout, setShownLayout] = useState(layout)
  useEffect(() => {
    if (shownLayout === layout) return
    setShownLayout(layout)
    const last = layouts.last[layout]
    const next = last && tabs.includes(last) ? last : tabs.find((t) => t !== 'map') ?? tabs[0]
    if (next && next !== tab) setTab(next)
  }, [layout, layouts.last, setTab, shownLayout, tab, tabs])

  // Remember the tab each layout was left on. The map's is not a layout's own.
  useEffect(() => {
    if (shownLayout !== layout || !tab || tab === 'map' || !tabs.includes(tab)) return
    if (layouts.last[layout] !== tab) remember(layout, tab)
  }, [layout, layouts.last, remember, shownLayout, tab, tabs])

  const chooseLayout = useCallback((next) => {
    shellBridge.send('setEditorMode', { mode: INSPECTOR_LAYOUT_INFO[next].mode })
  }, [])

  return { layout, layouts, tabs, chooseLayout, ...edits }
}
