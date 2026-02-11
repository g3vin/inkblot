import SidebarTabs from './SidebarTabs'
import Workbench from './Workbench'
import NotesPanel from '../NotesPanel'
import HistoryPanel from './HistoryPanel'

export default function RightSidebar({
  width,
  onResize,
  sidebarTab,
  setSidebarTab,
  tiles,
  setTiles,
  notes,
  setNotes,
  versions = [],
  editor, 
  setVersions,
}) {
  
  return (
    <aside className="sidebar right-sidebar" style={{ width }}>
      <div className="resizer resizer-left" onMouseDown={onResize} />

      <SidebarTabs
        tab={sidebarTab}
        setTab={setSidebarTab}
      />

      <div className="sidebar-content">
        {sidebarTab === 'workbench' ? (
          <Workbench tiles={tiles} setTiles={setTiles} editor={editor} />
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