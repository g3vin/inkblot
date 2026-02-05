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
    <aside className="sidebar" style={{ width }}>
      <div className="resizer resizer-left" onMouseDown={onResize} />

      <SidebarTabs
        tab={sidebarTab}
        setTab={setSidebarTab}
      />

      <div className="sidebar-content">
        {sidebarTab === 'workbench' ? (
          <Workbench tiles={tiles} setTiles={setTiles} editor={editor} />
        ) : sidebarTab === 'notes' ? (
          <NotesPanel notes={notes} setNotes={setNotes} jumpToText={(text) => {
            if (!editor) return
            let foundPos = -1
            editor.state.doc.descendants((node, pos) => {
              if (node.isText && node.text.includes(text)) {
                foundPos = pos + node.text.indexOf(text)
                return false
              }
            })
            if (foundPos !== -1) {
              editor.chain().focus().setTextSelection({ from: foundPos, to: foundPos + text.length }).scrollIntoView().run()
            }
          }} />
        ) : (
          <HistoryPanel versions={versions} setVersions={setVersions} editor={editor} />
        )}
      </div>
    </aside>
  )
}