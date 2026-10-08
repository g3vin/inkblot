/**
 * LeftSidebar.jsx — collapsible left panel hosting the FileTree.
 *
 * Pin/peek behavior is driven by useResizableSidebar (via EditorLayout);
 * this component adds the pin button, project title, resize handle, and a
 * Cmd+S shortcut that pins/unpins the sidebar while hovering it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import FileTree from './FileTree'
import Icon from '../ui/Icon.jsx'
import BookNavigator from './book/BookNavigator'
import { Segmented } from '../ui'
import { useLatestBridgeState } from '../bridge'

const VIEWS = [{ value: 'files', label: 'Files' }, { value: 'book', label: 'Book' }]

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

  return (
    <aside
      className={`sidebar left-sidebar${collapsed && !peeked ? ' collapsed' : ''}${peeked ? ' is-peeked' : ''}${resizing ? ' is-resizing' : ''}`}
      style={{ width }}
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
        <Segmented
          className="left-sidebar-switch"
          label="Show"
          value={view}
          onChange={setView}
          options={VIEWS}
          stretch
        />
      ) : null}
      <div className="sidebar-content">
        {view === 'book' && projectName ? (
          <BookNavigator hasProject={Boolean(projectName)} onShowFiles={() => setView('files')} />
        ) : <FileTree
          projectName={projectName}
          currentDoc={currentDoc}
          secondaryDoc={secondaryDoc}
          splitView={splitView}
          activeDoc={activeDoc}
          onSelectProject={(nextProject) => {
            setProjectName?.(nextProject)
          }}
          registerRefreshFiles={registerRefreshFiles}
          onSelectDoc={doc => {
            setActiveDoc?.(doc)
            setCurrentDoc(doc)
          }}
        />}
      </div>
      <div className="resizer resizer-right" onMouseDown={onResize} />
    </aside>
  )
}
