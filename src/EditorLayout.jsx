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
    editor: props.editor,
    setTiles: props.setTiles,
    setNotes: props.setNotes,
    setSidebarTab: props.setSidebarTab,
    setSplitView: props.setSplitView,
    setSecondaryDoc: props.setSecondaryDoc,
    splitView: props.splitView,
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
          splitView={props.splitView}
          setSplitView={props.setSplitView}
          secondaryDoc={props.secondaryDoc}
          setSecondaryDoc={props.setSecondaryDoc}
          {...props}
        />

        <EditorCanvas
          {...props}
        />

        <RightSidebar
          width={right.width}
          onResize={right.start}

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
