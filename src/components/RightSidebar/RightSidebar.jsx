/**
 * RightSidebar.jsx — right panel with Clipboard / Workbench / Notes / History
 * and the other inspector tabs. (The project search is the left sidebar's.)
 *
 * Tabs can be switched by clicking or by a horizontal trackpad swipe, which
 * moves between them the way Arc moves between spaces (hooks/useSpaceSwipe.js).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import InspectorHeader from './InspectorHeader'
import MapInspectorPanel from './MapInspectorPanel'
import ReferencesPanel from './references/ReferencesPanel'
import StatsPanel from '../stats/StatsPanel'
import { OutputPanel, TypesetPanel } from './finishing/FinishingPanels'
import TypesetHistoryView from './TypesetHistoryView'
import useSpaceSwipe from '../../hooks/useSpaceSwipe'
import usePeekDismiss from '../../hooks/usePeekDismiss'
import { sidebarTabsFor } from './sidebarTabsConfig'
import useInspectorLayout from './useInspectorLayout'
import './InspectorLayout.css'
import { useLatestBridgeState } from '../../bridge'
import { isMapDoc, isTextDoc } from '../../lib/docKind'
import { inspectorTab } from '../../lib/chromeLayout'
import Workbench from './Workbench'
import NotesPanel from '../NotesPanel'
import HistoryPanel from './HistoryPanel'
import TimelineSidebarPanel from '../../timeline/TimelineSidebarPanel'
import ClipboardPanel from './ClipboardPanel'
import ArchivePanel from './ArchivePanel'
import { IconButton, Inlay, InlaySlot } from '../../ui'
import Icon from '../../ui/Icon.jsx'
import { PanelActions, PanelActionsProvider, ScopeMenu } from '../../ui/PanelActions.jsx'

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export default function RightSidebar({
  width,
  onResize,
  resizing,
  collapsed,
  peeked,
  pinned,
  gliding,
  togglePin,
  onAutoCollapse,
  footerRef,
  sidebarTab,
  setSidebarTab,
  tiles,
  setTiles,
  currentDoc,
  secondaryDoc,
  activeDoc,
  secondaryEditor,
  notes,
  setNotes,
  clearActiveNoteHighlight,
  versions = [],
  editor,
  setVersions,
  clipboardHistory,
  onDropToClipboard,
  onRemoveClipboardEntry,
  onMakeNoteFromClipboard,
  projectName,
  jumpToText,
  refreshFiles,
  onOpenDocInTab,
  onOpenCompare,
}) {
  const prefersReducedMotion = useReducedMotion()
  // The panels are the current layout's — Write's or Typeset's, as the window's mode
  // is — with the map's first while a map is showing.
  const pageLayout = useLatestBridgeState('pageLayoutState', null)
  const inspector = useInspectorLayout({
    mode: pageLayout?.mode,
    hasMap: isMapDoc(activeDoc),
    tab: sidebarTab,
    setTab: setSidebarTab,
  })
  const tabs = useMemo(() => sidebarTabsFor(inspector.tabs), [inspector.tabs])
  const [historyKind, setHistoryKind] = useState('typeset')

  // A map asking for its panel (a label just placed, an item double-clicked) brings
  // the Map tab up.
  const mapChrome = useLatestBridgeState('mapChromeChanged', null)
  const revealPanel = mapChrome?.state?.revealPanel ?? 0
  const lastRevealRef = useRef(revealPanel)
  useEffect(() => {
    if (revealPanel === lastRevealRef.current) return
    lastRevealRef.current = revealPanel
    if (revealPanel) setSidebarTab('map')
  }, [revealPanel, setSidebarTab])
  const tabIds = useMemo(() => tabs.map(({ id }) => id), [tabs])
  // The archive opens over whichever panel is showing, from the button in the foot.
  // Only a text document has one so far.
  const [archiveOpen, setArchiveOpen] = useState(false)
  const hasArchive = isTextDoc(activeDoc)
  const showArchive = archiveOpen && hasArchive
  const activeEditor = activeDoc === secondaryDoc && activeDoc !== currentDoc ? secondaryEditor : editor
  const activeTabIndex = Math.max(0, tabIds.indexOf(sidebarTab))

  // When the tab list changes, never leave the sidebar on a tab that no longer
  // exists — no panel active, and the strip pointing at nothing.
  useEffect(() => {
    if (!tabIds.includes(sidebarTab)) setSidebarTab(tabIds[0])
  }, [sidebarTab, setSidebarTab, tabIds])
  // The title row's right end: the showing panel's scope menu and ⋯ go here (ui/PanelActions).
  const [actionsSlot, setActionsSlot] = useState(null)
  const hoveredRef = useRef(false)
  const sidebarRef = useRef(null)
  const swipe = useSpaceSwipe({
    targetRef: sidebarRef,
    index: activeTabIndex,
    count: tabIds.length,
    panelWidth: width,
    onSettle: (nextIndex) => {
      const nextTab = tabIds[nextIndex]
      if (nextTab && nextTab !== sidebarTab) setSidebarTab(nextTab)
    },
  })
  const visualTabProgress = swipe.progress
  const gestureActive = swipe.dragging

  // A click past the next tab doesn't scroll the title through the tabs between:
  // the old title slides straight out and the new one in, as the panels between
  // aren't shown either. Cleared when the slide ends, or a swipe takes over.
  const [titleJump, setTitleJump] = useState(null)
  const { jumpTo } = swipe
  const handleSelectTab = useCallback((nextTab) => {
    const nextIndex = tabIds.indexOf(nextTab)
    if (nextIndex === -1) return
    setTitleJump(Math.abs(nextIndex - activeTabIndex) > 1
      ? { from: activeTabIndex, to: nextIndex, key: `${activeTabIndex}-${nextIndex}-${Date.now()}` }
      : null)
    jumpTo(nextIndex)
    setSidebarTab(nextTab)
    setArchiveOpen(false)
  }, [activeTabIndex, jumpTo, setSidebarTab, tabIds])
  if (titleJump && gestureActive) setTitleJump(null)
  const showTitleJump = titleJump && !gestureActive && !prefersReducedMotion
    && tabs[titleJump.from] && tabs[titleJump.to]

  const handleSidebarMouseEnter = useCallback(() => {
    hoveredRef.current = true
  }, [])

  const handleSidebarMouseLeave = useCallback(() => {
    hoveredRef.current = false
    if (peeked) onAutoCollapse?.()
  }, [onAutoCollapse, peeked])

  usePeekDismiss(sidebarRef, peeked, onAutoCollapse)

  // Cmd+S while hovering the sidebar toggles its pinned state (mirrors LeftSidebar).
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!hoveredRef.current) return
      if (!event.metaKey || event.key.toLowerCase() !== 's') return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()
      if (pinned) hoveredRef.current = false
      togglePin?.()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [pinned, togglePin])

  const panelTrackStyle = {
    '--sidebar-pane-count': tabs.length,
    width: `${tabs.length * 100}%`,
    transform: `translateX(-${visualTabProgress * (100 / tabs.length)}%)`,
    // On the fingers while they swipe; otherwise sprung there on the compositor, with
    // a swipe's speed kept (useSpaceSwipe).
    transition: swipe.moving || prefersReducedMotion ? 'none' : `transform ${swipe.snap}`,
  }

  // Only mount the active panel — plus the neighbors while swiping, so
  // partially revealed panels have content.
  const renderedPanelIds = useMemo(() => {
    const ids = new Set([sidebarTab])
    if (!gestureActive) return ids

    const visualIndex = clamp(Math.round(visualTabProgress), 0, tabIds.length - 1)
    ;[
      activeTabIndex,
      visualIndex - 1,
      visualIndex,
      visualIndex + 1,
    ].forEach((index) => {
      const id = tabIds[index]
      if (id) ids.add(id)
    })

    return ids
  }, [activeTabIndex, gestureActive, sidebarTab, tabIds, visualTabProgress])

  const renderPanel = (tabId) => {
    if (tabId === 'clipboard') {
      return (
        <ClipboardPanel
          entries={clipboardHistory}
          onDropToClipboard={onDropToClipboard}
          onRemoveEntry={onRemoveClipboardEntry}
          onMakeNote={onMakeNoteFromClipboard}
        />
      )
    }

    if (tabId === 'workbench') {
      return (
        <Workbench
          tiles={tiles}
          setTiles={setTiles}
          editor={editor}
          secondaryEditor={secondaryEditor}
          secondaryDoc={secondaryDoc}
        />
      )
    }

    if (tabId === 'notes') {
      return (
        <NotesPanel
          notes={notes}
          setNotes={setNotes}
          docName={activeDoc}
          projectName={projectName}
          jumpToText={jumpToText}
          clearActiveNoteHighlight={clearActiveNoteHighlight}
        />
      )
    }

    if (tabId === 'map') return <MapInspectorPanel />
    if (tabId === 'references') return <ReferencesPanel />
    if (tabId === 'stats') return <StatsPanel />
    if (tabId === 'typeset') return <TypesetPanel onShowOutput={() => handleSelectTab('output')} />
    if (tabId === 'output') return <OutputPanel />

    if (tabId === 'timeline') {
      return (
        <TimelineSidebarPanel
          projectName={projectName}
          docPath={activeDoc}
          editor={activeEditor}
        />
      )
    }

    if (tabId !== 'history') {
      const spec = inspectorTab(tabId)
      return (
        <div className="inspector-placeholder">
          <Icon name={spec?.icon ?? 'file'} size={20} />
          <span>{spec?.title ?? tabId} is on its way to this panel.</span>
        </div>
      )
    }

    const textHistory = (
      <HistoryPanel
        // Absent, not empty, until the document's versions are in: History tells the two apart.
        versions={versions?.[activeDoc]}
        setVersions={setVersions}
        // The history acts on the ACTIVE document, which may live in either pane.
        editor={activeEditor}
        projectName={projectName}
        docName={activeDoc}
        refreshFiles={refreshFiles}
        onOpenDocInTab={onOpenDocInTab}
        onOpenCompare={onOpenCompare}
      />
    )
    // In Typeset the book's typeset versions are History's first, with the text's a
    // switch away.
    if (pageLayout?.mode !== 'typeset') return textHistory
    // In Typeset, History holds the book's typeset versions and the text's: which one
    // is the panel's scope, in its header, not a second row of tabs.
    return (
      <div className="history-with-switch">
        <PanelActions>
          <ScopeMenu
            label="History of"
            value={historyKind}
            onChange={setHistoryKind}
            options={[{ value: 'typeset', label: 'Typeset versions' }, { value: 'text', label: 'Text versions' }]}
          />
        </PanelActions>
        {historyKind === 'typeset' ? <TypesetHistoryView /> : textHistory}
      </div>
    )
  }

  return (
    <aside
      className={`sidebar ib-sheet ib-tray right-sidebar${pinned ? ' is-docked' : ' is-veiled'}${gliding ? ' is-gliding' : ''}${collapsed ? ' collapsed' : ''}${peeked ? ' is-peeked' : ''}${resizing ? ' is-resizing' : ''}`}
      style={{ width, '--sidebar-w': `${width}px` }}
      ref={sidebarRef}
      aria-hidden={collapsed || undefined}
      inert={collapsed || undefined}
      onMouseEnter={handleSidebarMouseEnter}
      onMouseLeave={handleSidebarMouseLeave}
    >
      <div className="resizer resizer-left" onPointerDown={onResize} />

      <div className="sidebar-topbar">
        <div className="right-sidebar-global-title" aria-hidden="true">
          {showTitleJump ? (
            <div
              key={titleJump.key}
              className={`right-sidebar-global-title-track is-jumping${titleJump.to > titleJump.from ? ' is-forward' : ' is-back'}`}
              style={{ animationDuration: 'var(--spring-quick-dur)', animationTimingFunction: 'var(--spring-quick)' }}
              onAnimationEnd={() => setTitleJump(null)}
            >
              {(titleJump.to > titleJump.from ? [titleJump.from, titleJump.to] : [titleJump.to, titleJump.from])
                .map((index) => (
                  <span key={tabs[index].id} className="panel-header-label right-sidebar-global-title-label">
                    {tabs[index].label}
                  </span>
                ))}
            </div>
          ) : (
          <div
            className="right-sidebar-global-title-track"
            style={{
              '--right-sidebar-title-progress': visualTabProgress,
              transition: swipe.moving || prefersReducedMotion ? 'none' : `transform ${swipe.snap}`,
            }}
          >
            {tabs.map(({ id, label }) => (
              <span key={id} className="panel-header-label right-sidebar-global-title-label">
                {label}
              </span>
            ))}
          </div>
          )}
        </div>
        <div className="right-sidebar-panel-actions" ref={setActionsSlot} />
      </div>

      <InspectorHeader
        tabs={tabs}
        tab={sidebarTab}
        setTab={handleSelectTab}
        layout={inspector.layout}
        onChooseLayout={inspector.chooseLayout}
        visualProgress={visualTabProgress}
        gestureActive={gestureActive}
        following={swipe.moving}
        snap={swipe.snap}
        reducedMotion={prefersReducedMotion}
        onIndicatorDrag={swipe.follow}
        onIndicatorDrop={swipe.settle}
      />

      <div className="sidebar-content">
        {showArchive ? (
          <div className="sidebar-panel-page right-sidebar-archive">
            <div className="sidebar-panel history-panel">
              <ArchivePanel
                projectName={projectName}
                docName={activeDoc}
                editor={activeEditor}
                backLabel={tabs[activeTabIndex]?.label ?? 'the panel'}
                onBack={() => setArchiveOpen(false)}
              />
            </div>
          </div>
        ) : null}
        <div hidden={showArchive || undefined} className={`sidebar-panels-viewport${gestureActive ? ' is-gesture-active' : ''}`}>
          <div className="sidebar-panels-track" style={panelTrackStyle}>
            {tabs.map(({ id }) => (
              <section
                key={id}
                className={`sidebar-panel-pane${sidebarTab === id ? ' is-active' : ''}`}
                aria-hidden={sidebarTab !== id}
              >
                <div className="sidebar-panel-page">
                  <PanelActionsProvider slot={actionsSlot} active={sidebarTab === id && !gestureActive && !showArchive}>
                    {renderedPanelIds.has(id) ? renderPanel(id) : null}
                  </PanelActionsProvider>
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
      {/* Level with the left sidebar's + and search, the archive in the outer corner as
          the + is. The editor portals the word count in while the inspector is docked. */}
      <div className="right-sidebar-footer">
        <div className="right-sidebar-footer-slot" ref={footerRef} />
        {hasArchive ? (
          <InlaySlot className="right-sidebar-archive-button">
            <Inlay round>
              <IconButton
                icon="archive"
                filled={showArchive}
                label={showArchive ? 'Hide the archive' : 'Show the archive'}
                title="Things put away out of this document"
                size="circle"
                aria-pressed={showArchive}
                onClick={() => setArchiveOpen(!showArchive)}
              />
            </Inlay>
          </InlaySlot>
        ) : null}
      </div>
    </aside>
  )
}
