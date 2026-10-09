/**
 * RightSidebar.jsx — right panel with Search / Clipboard / Workbench /
 * Notes / History tabs.
 *
 * Tabs can be switched by clicking or by a horizontal trackpad swipe, which
 * moves between them the way Arc moves between spaces (hooks/useSpaceSwipe.js).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useReducedMotion } from 'framer-motion'
import InspectorHeader from './InspectorHeader'
import MapInspectorPanel from './MapInspectorPanel'
import ReferencesPanel from './references/ReferencesPanel'
import StatsPanel from '../stats/StatsPanel'
import { OutputPanel, TypesetPanel } from './finishing/FinishingPanels'
import TypesetHistoryView from './TypesetHistoryView'
import Segmented from '../../ui/Segmented'
import useSpaceSwipe from '../../hooks/useSpaceSwipe'
import { sidebarTabsFor } from './sidebarTabsConfig'
import useInspectorLayout from './useInspectorLayout'
import './InspectorLayout.css'
import { useLatestBridgeState } from '../../bridge'
import { isMapDoc } from '../../lib/docKind'
import { inspectorTab } from '../../lib/chromeLayout'
import Workbench from './Workbench'
import NotesPanel from '../NotesPanel'
import HistoryPanel from './HistoryPanel'
import TimelineSidebarPanel from '../../timeline/TimelineSidebarPanel'
import SidebarSearch from './SidebarSearch'
import ClipboardPanel from './ClipboardPanel'
import Icon from '../../ui/Icon.jsx'
import { isFilterScope } from '../../lib/sidebarSearch'
import { useCommands } from '../../lib/commands'

/** How the panels glide to rest once a swipe lets go, or a tab is clicked. */
const SNAP_DURATION_MS = 260
const SNAP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
const EDGE_REVEAL_ZONE_PX = 12
/** Must match .search-overlay-card's width in Editor.css — the fly-in scales against it. */
const SEARCH_OVERLAY_WIDTH = 640

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export default function RightSidebar({
  width,
  onResize,
  resizing,
  collapsed,
  peeked,
  pinned,
  togglePin,
  onAutoCollapse,
  sidebarTab,
  setSidebarTab,
  tiles,
  setTiles,
  activeEditor,
  currentDoc,
  secondaryDoc,
  activeDoc,
  notesByDoc,
  secondaryEditor,
  notes,
  setNotes,
  clearActiveNoteHighlight,
  versions = [],
  editor,
  setVersions,
  clipboardHistory,
  onDropToClipboard,
  projectName,
  jumpToText,
  onOpenSearchTarget,
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
  const activeTabIndex = Math.max(0, tabIds.indexOf(sidebarTab))

  // If the strip ever changes shape again, never leave the sidebar on a tab that
  // no longer exists — no panel active, and the strip pointing at nothing.
  useEffect(() => {
    if (!tabIds.includes(sidebarTab)) setSidebarTab(tabIds[0])
  }, [sidebarTab, setSidebarTab, tabIds])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchScope, setSearchScope] = useState('panel')
  const [searchOverlay, setSearchOverlay] = useState(null)
  const searchAnchorRef = useRef(null)
  const hoveredRef = useRef(false)
  const lastPointerXRef = useRef(null)
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

  /**
   * Open the centered search.
   *
   * When the sidebar is on screen the overlay grows out of the search bar's real
   * position, so it reads as the same bar moving rather than a new thing
   * appearing. With the sidebar collapsed there is nothing to fly from, so it
   * simply pops in the middle.
   *
   * The scope goes to 'All documents': `panel` means "filter the panel below
   * me", which is meaningless for a box floating in the middle of the screen.
   */
  const openSearchOverlay = useCallback(() => {
    const onScreen = !collapsed || peeked
    const rect = onScreen ? searchAnchorRef.current?.getBoundingClientRect() : null

    /*
     * The overlay centers in the gap between the two sidebars' inner edges —
     * or a window edge where a sidebar is collapsed. Measured from the DOM at
     * open time: this component only knows its own collapsed state, not the
     * left sidebar's, and both are always mounted (collapsed means width 0).
     */
    const leftRect = document.querySelector('.main-layout > .left-sidebar')?.getBoundingClientRect()
    const rightRect = document.querySelector('.main-layout > .right-sidebar')?.getBoundingClientRect()
    const leftEdge = leftRect && leftRect.width > 1 ? leftRect.right : 0
    const rightEdge = rightRect && rightRect.width > 1 ? rightRect.left : window.innerWidth

    setSearchScope((current) => (current === 'panel' ? 'project' : current))
    setSearchOverlay({
      centerX: (leftEdge + rightEdge) / 2,
      zoneWidth: Math.max(rightEdge - leftEdge, 320),
      origin: rect && rect.width > 0
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width }
        : null,
    })
  }, [collapsed, peeked])

  const closeSearchOverlay = useCallback(() => setSearchOverlay(null), [])

  useEffect(() => {
    const onKeyDown = (event) => {
      // ⌘⇧F: ⌘K is the command palette's, and ⌘F the panel's own search bar.
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key.toLowerCase() !== 'f') return
      event.preventDefault()

      if (searchOverlay) closeSearchOverlay()
      else openSearchOverlay()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeSearchOverlay, openSearchOverlay, searchOverlay])

  useCommands(() => [{
    id: 'search.project',
    section: 'Search',
    title: 'Search the project…',
    icon: 'search',
    shortcut: '⇧⌘F',
    keywords: ['find', 'look up', 'everywhere', 'notes', 'documents'],
    run: openSearchOverlay,
  }], [openSearchOverlay])

  const { jumpTo } = swipe
  const handleSelectTab = useCallback((nextTab) => {
    const nextIndex = tabIds.indexOf(nextTab)
    if (nextIndex === -1) return
    jumpTo(nextIndex)
    setSidebarTab(nextTab)
  }, [jumpTo, setSidebarTab, tabIds])

  const isPointerInRevealZone = useCallback(() => (
    Number.isFinite(lastPointerXRef.current) &&
    lastPointerXRef.current >= window.innerWidth - EDGE_REVEAL_ZONE_PX
  ), [])

  const handleSidebarMouseEnter = useCallback((event) => {
    hoveredRef.current = true
    lastPointerXRef.current = event.clientX
  }, [])

  const handleSidebarMouseLeave = useCallback(() => {
    hoveredRef.current = false
    if (!pinned) onAutoCollapse?.()
  }, [onAutoCollapse, pinned])

  const handleSidebarMouseMove = useCallback((event) => {
    lastPointerXRef.current = event.clientX
  }, [])

  // Cmd+S while hovering the sidebar toggles its pinned state (mirrors LeftSidebar).
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!hoveredRef.current) return
      if (!event.metaKey || event.key.toLowerCase() !== 's') return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()

      if (pinned && !isPointerInRevealZone()) {
        hoveredRef.current = false
        onAutoCollapse?.()
        return
      }

      togglePin?.()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isPointerInRevealZone, onAutoCollapse, pinned, togglePin])

  const panelTrackStyle = {
    '--sidebar-pane-count': tabs.length,
    width: `${tabs.length * 100}%`,
    transform: `translateX(-${visualTabProgress * (100 / tabs.length)}%)`,
    transition: gestureActive || prefersReducedMotion
      ? 'none'
      : `transform ${SNAP_DURATION_MS}ms ${SNAP_EASING}`,
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

  // Panels only filter while the bar is in its `panel` scope. Once it is
  // searching a document, notes, or files, the list underneath must be left
  // alone — otherwise a document search would also empty out the panel behind it.
  const panelQuery = isFilterScope(searchScope) ? searchQuery : ''

  // One search, two places it can be drawn. Both copies share this state, so the
  // overlay opens on whatever you had already typed.
  const searchProps = {
    query: searchQuery,
    setQuery: setSearchQuery,
    scope: searchScope,
    setScope: setSearchScope,
    tab: sidebarTab,
    activeEditor,
    editor,
    secondaryEditor,
    currentDoc,
    secondaryDoc,
    activeDoc,
    notesByDoc,
    projectName,
    onOpenSearchTarget,
  }

  const searchOverlayNode = searchOverlay ? createPortal(
    <div
      className="search-overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) closeSearchOverlay()
      }}
    >
      <div
        className={`search-overlay-card${searchOverlay.origin ? ' is-flying' : ''}`}
        style={{
          '--search-center-x': `${searchOverlay.centerX}px`,
          '--search-zone-width': `${searchOverlay.zoneWidth}px`,
          ...(searchOverlay.origin ? {
            // The fly-in lands on the zone's center, so it starts offset from THAT.
            '--search-fly-dx': `${searchOverlay.origin.x - searchOverlay.centerX}px`,
            '--search-fly-dy': `${searchOverlay.origin.y - window.innerHeight / 2}px`,
            '--search-fly-scale': searchOverlay.origin.width / SEARCH_OVERLAY_WIDTH,
          } : null),
        }}
      >
        <SidebarSearch
          {...searchProps}
          variant="overlay"
          onCloseOverlay={closeSearchOverlay}
          onOpenSearchTarget={(target) => {
            closeSearchOverlay()
            onOpenSearchTarget?.(target)
          }}
        />
      </div>
    </div>,
    document.body,
  ) : null

  const renderPanel = (tabId) => {
    if (tabId === 'clipboard') {
      return (
        <ClipboardPanel
          entries={clipboardHistory}
          query={panelQuery}
          onDropToClipboard={onDropToClipboard}
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
          query={panelQuery}
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
          query={panelQuery}
          jumpToText={jumpToText}
          clearActiveNoteHighlight={clearActiveNoteHighlight}
        />
      )
    }

    if (tabId === 'map') return <MapInspectorPanel />
    if (tabId === 'references') return <ReferencesPanel query={panelQuery} />
    if (tabId === 'stats') return <StatsPanel query={panelQuery} />
    if (tabId === 'typeset') return <TypesetPanel onShowOutput={() => handleSelectTab('output')} />
    if (tabId === 'output') return <OutputPanel />

    if (tabId === 'timeline') {
      return (
        <TimelineSidebarPanel
          projectName={projectName}
          docPath={activeDoc}
          editor={activeDoc === secondaryDoc && activeDoc !== currentDoc ? secondaryEditor : editor}
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
        versions={versions?.[activeDoc] || []}
        setVersions={setVersions}
        // The history acts on the ACTIVE document, which may live in either pane.
        editor={activeDoc === secondaryDoc && activeDoc !== currentDoc ? secondaryEditor : editor}
        projectName={projectName}
        docName={activeDoc}
        query={panelQuery}
        refreshFiles={refreshFiles}
        onOpenDocInTab={onOpenDocInTab}
        onOpenCompare={onOpenCompare}
      />
    )
    // In Typeset the book's typeset versions are History's first, with the text's a
    // switch away.
    if (pageLayout?.mode !== 'typeset') return textHistory
    return (
      <div className="history-with-switch">
        <div className="history-mode-switch">
          <Segmented
            value={historyKind}
            onChange={setHistoryKind}
            label="History of"
            stretch
            options={[{ value: 'typeset', label: 'Typeset' }, { value: 'text', label: 'Text' }]}
          />
        </div>
        {historyKind === 'typeset' ? <TypesetHistoryView /> : textHistory}
      </div>
    )
  }

  return (
    <aside
      className={`sidebar right-sidebar${collapsed && !peeked ? ' collapsed' : ''}${peeked ? ' is-peeked' : ''}${resizing ? ' is-resizing' : ''}`}
      style={{ width }}
      ref={sidebarRef}
      onMouseEnter={handleSidebarMouseEnter}
      onMouseLeave={handleSidebarMouseLeave}
      onMouseMove={handleSidebarMouseMove}
    >
      <div className="resizer resizer-left" onMouseDown={onResize} />

      <div className="sidebar-topbar">
        <div className="right-sidebar-global-title" aria-hidden="true">
          <div
            className="right-sidebar-global-title-track"
            style={{
              '--right-sidebar-title-progress': visualTabProgress,
              transition: gestureActive || prefersReducedMotion
                ? 'none'
                : `transform ${SNAP_DURATION_MS}ms ${SNAP_EASING}`,
            }}
          >
            {tabs.map(({ id, label }) => (
              <span key={id} className="panel-header-label right-sidebar-global-title-label">
                {label}
              </span>
            ))}
          </div>
        </div>
        <button
          className={`sidebar-pin${pinned ? ' active' : ''}`}
          onClick={togglePin}
          title={pinned ? 'Unpin sidebar' : 'Pin sidebar'}
          aria-label={pinned ? 'Unpin sidebar' : 'Pin sidebar'}
        >
          <Icon name="pin" active={pinned} />
        </button>
      </div>

      <InspectorHeader
        tabs={tabs}
        tab={sidebarTab}
        setTab={handleSelectTab}
        layout={inspector.layout}
        onChooseLayout={inspector.chooseLayout}
        visualProgress={visualTabProgress}
        gestureActive={gestureActive}
        reducedMotion={prefersReducedMotion}
        onIndicatorDrag={swipe.follow}
        onIndicatorDrop={swipe.settle}
      />

      <div className="sidebar-content">
        <div className={`sidebar-panels-viewport${gestureActive ? ' is-gesture-active' : ''}`}>
          <div className="sidebar-panels-track" style={panelTrackStyle}>
            {tabs.map(({ id }) => (
              <section
                key={id}
                className={`sidebar-panel-pane${sidebarTab === id ? ' is-active' : ''}`}
                aria-hidden={sidebarTab !== id}
              >
                <div className="sidebar-panel-page">
                  {renderedPanelIds.has(id) ? renderPanel(id) : null}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>

      {/* At the foot of the panels, as the file tree's filter is in the left sidebar.
          While the overlay is up it IS this bar, so the copy here would be a
          duplicate. It is hidden rather than unmounted: the bar keeps its box, so
          the panels above do not jump as the overlay opens and closes. */}
      <div
        className={`right-sidebar-search${searchOverlay ? ' is-search-detached' : ''}`}
        ref={searchAnchorRef}
      >
        <SidebarSearch
          {...searchProps}
          active={!searchOverlay}
          onOpenOverlay={openSearchOverlay}
        />
      </div>

      {searchOverlayNode}
    </aside>
  )
}
