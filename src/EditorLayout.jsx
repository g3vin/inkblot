import { useEffect } from 'react'
import EditorCanvas from './EditorCanvas'
import LeftSidebar from './LeftSidebar'
import RightSidebar from './RightSidebar/RightSidebar'
import { useResizableSidebar } from './hooks/useResizableSidebar'
import { useEditorContextMenu } from './hooks/useEditorContextMenu'
import { useState } from 'react'

export default function EditorLayout(props) {
  const left = useResizableSidebar(200, 180, 300, 'left')
  const right = useResizableSidebar(300, 280, 500, 'right')
  // Use splitView/secondaryDoc from props (managed at top-level `Editor`) to avoid
  // shadowing state and keep all parts of the UI in sync.
  const handleContextMenu = useEditorContextMenu({
    editor: props.activeEditor,
    setTiles: props.setTiles,
    setNotes: props.setNotes,
    setSidebarTab: props.setSidebarTab,
    setSplitView: props.setSplitView,
    setSecondaryDoc: props.setSecondaryDoc,
    setCurrentDoc: props.setCurrentDoc,
    splitView: props.splitView,
    currentDoc: props.currentDoc,
    secondaryDoc: props.secondaryDoc,
    activeDoc: props.activeDoc,
    projectName: props.projectName,
    refreshFiles: props.refreshFiles,
    onSelectDoc: props.setCurrentDoc,
  })

  const jumpToText = anchor => {
    const editor = props.editor
    if (!editor) return

    let foundPos = -1
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text.includes(anchor)) {
        foundPos = pos + node.text.indexOf(anchor)
        return false
      }
    })

    if (foundPos !== -1) {
      editor
        .chain()
        .focus()
        .setTextSelection({
          from: foundPos,
          to: foundPos + anchor.length,
        })
        .scrollIntoView()
        .run()
    }
  }

  useEffect(() => {
    const handler = e => {
      props.setSidebarTab('notes')
      setTimeout(() => {
        const el = document.getElementById(`note-${e.detail}`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 50)
    }

    window.addEventListener('open-note', handler)
    return () => window.removeEventListener('open-note', handler)
  }, [])

  return (
    <div
      className="editor-page-wrapper"
      onContextMenu={handleContextMenu}
    >
      <div className="main-layout">

        <LeftSidebar
          width={left.width}
          onResize={left.start}
          collapsed={left.collapsed}
          peeked={left.peeked}
          pinned={left.pinned}
          togglePin={left.togglePin}
          onAutoCollapse={left.collapse}
          splitView={props.splitView}
          setSplitView={props.setSplitView}
          setSecondaryDoc={props.setSecondaryDoc}
          currentDoc={props.currentDoc}
          secondaryDoc={props.secondaryDoc}
          activeDoc={props.activeDoc}
          setActiveDoc={props.setActiveDoc}
          registerRefreshFiles={props.registerRefreshFiles}
          projectName={props.projectName}
          setProjectName={props.setProjectName}
          secondaryEditor={props.secondaryEditor}
          {...props}
        />

        <EditorCanvas
          {...props}
        />

        <RightSidebar
          width={right.width}
          onResize={right.start}
          collapsed={right.collapsed}
          peeked={right.peeked}
          pinned={right.pinned}
          togglePin={right.togglePin}
          onAutoCollapse={right.collapse}

          sidebarTab={props.sidebarTab}
          setSidebarTab={props.setSidebarTab}

          tiles={props.tiles}
          setTiles={props.setTiles}
          notes={props.notes}
          setNotes={props.setNotes}

          editor={props.editor}

          versions={props.versions}
          setVersions={props.setVersions}

          jumpToText={jumpToText}
        />


      </div>
    </div>
  )
}
