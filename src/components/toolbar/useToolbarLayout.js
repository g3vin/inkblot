/**
 * useToolbarLayout — a toolbar's items and the display mode, as saved.
 *
 * Read from the preference cache during render (it is synchronous after hydration)
 * and normalized on every read, so a layout saved by an older version, or broken,
 * still shows a usable toolbar. Every change is written straight away.
 */
import { useCallback, useEffect, useState } from 'react'
import { getPreference, setPreference } from '../../lib/preferences'
import {
  DEFAULT_TOOLBARS,
  TOOLBAR_DISPLAY_MODE_KEY,
  normalizeDisplayMode,
  normalizeToolbar,
  toolbarLayoutKey,
} from '../../lib/chromeLayout'

export const TOOLBAR_LAYOUT_CHANGED = 'inkblot:toolbar-layout-changed'

const announce = () => window.dispatchEvent(new CustomEvent(TOOLBAR_LAYOUT_CHANGED))

export function readToolbarItems(context) {
  return normalizeToolbar(context, getPreference(toolbarLayoutKey(context))).items
}

export function writeToolbarItems(context, items) {
  const layout = normalizeToolbar(context, JSON.stringify({ items, known: null }))
  setPreference(toolbarLayoutKey(context), JSON.stringify(layout))
  announce()
  return layout.items
}

export function resetToolbarItems(context) {
  return writeToolbarItems(context, DEFAULT_TOOLBARS[context])
}

export function readDisplayMode() {
  return normalizeDisplayMode(getPreference(TOOLBAR_DISPLAY_MODE_KEY))
}

export function writeDisplayMode(mode) {
  setPreference(TOOLBAR_DISPLAY_MODE_KEY, normalizeDisplayMode(mode))
  announce()
}

/** The layout of one toolbar, and the display mode, kept current across the window. */
export default function useToolbarLayout(context) {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1)
    window.addEventListener(TOOLBAR_LAYOUT_CHANGED, bump)
    return () => window.removeEventListener(TOOLBAR_LAYOUT_CHANGED, bump)
  }, [])

  // `version` makes the reads below re-run after a write elsewhere in the window.
  void version
  const items = readToolbarItems(context)
  const display = readDisplayMode()

  const setItems = useCallback((next) => writeToolbarItems(context, next), [context])
  const reset = useCallback(() => resetToolbarItems(context), [context])
  return { items, display, setItems, reset, setDisplay: writeDisplayMode }
}
