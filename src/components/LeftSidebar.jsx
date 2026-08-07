import { useCallback, useEffect, useRef } from 'react'
import FileTree from './FileTree'
import SFIcon from './SFIcon'

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
          <SFIcon name="pin" filled={pinned} />
        </button>
      </div>
      <div className="sidebar-content">
        <FileTree
          projectName={projectName}
          currentDoc={currentDoc}
          secondaryDoc={secondaryDoc}
          splitView={splitView}
          activeDoc={activeDoc}
          onSelectProject={(nextProject) => {
            setProjectName?.(nextProject)
          }}
          onExitProject={() => {
            setProjectName?.('')
            setCurrentDoc('')
            setActiveDoc?.('')
          }}
          registerRefreshFiles={registerRefreshFiles}
          onSelectDoc={doc => {
            setActiveDoc?.(doc)
            setCurrentDoc(doc)
          }}
        />
      </div>
      <div className="resizer resizer-right" onMouseDown={onResize} />
    </aside>
  )
}
