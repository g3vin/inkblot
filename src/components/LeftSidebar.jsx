/**
 * LeftSidebar.jsx — collapsible left panel hosting the FileTree.
 *
 * With a project open it holds two views, Files and Book, side by side: the switch
 * chooses between them, and so does a two-finger swipe, the way the inspector's tabs
 * swipe (hooks/useSpaceSwipe.js).
 *
 * Pin/peek behavior is driven by useResizableSidebar (via EditorLayout);
 * this component adds the pin button, project title, resize handle, and a
 * Cmd+S shortcut that pins/unpins the sidebar while hovering it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import FileTree from './FileTree'
import Icon from '../ui/Icon.jsx'
import BookNavigator from './book/BookNavigator'
import SidebarTabs from './RightSidebar/SidebarTabs'
import { useLatestBridgeState } from '../bridge'
import useSpaceSwipe from '../hooks/useSpaceSwipe'

// Drawn with the inspector's tab strip, so both sidebars switch the same way.
const VIEWS = [{ id: 'files', icon: 'folder', label: 'Files' }, { id: 'book', icon: 'book', label: 'Book' }]
/** How the views glide to rest once a swipe lets go, or the switch is clicked. Matches the inspector's. */
const SNAP_DURATION_MS = 260
const SNAP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

// When unpinned, the sidebar peeks open only while the pointer is within this
// distance of the window's left edge.
const EDGE_REVEAL_ZONE_PX = 12

export default function LeftSidebar({
  width,
  onResize,
  resizing,
  collapsed,
  peeked,
  pinned,
  togglePin,
  onAutoCollapse,
  projectName,
  setProjectName,
  currentDoc,
  activeDoc,
  setActiveDoc,
  secondaryDoc,
  splitView,
  setCurrentDoc,
  registerRefreshFiles,
}) {
  // The project's files, or the book's contents in the book's own order. The mode
  // chooses — Typeset shows the book — and the switch overrides it until the mode
  // changes again.
  const layout = useLatestBridgeState('pageLayoutState', null)
  const mode = layout?.mode
  const [view, setView] = useState(mode === 'typeset' ? 'book' : 'files')
  const [followedMode, setFollowedMode] = useState(mode)
  if (mode !== followedMode) {
    setFollowedMode(mode)
    setView(mode === 'typeset' ? 'book' : 'files')
  }

  const hoveredRef = useRef(false)
  const lastPointerXRef = useRef(null)
  const sidebarRef = useRef(null)
  // The foot of the sidebar, where the view showing puts its + and filter (a state,
  // not a ref, so the views hear when it exists).
  const [footerSlot, setFooterSlot] = useState(null)
  const prefersReducedMotion = useReducedMotion()

  // Without a project there is no book, so only Files, and nothing to swipe to.
  const hasBook = Boolean(projectName)
  const viewIndex = hasBook ? Math.max(0, VIEWS.findIndex(({ id }) => id === view)) : 0
  const swipe = useSpaceSwipe({
    targetRef: sidebarRef,
    index: viewIndex,
    count: VIEWS.length,
    panelWidth: width,
    onSettle: (nextIndex) => setView(VIEWS[nextIndex].id),
    enabled: hasBook,
  })
  const { jumpTo } = swipe
  const selectView = useCallback((nextView) => {
    jumpTo(Math.max(0, VIEWS.findIndex(({ id }) => id === nextView)))
    setView(nextView)
  }, [jumpTo])

  const isPointerInRevealZone = useCallback(() => (
    Number.isFinite(lastPointerXRef.current) &&
    lastPointerXRef.current <= EDGE_REVEAL_ZONE_PX
  ), [])

  const handleMouseEnter = useCallback((event) => {
    hoveredRef.current = true
    lastPointerXRef.current = event.clientX
  }, [])

  const handleMouseLeave = useCallback(() => {
    hoveredRef.current = false
    if (!pinned) onAutoCollapse?.()
  }, [onAutoCollapse, pinned])

  const handleMouseMove = useCallback((event) => {
    lastPointerXRef.current = event.clientX
  }, [])

  // Cmd+S while hovering the sidebar toggles its pinned state (collapses first
  // if it's pinned and the pointer isn't in the edge-reveal zone).
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

  // The two views, made once per change to what they show. The swipe re-renders this
  // sidebar every frame; handing the same elements back each time leaves the views
  // alone, so the file list's layout animation never plays because a swipe moved it.
  const handleSelectProject = useCallback((nextProject) => {
    setProjectName?.(nextProject)
  }, [setProjectName])
  const handleSelectDoc = useCallback((doc) => {
    setActiveDoc?.(doc)
    setCurrentDoc(doc)
  }, [setActiveDoc, setCurrentDoc])
  const showFiles = useCallback(() => selectView('files'), [selectView])

  // Creating or renaming happens in the file tree's inline box, so bring Files up for
  // it (⌘K "New canvas…" while the book is showing).
  useEffect(() => {
    window.addEventListener('filetree:new-entry', showFiles)
    return () => window.removeEventListener('filetree:new-entry', showFiles)
  }, [showFiles])
  const filesView = useMemo(() => (
    <FileTree
      projectName={projectName}
      currentDoc={currentDoc}
      secondaryDoc={secondaryDoc}
      splitView={splitView}
      activeDoc={activeDoc}
      onSelectProject={handleSelectProject}
      registerRefreshFiles={registerRefreshFiles}
      onSelectDoc={handleSelectDoc}
      footerSlot={hasBook && view !== 'files' ? null : footerSlot}
    />
  ), [activeDoc, currentDoc, footerSlot, handleSelectDoc, handleSelectProject, hasBook, projectName, registerRefreshFiles, secondaryDoc, splitView, view])
  const bookView = useMemo(() => (
    <BookNavigator hasProject={hasBook} onShowFiles={showFiles} footerSlot={view === 'book' ? footerSlot : null} />
  ), [footerSlot, hasBook, showFiles, view])

  return (
    <aside
      className={`sidebar ib-sheet left-sidebar${collapsed && !peeked ? ' collapsed' : ''}${peeked ? ' is-peeked' : ''}${resizing ? ' is-resizing' : ''}`}
      style={{ width }}
      ref={sidebarRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
    >
      <div className="sidebar-topbar">
        <button
          className={`sidebar-pin${pinned ? ' active' : ''}`}
          onClick={togglePin}
          title={pinned ? 'Unpin sidebar' : 'Pin sidebar'}
          aria-label={pinned ? 'Unpin sidebar' : 'Pin sidebar'}
        >
          <Icon name="pin" active={pinned} />
        </button>
        {projectName ? (
          <span className="panel-header-label left-sidebar-project-title" title={projectName}>
            {projectName}
          </span>
        ) : null}
      </div>
      {projectName ? (
        <div className="left-sidebar-switch">
          <SidebarTabs
            tabs={VIEWS}
            tab={view}
            setTab={selectView}
            visualProgress={swipe.progress}
            gestureActive={swipe.dragging}
            reducedMotion={prefersReducedMotion}
            onIndicatorDrag={swipe.follow}
            onIndicatorDrop={swipe.settle}
          />
        </div>
      ) : null}
      <div className={`sidebar-content${hasBook ? ' has-views' : ''}`}>
        {hasBook ? (
          <div className="sidebar-panels-viewport">
            <div
              className="sidebar-panels-track"
              style={{
                '--sidebar-pane-count': VIEWS.length,
                width: `${VIEWS.length * 100}%`,
                transform: `translateX(-${swipe.progress * (100 / VIEWS.length)}%)`,
                transition: swipe.dragging || prefersReducedMotion
                  ? 'none'
                  : `transform ${SNAP_DURATION_MS}ms ${SNAP_EASING}`,
              }}
            >
              {VIEWS.map(({ id }) => (
                <section
                  key={id}
                  className={`sidebar-panel-pane left-sidebar-pane${view === id ? ' is-active' : ''}`}
                  aria-hidden={view !== id}
                  inert={view !== id}
                >
                  {/* Both stay mounted: one mounted as a swipe begins would play its
                      reveal animation, and the file tree would reload each time. */}
                  {id === 'book' ? bookView : filesView}
                </section>
              ))}
            </div>
          </div>
        ) : filesView}
      </div>
      {/* Stays put while the views swipe. Whichever view is showing draws its + and
          filter here: the file tree's, or the book's. */}
      <div className="left-sidebar-footer" ref={setFooterSlot} />
      <div className="resizer resizer-right" onMouseDown={onResize} />
    </aside>
  )
}
