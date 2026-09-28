/**
 * useNativeTabs — the page's side of a tab bar the shell draws.
 *
 * The tabs stay `useTabs`'s. While the shell owns them (`nativeOwns('tabBar')`) this
 * publishes them, each with its split, whenever any of it changes, and turns the
 * shell's commands back into `useTabs`'s calls: select, close, reorder, a new draft
 * tab, a document in a new tab or a window of its own, and the active tab's split
 * opened, turned or closed.
 *
 * Commands name tabs by id. One that names a tab already gone (closed a moment before
 * the command arrived) does nothing, as the calls themselves do.
 */
import { useEffect, useRef } from 'react'
import { documentSurface } from '../bridge'
import { openDocumentWindow } from '../lib/docWindow'
import { splitOfTab } from '../lib/editorSession'

const toWireTab = (tab) => {
  const split = splitOfTab(tab)
  return {
    id: tab.id,
    ...(tab.docPath ? { docPath: tab.docPath } : {}),
    ...(split ? { secondaryDoc: split.secondaryDoc, split: split.splitOrientation } : {}),
  }
}

export function useNativeTabs({
  enabled,
  projectName,
  tabs,
  activeTabId,
  actions,
}) {
  const latest = useRef({ actions, projectName })
  useEffect(() => {
    latest.current = { actions, projectName }
  })

  useEffect(() => {
    if (!enabled) return
    documentSurface.publishTabsChanged({
      tabs: (tabs || []).map(toWireTab),
      ...(activeTabId ? { activeTabId } : {}),
    })
  }, [enabled, tabs, activeTabId])

  // Commands are always answered: the web toolbar and tab bar send them in-process.
  useEffect(() => {
    const act = () => latest.current.actions
    const offs = [
      documentSurface.onCommand('selectTab', ({ tabId }) => act().selectTab(tabId)),
      documentSurface.onCommand('closeTab', ({ tabId }) => act().closeTab(tabId)),
      documentSurface.onCommand('setTabOrder', ({ tabIds }) => act().setTabOrder(tabIds || [])),
      documentSurface.onCommand('newTab', () => act().newDraftTab()),
      documentSurface.onCommand('openDocInTab', ({ docPath }) => {
        if (docPath) act().openDocInTab(docPath)
      }),
      documentSurface.onCommand('openDocInWindow', ({ docPath }) => {
        const { projectName } = latest.current
        if (docPath && projectName) openDocumentWindow(projectName, docPath)
      }),
      documentSurface.onCommand('openInSplit', ({ docPath, orientation }) => (
        act().openDocInSplit(docPath || null, orientation)
      )),
      documentSurface.onCommand('closeSplit', () => act().closeSplit()),
    ]
    return () => { for (const off of offs) off() }
  }, [])
}
