import SidebarTabs from './SidebarTabs'
import Workbench from './Workbench'
import NotesPanel from '../NotesPanel'
import HistoryPanel from './HistoryPanel'
import SearchPanel from './SearchPanel'
import SFIcon from '../SFIcon'

export default function RightSidebar({
  width,
  onResize,
  collapsed,
  peeked,
  pinned,
  togglePin,
  onAutoCollapse,
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
  versions = [],
  editor, 
  setVersions,
}) {
  
  return (
    <aside
      className={`sidebar right-sidebar${collapsed && !peeked ? ' collapsed' : ''}`}
      style={{ width }}
      onMouseLeave={() => {
        if (!pinned) onAutoCollapse?.()
      }}
    >
      <div className="resizer resizer-left" onMouseDown={onResize} />

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

      <SidebarTabs
        tab={sidebarTab}
        setTab={setSidebarTab}
      />

      <div className="sidebar-content">
        {sidebarTab === 'search' ? (
          <SearchPanel editor={editor} />
        ) : sidebarTab === 'workbench' ? (
          <Workbench
            tiles={tiles}
            setTiles={setTiles}
            editor={editor}
            secondaryEditor={secondaryEditor}
            currentDoc={currentDoc}
            secondaryDoc={secondaryDoc}
            activeDoc={activeDoc}
          />
        ) : sidebarTab === 'notes' ? (
          <NotesPanel notes={notes} setNotes={setNotes} jumpToText={(note) => {
              if (!editor || note.type !== 'quote') return

              editor
                .chain()
                .focus()
                .setTextSelection({ from: note.from, to: note.to })
                .scrollIntoView()
                .run()
            }}

        
         />
        ) : (
          <HistoryPanel versions={versions} setVersions={setVersions} editor={editor} />
        )}
      </div>
    </aside>
  )
}