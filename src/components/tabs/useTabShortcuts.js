/**
 * The tab shortcuts, answered whether or not the tab bar is showing: ⌘T a new tab,
 * ⌘W close the one showing, ⌘1–⌘9 pick one (⌘9 the last), ⌃Tab / ⌃⇧Tab round them.
 */
import { useEffect, useRef } from 'react'
import { shellBridge, useLatestBridgeState } from '../../bridge'
import { adjacentTab, tabForNumber } from './tabBarState.js'

const send = (type, payload) => shellBridge.send(type, payload)
const NO_TABS = { tabs: [] }

export default function useTabShortcuts(enabled = true) {
  const state = useLatestBridgeState('tabsChanged', NO_TABS)
  const latest = useRef(state)
  useEffect(() => { latest.current = state })
  useEffect(() => {
    if (!enabled) return undefined
    const onKey = (event) => {
      const { tabs = [], activeTabId } = latest.current ?? NO_TABS
      const command = event.metaKey || event.ctrlKey
      if (event.key === 'Tab' && event.ctrlKey && !event.metaKey && !event.altKey) {
        const next = adjacentTab(tabs, activeTabId, event.shiftKey ? -1 : 1)
        if (next) { event.preventDefault(); send('selectTab', { tabId: next.id }) }
        return
      }
      if (!command || event.altKey || event.shiftKey) return
      if (event.key === 't') { event.preventDefault(); send('newTab', {}); return }
      if (event.key === 'w' && tabs.length) {
        event.preventDefault()
        send('closeTab', { tabId: activeTabId ?? tabs[0].id })
        return
      }
      if (/^[1-9]$/.test(event.key) && event.metaKey) {
        const tab = tabForNumber(tabs, Number(event.key))
        if (tab) { event.preventDefault(); send('selectTab', { tabId: tab.id }) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
