import FileTree from './FileTree'

export default function LeftSidebar({
  width,
  onResize,
  projectName,
  currentDoc,
  setCurrentDoc,
  debouncedSave,
}) {
  return (
    <aside className="sidebar" style={{ width }}>
      <div className="sidebar-content">
        <FileTree
          projectName={projectName}
          currentDoc={currentDoc}
          onSelectDoc={doc => {
            debouncedSave?.flush?.()
            setCurrentDoc(doc)
          }}
        />
      </div>
      <div className="resizer resizer-right" onMouseDown={onResize} />
    </aside>
  )
}