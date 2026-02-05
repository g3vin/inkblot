import { useState, useRef, useEffect, useCallback } from 'react'
import EditorLayout from './EditorLayout'
import { debounce } from 'lodash'
import { saveDocument, loadDocument } from './FileSystem'

import './Editor.css'

export default function Editor({ projectName = 'DefaultProject' }) {
  const [editor, setEditor] = useState(null)

  const [currentDoc, setCurrentDoc] = useState('doc1')
  const [sidebarTab, setSidebarTab] = useState('workbench')
  const [tiles, setTiles] = useState([])
  const [notes, setNotes] = useState([])
  const [versions, setVersions] = useState([])

  const [splitView, setSplitView] = useState(null); // null, 'editor', or 'pinterest'
  const [secondaryDoc, setSecondaryDoc] = useState(null); // The name of the second file

  const handleSplit = (docName, type = 'editor') => {
    setSecondaryDoc(docName);
    setSplitView(type);
  };
    

  const docRef = useRef(currentDoc)
  useEffect(() => { docRef.current = currentDoc }, [currentDoc])

  const debouncedSave = useCallback(
    debounce(async content => {
      await saveDocument(projectName, docRef.current, content)
    }, 2000),
    [projectName]
  )

  return (
    <EditorLayout
      splitView={splitView}
      setSplitView={setSplitView}
    secondaryDoc={secondaryDoc}
    setSecondaryDoc={setSecondaryDoc}

      editor={editor}
      setEditor={setEditor}

      projectName={projectName}
      currentDoc={currentDoc}
      setCurrentDoc={setCurrentDoc}

      sidebarTab={sidebarTab}
      setSidebarTab={setSidebarTab}

      tiles={tiles}
      setTiles={setTiles}

      notes={notes}
      setNotes={setNotes}

      versions={versions}
      setVersions={setVersions}

      debouncedSave={debouncedSave}
      loadDocument={loadDocument}
    />
  )
}