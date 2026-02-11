import FileTree from './FileTree'

export default function LeftSidebar({
  width,
  onResize,
  projectName,
  currentDoc,
  setCurrentDoc,
  debouncedSave,
  refreshFiles,   // ✅ new
  onSelectDoc,
}) {
  return (
    <aside className="sidebar left-sidebar" style={{ width }}>
      <div className="sidebar-content">
        <FileTree
          projectName={projectName}
          currentDoc={currentDoc}
          onSelectDoc={doc => {
            debouncedSave?.flush?.()
            setCurrentDoc(doc)
          }}
          refreshFiles={refreshFiles}
        />
      </div>
      <div className="resizer resizer-right" onMouseDown={onResize} />
    </aside>
  )
}