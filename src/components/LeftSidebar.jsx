/**
 * LeftSidebar.jsx — collapsible left panel hosting the FileTree.
 *
 * With a project open it holds two views, Files and Book, side by side: the switch
 * chooses between them, and so does a two-finger swipe, the way the inspector's tabs
 * swipe (hooks/useSpaceSwipe.js).
 *
 * Pin/peek behavior is driven by useResizableSidebar (via EditorLayout), and the
 * pin button is in the document card's top-left corner. Pinned, the sidebar is
 * docked on the window's tray; peeked, it hovers over the card. This component adds
 * the project title, resize handle, and a Cmd+S shortcut that pins/unpins the
 * sidebar while hovering it.
 *
 * Its foot holds the showing view's + and, on the inner end, the project search
 * (search/ProjectSearch.jsx), which stays put while the views swipe.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import FileTree from './FileTree'
import BookNavigator from './book/BookNavigator'
import ProjectSearch from './search/ProjectSearch'
import SidebarTabs from './RightSidebar/SidebarTabs'
import { useLatestBridgeState } from '../bridge'
import useSpaceSwipe from '../hooks/useSpaceSwipe'
import usePeekDismiss from '../hooks/usePeekDismiss'
import { FILETREE_NEW_ENTRY } from '../lib/appEvents'

// Drawn with the inspector's tab strip, so both sidebars switch the same way.
const VIEWS = [{ id: 'files', icon: 'folder', label: 'Files' }, { id: 'book', icon: 'book', label: 'Book' }]

export default function LeftSidebar({
  width,
  onResize,
  resizing,
  collapsed,
  peeked,
  pinned,
  gliding,
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
  editor,
  secondaryEditor,
  activeEditor,
  notesByDoc,
  onOpenSearchTarget,
  splits,
  activeSplitId,
  onOpenSavedSplit,
  onOpenDocAlone,
  onForgetSplit,
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
  const sidebarRef = useRef(null)
  // The foot of the sidebar, where the view showing puts its + (a state, not a ref,
  // so the views hear when it exists).
  const [footerSlot, setFooterSlot] = useState(null)
  const prefersReducedMotion = useReducedMotion()
  // While the search card is up, a hovering sidebar stays: the card is drawn over the
  // page, so reaching for it leaves the sidebar.
  const [searching, setSearching] = useState(false)

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

  const handleMouseEnter = useCallback(() => {
    hoveredRef.current = true
  }, [])

  const handleMouseLeave = useCallback(() => {
    hoveredRef.current = false
    if (peeked && !searching) onAutoCollapse?.()
  }, [onAutoCollapse, peeked, searching])

  usePeekDismiss(sidebarRef, peeked && !searching, onAutoCollapse)

  // Cmd+S while hovering the sidebar toggles its pinned state.
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

  // The two views, made once per change to what they show. The swipe re-renders this
  // sidebar every frame; handing the same elements back each time leaves the views
  // alone, so the file list's layout animation never plays because a swipe moved it.
  const handleSelectProject = useCallback((nextProject) => {
    setProjectName?.(nextProject)
  }, [setProjectName])
  // Choosing a document shows it on its own; a split it leaves stays in the tree.
  const handleSelectDoc = useCallback((doc) => {
    if (onOpenDocAlone) {
      onOpenDocAlone(doc)
      return
    }
    setActiveDoc?.(doc)
    setCurrentDoc(doc)
  }, [onOpenDocAlone, setActiveDoc, setCurrentDoc])
  const showFiles = useCallback(() => selectView('files'), [selectView])

  // Creating or renaming happens in the file tree's inline box, so bring Files up for
  // it (⌘K "New canvas…" while the book is showing).
  useEffect(() => {
    window.addEventListener(FILETREE_NEW_ENTRY, showFiles)
    return () => window.removeEventListener(FILETREE_NEW_ENTRY, showFiles)
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
      splits={splits}
      activeSplitId={activeSplitId}
      onOpenSplit={onOpenSavedSplit}
      onForgetSplit={onForgetSplit}
      footerSlot={hasBook && view !== 'files' ? null : footerSlot}
    />
  ), [activeDoc, activeSplitId, currentDoc, footerSlot, handleSelectDoc, handleSelectProject, hasBook, onForgetSplit, onOpenSavedSplit, projectName, registerRefreshFiles, secondaryDoc, splitView, splits, view])
  const bookView = useMemo(() => (
    <BookNavigator hasProject={hasBook} onShowFiles={showFiles} footerSlot={view === 'book' ? footerSlot : null} />
  ), [footerSlot, hasBook, showFiles, view])

  return (
    <aside
      className={`sidebar ib-sheet ib-tray left-sidebar${pinned ? ' is-docked' : ' is-veiled'}${gliding ? ' is-gliding' : ''}${collapsed ? ' collapsed' : ''}${peeked ? ' is-peeked' : ''}${resizing ? ' is-resizing' : ''}`}
      style={{ width, '--sidebar-w': `${width}px` }}
      ref={sidebarRef}
      aria-hidden={collapsed || undefined}
      inert={collapsed || undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="sidebar-topbar">
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
            following={swipe.moving}
            snap={swipe.snap}
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
                // On the fingers while they swipe; otherwise sprung there on the
                // compositor, with a swipe's speed kept (useSpaceSwipe).
                transition: swipe.moving || prefersReducedMotion ? 'none' : `transform ${swipe.snap}`,
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
      {/* Stays put while the views swipe. Whichever view is showing draws its + in
          the slot (the file tree's, or the book's); the search is the sidebar's own. */}
      <div className="left-sidebar-footer">
        <div className="left-sidebar-footer-slot" ref={setFooterSlot} />
        <ProjectSearch
          projectName={projectName}
          editor={editor}
          secondaryEditor={secondaryEditor}
          activeEditor={activeEditor}
          currentDoc={currentDoc}
          secondaryDoc={secondaryDoc}
          activeDoc={activeDoc}
          notesByDoc={notesByDoc}
          onOpenSearchTarget={onOpenSearchTarget}
          onScreen={!collapsed || peeked}
          onOpenChange={setSearching}
        />
      </div>
      <div className="resizer resizer-right" onMouseDown={onResize} />
    </aside>
  )
}
