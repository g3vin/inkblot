/**
 * useTabs — the open tabs' state machine, and the split view each tab can hold.
 *
 * Tabs are derived state: every open document must have one, and closing the last
 * tab has to decide what the editor shows next. That bookkeeping is why this is a
 * hook rather than a set of handlers — it owns the effects that keep tabs and open
 * documents in step, not just the click responses.
 *
 * A tab owns its split, as a Safari or Xcode tab does. The panes are still where the
 * split lives while it is on screen (every path that opens or closes one sets
 * `secondaryDoc`/`splitView`); an effect writes what they show into the active tab,
 * and arriving at another tab, however that happens, brings back its own.
 */
import { useCallback, useEffect, useRef } from 'react'
import {
  clampSplitRatio,
  closeTabIn,
  createTabId,
  ensureTabsForOpenDocs,
  orderTabsIn,
  recordSplitIn,
  selectTabIn,
  splitOfPanes,
  splitOfTab,
} from '../lib/editorSession'

const sameSplit = (a, b) => (
  (!a && !b) || Boolean(a && b && a.secondaryDoc === b.secondaryDoc && a.splitOrientation === b.splitOrientation)
)

export function useTabs({
  activeDoc,
  activeTabId,
  currentDoc,
  secondaryDoc,
  splitView,
  splitOrientation,
  setActiveDoc,
  setActiveTabId,
  setCurrentDoc,
  setSecondaryDoc,
  setSplitOrientation,
  setSplitRatioState,
  setSplitView,
  setTabs,
  tabs,
}) {

  /* ---------------- Tabs ---------------- */

  // Whatever the primary pane is showing has a tab, however it was opened. An open
  // that did not create its own tab lands in the active one.
  useEffect(() => {
    setTabs(prev => ensureTabsForOpenDocs(prev, { currentDoc, secondaryDoc, activeTabId }))
  }, [activeTabId, currentDoc, secondaryDoc, setTabs])

  // The active tab follows the primary pane, so opening a document anywhere —
  // the tree, a canvas card, a search result — lands on its tab if it has one.
  useEffect(() => {
    if (!currentDoc) return
    const match = tabs.find(tab => tab.docPath === currentDoc)
    if (match) setActiveTabId(match.id)
  }, [currentDoc, tabs, setActiveTabId])

  // The split belongs to the tab. Arriving at a tab restores its split; staying on
  // one records what the panes show. A tab from an older session has no split on
  // record (`undefined`), and takes the panes' as its own.
  const arrivedAt = useRef(undefined)
  useEffect(() => {
    const tab = tabs.find(item => item.id === activeTabId)
    const panes = splitOfPanes({ splitView, secondaryDoc, splitOrientation })
    if (arrivedAt.current !== activeTabId) {
      arrivedAt.current = activeTabId
      if (tab && tab.secondaryDoc !== undefined) {
        const own = splitOfTab(tab)
        if (!sameSplit(own, panes)) {
          setSecondaryDoc(own?.secondaryDoc ?? null)
          setSplitView(own ? 'editor' : null)
          if (own) setSplitOrientation(own.splitOrientation)
        }
        return
      }
    }
    if (tab) setTabs(prev => recordSplitIn(prev, activeTabId, panes))
  }, [activeTabId, secondaryDoc, splitOrientation, splitView, tabs, setSecondaryDoc, setSplitOrientation, setSplitView, setTabs])

  /**
   * Run one of editorSession's tab operations on the current state and set what it
   * changed. The operations are pure so the suites can reach them without React.
   */
  const applyTabs = useCallback((operation) => {
    const before = {
      tabs, activeTabId, currentDoc: currentDoc || '', secondaryDoc, activeDoc: activeDoc || '', splitView, splitOrientation,
    }
    const after = operation(before)
    if (after === before) return
    if (after.tabs !== before.tabs) setTabs(after.tabs)
    if (after.activeTabId !== before.activeTabId) {
      // Arrived here with its split already applied: nothing for the effect to restore.
      arrivedAt.current = after.activeTabId
      setActiveTabId(after.activeTabId)
    }
    if (after.currentDoc !== before.currentDoc) setCurrentDoc(after.currentDoc)
    if (after.secondaryDoc !== before.secondaryDoc) setSecondaryDoc(after.secondaryDoc)
    if (after.splitView !== before.splitView) setSplitView(after.splitView)
    if (after.splitOrientation !== before.splitOrientation) setSplitOrientation(after.splitOrientation)
    if (after.activeDoc !== before.activeDoc) setActiveDoc(after.activeDoc)
  }, [activeDoc, activeTabId, currentDoc, secondaryDoc, splitOrientation, splitView, tabs, setActiveDoc, setActiveTabId, setCurrentDoc, setSecondaryDoc, setSplitOrientation, setSplitView, setTabs])

  const selectTab = useCallback((tabId) => {
    applyTabs(ws => selectTabIn(ws, tabId))
  }, [applyTabs])

  const closeTab = useCallback((tabId) => {
    applyTabs(ws => closeTabIn(ws, tabId))
  }, [applyTabs])

  /** Put the tabs in the order the shell's tab bar shows them. */
  const setTabOrder = useCallback((tabIds) => {
    setTabs(prev => orderTabsIn(prev, tabIds))
  }, [setTabs])

  /**
   * Open a document in a tab of its own (right-click → Open in New Tab), or show the
   * tab it already has. A new tab starts with no split.
   */
  const openDocInTab = useCallback((docPath) => {
    if (!docPath) return
    applyTabs((ws) => {
      const existing = ws.tabs.find(tab => tab.docPath === docPath)
      if (existing) return selectTabIn(ws, existing.id)
      const tab = { id: createTabId(), docPath, ephemeral: false, secondaryDoc: null }
      return selectTabIn({ ...ws, tabs: [...ws.tabs, tab] }, tab.id)
    })
  }, [applyTabs])

  /** A tab with no document yet, where DraftTabPane asks what it will be. */
  const newDraftTab = useCallback(() => {
    applyTabs((ws) => {
      const tab = { id: createTabId(), docPath: null, ephemeral: false, secondaryDoc: null }
      return selectTabIn({ ...ws, tabs: [...ws.tabs, tab] }, tab.id)
    })
  }, [applyTabs])

  /** A draft became a real document: the tab it was opened from adopts it. */
  const adoptDraftDoc = useCallback((docPath) => {
    if (!docPath) return
    setTabs(prev => prev.map(tab => (
      tab.id === activeTabId && !tab.docPath
        ? { ...tab, docPath, ephemeral: false }
        : tab
    )))
    setCurrentDoc(docPath)
    setActiveDoc(docPath)
  }, [activeTabId, setActiveDoc, setCurrentDoc, setTabs])

  /**
   * Put a document beside or below the active tab's. Splitting a document against
   * itself would show the same file twice (and have two editors autosaving it), so
   * with no other document named the split keeps what it shows, or else takes the
   * next tab's document.
   */
  const openDocInSplit = useCallback((docPath, orientation) => {
    const nextOrientation = orientation === 'rows' ? 'rows' : 'columns'
    const activeIndex = tabs.findIndex(tab => tab.id === activeTabId)
    const along = [...tabs.slice(activeIndex + 1), ...tabs.slice(0, Math.max(0, activeIndex)).reverse()]
    const target = docPath && docPath !== currentDoc
      ? docPath
      : (!docPath && secondaryDoc) || along.find(tab => tab.docPath && tab.docPath !== currentDoc)?.docPath || null
    if (!target) return

    setSplitOrientation(nextOrientation)
    setSecondaryDoc(target)
    setSplitView('editor')
  }, [activeTabId, currentDoc, secondaryDoc, tabs, setSecondaryDoc, setSplitOrientation, setSplitView])

  const closeSplit = useCallback(() => {
    setSecondaryDoc(null)
    setSplitView(null)
  }, [setSecondaryDoc, setSplitView])

  /** Where the divider sits, as the primary pane's share of the split. */
  const setSplitRatio = useCallback((ratio) => {
    setSplitRatioState(clampSplitRatio(ratio))
  }, [setSplitRatioState])

  const activeTab = tabs.find(tab => tab.id === activeTabId) || null
  const draftTabActive = Boolean(activeTab && !activeTab.docPath)


  return {
    openDocInTab,
    selectTab,
    newDraftTab,
    closeTab,
    setTabOrder,
    adoptDraftDoc,
    openDocInSplit,
    closeSplit,
    draftTabActive,
    setSplitRatio,
  }
}
