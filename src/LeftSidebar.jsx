import FileTree from './FileTree'
import SFIcon from './SFIcon'

export default function LeftSidebar({
  width,
  onResize,
  collapsed,
  peeked,
  pinned,
  togglePin,
  onAutoCollapse,
  onContextMenu,
  projectName,
  setProjectName,
  currentDoc,
  activeDoc,
  setActiveDoc,
  secondaryDoc,
  splitView,
  setCurrentDoc,
  debouncedSave,
  registerRefreshFiles,
  onSelectDoc,
}) {
  return (
    <aside
      className={`sidebar left-sidebar${collapsed && !peeked ? ' collapsed' : ''}`}
      style={{ width }}
      onMouseLeave={() => {
        if (!pinned) onAutoCollapse?.()
      }}
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
            if (!activeDoc) {
              setProjectName?.('')
              setCurrentDoc('')
              setActiveDoc?.('')
            }
          }}
          registerRefreshFiles={registerRefreshFiles}
          onSelectDoc={doc => {
            debouncedSave?.flush?.()
            setActiveDoc?.(doc)
            setCurrentDoc(doc)
          }}
        />
      </div>
      <div className="resizer resizer-right" onMouseDown={onResize} />
    </aside>
  )
}