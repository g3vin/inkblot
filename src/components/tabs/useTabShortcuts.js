/**
 * The tab commands, answered whether or not the tab bar is showing: ⌘T a new tab,
 * ⌘W close the one showing, ⌘1–⌘9 pick one (⌘9 the last), ⌃Tab / ⌃⇧Tab round them.
 * Their keys are defaults the writer can change (keybindings.ts).
 */
import { useEffect, useRef } from 'react'
import { shellBridge, useLatestBridgeState } from '../../bridge'
import { useCommands } from '../../lib/commands'
import { adjacentTab, tabForNumber } from './tabBarState.js'

const send = (type, payload) => shellBridge.send(type, payload)
const NO_TABS = { tabs: [] }

export default function useTabShortcuts() {
  const state = useLatestBridgeState('tabsChanged', NO_TABS)
  const latest = useRef(state)
  useEffect(() => { latest.current = state })

  useCommands(() => {
    const tabs = () => latest.current?.tabs ?? []
    const activeId = () => latest.current?.activeTabId
    const step = (offset) => () => {
      const next = adjacentTab(tabs(), activeId(), offset)
      if (next) send('selectTab', { tabId: next.id })
    }
    const pick = (number) => () => {
      const tab = tabForNumber(tabs(), number)
      if (tab) send('selectTab', { tabId: tab.id })
    }
    return [
      { id: 'tabs.new', section: 'Tabs', title: 'New tab', icon: 'add', keys: 'Mod+T', keywords: ['open'], run: () => send('newTab', {}) },
      {
        id: 'tabs.close',
        section: 'Tabs',
        title: 'Close tab',
        icon: 'close',
        keys: 'Mod+W',
        when: () => tabs().length > 0,
        run: () => send('closeTab', { tabId: activeId() ?? tabs()[0].id }),
      },
      { id: 'tabs.next', section: 'Tabs', title: 'Show next tab', keys: 'Ctrl+Tab', when: () => tabs().length > 1, run: step(1) },
      { id: 'tabs.previous', section: 'Tabs', title: 'Show previous tab', keys: 'Ctrl+Shift+Tab', when: () => tabs().length > 1, run: step(-1) },
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `tabs.show.${index + 1}`,
        section: 'Tabs',
        title: `Show tab ${index + 1}`,
        keys: `Mod+${index + 1}`,
        when: () => tabs().length > index,
        run: pick(index + 1),
      })),
      { id: 'tabs.show.last', section: 'Tabs', title: 'Show last tab', keys: 'Mod+9', when: () => tabs().length > 0, run: pick(9) },
    ]
  }, [])
}
