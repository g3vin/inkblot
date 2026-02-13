import { useState, useRef, useEffect, useCallback } from 'react'
import EditorLayout from './EditorLayout'
import { debounce } from 'lodash'
import { saveDocument, loadDocument, listProjects, documentExists } from './FileSystem'

import './Editor.css'

const PERSIST_KEY = 'inkblot-session'

const loadSession = (fallbackProject) => {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return { projectName: fallbackProject }
    return { projectName: fallbackProject, ...JSON.parse(raw) }
  } catch {
    return { projectName: fallbackProject }
  }
}

export default function Editor({ projectName: initialProject = 'DefaultProject' }) {
  const session = loadSession(initialProject)
  const [projectName, setProjectName] = useState(session.projectName || initialProject)
  const [editor, setEditor] = useState(null)
  const [secondaryEditor, setSecondaryEditor] = useState(null)
  const [activeEditor, setActiveEditor] = useState(null)

  const [currentDoc, setCurrentDoc] = useState(session.currentDoc || 'doc1')
  const [sidebarTab, setSidebarTab] = useState('workbench')
  const [tiles, setTiles] = useState([])
  const [notesByDoc, setNotesByDoc] = useState({})
  const [activeDoc, setActiveDoc] = useState(session.activeDoc || session.currentDoc || 'doc1')
  const [versions, setVersions] = useState([])

  const [splitView, setSplitView] = useState(session.splitView || null) // null, 'editor', or 'pinterest'
  const [secondaryDoc, setSecondaryDoc] = useState(session.secondaryDoc || null) // The name of the second file
  const refreshFilesRef = useRef(null)
  const initialProjectRef = useRef(projectName)

  const handleSplit = (docName, type = 'editor') => {
    setSecondaryDoc(docName);
    setSplitView(type);
  };
    

  const docRef = useRef(currentDoc)
  useEffect(() => { docRef.current = currentDoc }, [currentDoc])

  useEffect(() => {
    if (projectName === initialProjectRef.current) return
    setNotesByDoc({})
    setSecondaryDoc(null)
    setSplitView(null)
  }, [projectName])

  useEffect(() => {
    let cancelled = false

    const validateSession = async () => {
      if (!projectName) return
      const projects = await listProjects()
      if (cancelled) return

      if (!projects.includes(projectName)) {
        setProjectName('')
        setCurrentDoc('')
        setActiveDoc('')
        setSecondaryDoc(null)
        setSplitView(null)
        setNotesByDoc({})
        window.dispatchEvent(new CustomEvent('filetree:show-projects'))
        return
      }

      if (currentDoc) {
        const exists = await documentExists(projectName, currentDoc)
        if (!exists && !cancelled) {
          setCurrentDoc('')
          setActiveDoc('')
          setSecondaryDoc(null)
          setSplitView(null)
        }
      }

      if (secondaryDoc) {
        const existsSecondary = await documentExists(projectName, secondaryDoc)
        if (!existsSecondary && !cancelled) {
          setSecondaryDoc(null)
          setSplitView(null)
        }
      }
    }

    validateSession()
    return () => {
      cancelled = true
    }
  }, [projectName, currentDoc, secondaryDoc])

  useEffect(() => {
    const payload = {
      projectName,
      currentDoc,
      secondaryDoc,
      splitView,
      activeDoc,
    }
    localStorage.setItem(PERSIST_KEY, JSON.stringify(payload))
  }, [projectName, currentDoc, secondaryDoc, splitView, activeDoc])

  useEffect(() => {
    if (splitView !== 'editor') {
      setActiveDoc(currentDoc)
    } else if (!secondaryDoc) {
      setActiveDoc(currentDoc)
    }
  }, [currentDoc, splitView, secondaryDoc])

  const setNotesForDoc = useCallback((docName, updater) => {
    setNotesByDoc(prev => {
      const current = prev[docName] || []
      const next = typeof updater === 'function' ? updater(current) : updater
      return { ...prev, [docName]: next }
    })
  }, [])

  const notes = notesByDoc[activeDoc] || []
  const setNotes = useCallback((updater) => {
    setNotesForDoc(activeDoc, updater)
  }, [activeDoc, setNotesForDoc])

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

      editor={editor}
      setEditor={setEditor}
      secondaryEditor={secondaryEditor}
      setSecondaryEditor={setSecondaryEditor}
      activeEditor={activeEditor}
      setActiveEditor={setActiveEditor}

      projectName={projectName}
      setProjectName={setProjectName}
      currentDoc={currentDoc}
      setCurrentDoc={setCurrentDoc}
      secondaryDoc={secondaryDoc}
      setSecondaryDoc={setSecondaryDoc}

      sidebarTab={sidebarTab}
      setSidebarTab={setSidebarTab}

      tiles={tiles}
      setTiles={setTiles}

      notes={notes}
      setNotes={setNotes}
      notesByDoc={notesByDoc}
      setNotesForDoc={setNotesForDoc}
      activeDoc={activeDoc}
      setActiveDoc={setActiveDoc}

      versions={versions}
      setVersions={setVersions}

      debouncedSave={debouncedSave}
      loadDocument={loadDocument}
      refreshFiles={() => refreshFilesRef.current?.()}
      registerRefreshFiles={(fn) => { refreshFilesRef.current = fn }}
    />
  )
}