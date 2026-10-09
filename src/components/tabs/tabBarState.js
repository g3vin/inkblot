/**
 * The tab bar's own state: View ▸ Show Tab Bar (remembered), what a tab is called,
 * and which symbol it shows (TabsModel.swift's `DocTab` extension).
 */
import { useEffect, useState } from 'react'
import { getPreference, setPreference } from '../../lib/preferences'

export const TAB_BAR_PREF = 'inkblot.tabs.showsTabBar'
const CHANGED = 'inkblot:tab-bar-visibility'

export const showsTabBar = () => getPreference(TAB_BAR_PREF) !== false && getPreference(TAB_BAR_PREF) !== 'false'

export function setShowsTabBar(shown) {
  setPreference(TAB_BAR_PREF, Boolean(shown))
  window.dispatchEvent(new CustomEvent(CHANGED))
}

export function useShowsTabBar() {
  const [shown, setShown] = useState(showsTabBar)
  useEffect(() => {
    const sync = () => setShown(showsTabBar())
    window.addEventListener(CHANGED, sync)
    return () => window.removeEventListener(CHANGED, sync)
  }, [])
  return shown
}

/** More than one document to tell apart: two tabs, or one tab split between two. */
export const needsTabBar = (tabs) => (tabs?.length ?? 0) > 1 || Boolean(tabs?.[0]?.split)

/** The file's own name, without the kind suffix routing reads. */
export function tabName(docPath) {
  if (!docPath) return 'New tab'
  const leaf = docPath.split('/').pop() ?? docPath
  for (const suffix of ['.canvas', '.map']) if (leaf.endsWith(suffix)) return leaf.slice(0, -suffix.length)
  return leaf
}

export function tabIcon(docPath) {
  if (!docPath) return 'add'
  if (docPath.endsWith('.canvas')) return 'group'
  if (docPath.endsWith('.map')) return 'map'
  return 'document'
}

const folderOf = (docPath) => {
  const parts = (docPath ?? '').split('/')
  return parts.length > 1 ? parts[parts.length - 2] : null
}

/** A tab's name, with its folder when another tab has the same name. */
export function tabTitle(tab, all) {
  const name = tabName(tab.docPath)
  const clash = all.some((other) => other.id !== tab.id && other.docPath && tabName(other.docPath) === name)
  const folder = folderOf(tab.docPath)
  return clash && folder ? `${name} — ${folder}` : name
}

/** ⌘1 to ⌘8 pick that tab; ⌘9 is always the last, as in Safari. */
export function tabForNumber(tabs, number) {
  if (!tabs.length) return null
  const index = number === 9 ? tabs.length - 1 : number - 1
  return tabs[index] ?? null
}

/** ⌃Tab and ⌃⇧Tab: the next or previous tab, round the ends. */
export function adjacentTab(tabs, activeId, offset) {
  if (tabs.length < 2) return null
  const from = Math.max(0, tabs.findIndex((tab) => tab.id === activeId))
  return tabs[((from + offset) % tabs.length + tabs.length) % tabs.length]
}
