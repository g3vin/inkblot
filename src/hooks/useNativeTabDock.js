/**
 * useNativeTabDock — the page's side of a tab dock the shell draws.
 *
 * The tabs stay `useTabs`'s. While the shell owns the dock (`nativeOwns('tabDock')`)
 * this publishes them whenever they change, and turns the shell's clicks back into the
 * same calls `TabDock` made: select, close, a new draft tab, and a document dropped on
 * the dock from the native file tree.
 *
 * Tab ids are timestamps here and strings on the wire; a command's id is matched back
 * by its string form.
 */
import { useEffect, useRef } from 'react'
import { documentSurface } from '../bridge'

const toWireTab = (tab) => ({
  id: String(tab.id),
  ...(tab.docPath ? { docPath: tab.docPath } : {}),
  ephemeral: Boolean(tab.ephemeral),
})

export function useNativeTabDock({
  enabled,
  tabs,
  activeTabId,
  currentDoc,
  secondaryDoc,
  splitView,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onOpenDocInTab,
}) {
  const latest = useRef({})
  useEffect(() => {
    latest.current = { tabs, onSelectTab, onCloseTab, onNewTab, onOpenDocInTab }
  })

  const split = splitView === 'editor' && Boolean(secondaryDoc)
  useEffect(() => {
    if (!enabled) return
    documentSurface.publishTabsChanged({
      tabs: (tabs || []).map(toWireTab),
      ...(activeTabId != null ? { activeTabId: String(activeTabId) } : {}),
      ...(currentDoc ? { currentDoc } : {}),
      ...(split && secondaryDoc ? { secondaryDoc } : {}),
      split,
    })
  }, [enabled, tabs, activeTabId, currentDoc, secondaryDoc, split])

  useEffect(() => {
    if (!enabled) return undefined
    const state = () => latest.current
    /** The page's own id for a wire id — a number, most likely. */
    const idOf = (tabId) => (state().tabs || []).find((tab) => String(tab.id) === tabId)?.id

    const offs = [
      documentSurface.onCommand('selectTab', ({ tabId }) => {
        const id = idOf(tabId)
        if (id != null) state().onSelectTab?.(id)
      }),
      documentSurface.onCommand('closeTab', ({ tabId }) => {
        const id = idOf(tabId)
        if (id != null) state().onCloseTab?.(id)
      }),
      documentSurface.onCommand('newTab', () => { state().onNewTab?.() }),
      documentSurface.onCommand('openDocInTab', ({ docPath }) => {
        if (docPath) state().onOpenDocInTab?.(docPath)
      }),
    ]
    return () => { for (const off of offs) off() }
  }, [enabled])
}
