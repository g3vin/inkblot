/**
 * useTabs — the tab dock's state machine, and the split view it can open into.
 *
 * Tabs are derived state: every open document must have one, and closing the last
 * tab has to decide what the editor shows next. That bookkeeping is why this is a
 * hook rather than a set of handlers — it owns the effects that keep tabs and open
 * documents in step, not just the click responses.
 */
import { useCallback, useEffect } from 'react'
import { clampSplitRatio, createTabId, ensureTabsForOpenDocs } from '../lib/editorSession'

export function useTabs({
  activeTabId,
  currentDoc,
  secondaryDoc,
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

  // Whatever the panes are showing has a dot, however it was opened. An open
  // that did not create its own tab lands in the active one (see above).
  useEffect(() => {
    setTabs(prev => ensureTabsForOpenDocs(prev, { currentDoc, secondaryDoc, activeTabId }))
  }, [activeTabId, currentDoc, secondaryDoc, setTabs])

  // The active tab follows the primary pane, so opening a document anywhere —
  // the tree, a canvas card, a search result — lights the right dot.
  useEffect(() => {
    if (!currentDoc) return
    const match = tabs.find(tab => tab.docPath === currentDoc)
    if (match) setActiveTabId(match.id)
  }, [currentDoc, tabs, setActiveTabId])

  /** Add a permanent tab for a document, or promote the ephemeral one it already has. */
  const withTabForDoc = useCallback((prev, docPath) => {
    const existing = prev.find(tab => tab.docPath === docPath)
    if (!existing) return [...prev, { id: createTabId(), docPath, ephemeral: false }]
    if (!existing.ephemeral) return prev
    return prev.map(tab => (
      tab.docPath === docPath ? { ...tab, ephemeral: false } : tab
    ))
  }, [])

  /** Open a document as a tab in the primary pane (right-click → new tab, or dropped on the dock). */
  const openDocInTab = useCallback((docPath) => {
    if (!docPath) return
    setTabs(prev => withTabForDoc(prev, docPath))
    setCurrentDoc(docPath)
    setActiveDoc(docPath)
  }, [withTabForDoc, setActiveDoc, setCurrentDoc, setTabs])

  const selectTab = useCallback((tabId) => {
    const tab = tabs.find(item => item.id === tabId)
    if (!tab) return

    setActiveTabId(tabId)
    // A draft has no document, so the pane empties and DraftTabPane takes over.
    setCurrentDoc(tab.docPath || '')
    setActiveDoc(tab.docPath || '')
  }, [tabs, setActiveDoc, setActiveTabId, setCurrentDoc])

  const newDraftTab = useCallback(() => {
    const id = createTabId()
    setTabs(prev => [...prev, { id, docPath: null, ephemeral: false }])
    setActiveTabId(id)
    setCurrentDoc('')
    setActiveDoc('')
  }, [setActiveDoc, setActiveTabId, setCurrentDoc, setTabs])

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

  const closeTab = useCallback((tabId) => {
    const tab = tabs.find(item => item.id === tabId)
    if (!tab) return

    const remaining = tabs.filter(item => item.id !== tabId)
    setTabs(remaining)

    // Closing the tab a pane is showing closes the document with it.
    if (tab.docPath && tab.docPath === secondaryDoc) {
      setSecondaryDoc(null)
      setSplitView(null)
      if (tab.docPath !== currentDoc) return
    }

    const showsPrimary = tab.docPath ? tab.docPath === currentDoc : tabId === activeTabId
    if (!showsPrimary) return

    const fallback = remaining.find(item => item.docPath && item.docPath !== secondaryDoc)
      || remaining.find(item => item.docPath)
      || null

    if (fallback) {
      setActiveTabId(fallback.id)
      setCurrentDoc(fallback.docPath)
      setActiveDoc(fallback.docPath)
      return
    }

    // Nothing left in the dock, but the split may still be holding a document —
    // promote it rather than emptying the workspace.
    if (secondaryDoc && secondaryDoc !== tab.docPath) {
      setCurrentDoc(secondaryDoc)
      setActiveDoc(secondaryDoc)
      setSecondaryDoc(null)
      setSplitView(null)
      return
    }

    setActiveTabId(null)
    setCurrentDoc('')
    setActiveDoc('')
  }, [activeTabId, currentDoc, secondaryDoc, tabs, setActiveDoc, setActiveTabId, setCurrentDoc, setSecondaryDoc, setSplitView, setTabs])

  /** Promote an ephemeral tab so the next tree-opened document stops replacing it. */
  const keepTab = useCallback((tabId) => {
    setTabs(prev => prev.map(tab => (
      tab.id === tabId ? { ...tab, ephemeral: false } : tab
    )))
  }, [setTabs])

  /**
   * Close a set of tabs at once (close others / to the right / all).
   *
   * `keptIds` is the whole surviving set, so the pane fallback can be decided in
   * one place: whatever the panes were showing that no longer has a tab has to
   * give the pane up.
   */
  const closeTabsTo = useCallback((keptIds) => {
    const kept = tabs.filter(tab => keptIds.has(tab.id))
    setTabs(kept)

    const keptDocs = kept.map(tab => tab.docPath).filter(Boolean)

    if (secondaryDoc && !keptDocs.includes(secondaryDoc)) {
      setSecondaryDoc(null)
      setSplitView(null)
    }

    if (currentDoc && !keptDocs.includes(currentDoc)) {
      const fallback = kept.find(tab => tab.docPath)
      setActiveTabId(fallback ? fallback.id : null)
      setCurrentDoc(fallback?.docPath || '')
      setActiveDoc(fallback?.docPath || '')
    }
  }, [currentDoc, secondaryDoc, tabs, setActiveDoc, setActiveTabId, setCurrentDoc, setSecondaryDoc, setSplitView, setTabs])

  const closeOtherTabs = useCallback((tabId) => {
    closeTabsTo(new Set([tabId]))
  }, [closeTabsTo])

  const closeTabsToTheRight = useCallback((tabId) => {
    const index = tabs.findIndex(tab => tab.id === tabId)
    if (index === -1) return
    closeTabsTo(new Set(tabs.slice(0, index + 1).map(tab => tab.id)))
  }, [closeTabsTo, tabs])

  const closeAllTabs = useCallback(() => {
    closeTabsTo(new Set())
  }, [closeTabsTo])

  /**
   * Put a document in the secondary pane. Splitting a document against itself
   * would show the same file twice (and have two editors autosaving it), so a
   * tab that is already in the primary pane splits against the next tab instead.
   */
  const openDocInSplit = useCallback((docPath, orientation) => {
    const nextOrientation = orientation === 'rows' ? 'rows' : 'columns'
    const target = docPath && docPath !== currentDoc
      ? docPath
      : tabs.find(tab => tab.docPath && tab.docPath !== currentDoc)?.docPath || null
    if (!target) return

    setTabs(prev => withTabForDoc(prev, target))
    setSplitOrientation(nextOrientation)
    setSecondaryDoc(target)
    setSplitView('editor')
  }, [currentDoc, tabs, withTabForDoc, setSecondaryDoc, setSplitOrientation, setSplitView, setTabs])

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
    adoptDraftDoc,
    closeTab,
    keepTab,
    closeOtherTabs,
    closeTabsToTheRight,
    closeAllTabs,
    openDocInSplit,
    closeSplit,
    draftTabActive,
    setSplitRatio,
  }
}
