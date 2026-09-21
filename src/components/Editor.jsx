/**
 * Editor.jsx — top-level editor state container.
 *
 * Owns everything scoped to the open project: which documents are open
 * (primary/secondary/split view), per-document notes, workbench tiles,
 * clipboard history, version lists, and the right-sidebar tab. Persists
 * per-project session state to localStorage and restores it on launch.
 *
 * Renders the ProjectLanding screen when no project is open, otherwise
 * hands all state down to EditorLayout.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import EditorLayout from './EditorLayout'
import { loadDocument, listProjects, documentExists } from '../lib/FileSystem'
import { readDetachedTarget } from '../lib/docWindow'
import { normalizeNotes } from '../lib/noteUtils'
import SFIcon from './SFIcon'

import './Editor.css'

import ProjectLanding from './ProjectLanding'
import { useTabs } from './useTabs'
import { useClipboardHistory } from './useClipboardHistory'
import {
  CLIPBOARD_PERSIST_KEY,
  MAX_CLIPBOARD_ENTRIES,
  PERSIST_KEY,
  RIGHT_SIDEBAR_TAB_IDS,
  loadClipboardHistory,
  loadSession,
  normalizeProjectSession,
} from '../lib/editorSession'

/** Return a TipTap editor's live ProseMirror view, or null if unmounted/destroyed. */
const getMountedEditorView = (instance) => {
  if (!instance || instance.isDestroyed) return null
  const view = instance.editorView
  if (!view || view.isDestroyed) return null
  return view
}

export default function Editor({
  projectName: initialProject = 'DefaultProject',
  showWordCountBadge = true,
}) {
  // Set in a window opened by "Open in New Window": that window boots straight
  // into one document and never writes the session back (see docWindow.js).
  const [detachedTarget] = useState(() => readDetachedTarget())
  const [initialSession] = useState(() => loadSession(initialProject))
  const [projectSessions, setProjectSessions] = useState(initialSession.projects || {})
  const [projectName, setProjectNameState] = useState('')
  const [editor, setEditor] = useState(null)
  const [secondaryEditor, setSecondaryEditor] = useState(null)
  const [activeEditor, setActiveEditor] = useState(null)

  const [currentDoc, setCurrentDoc] = useState('')
  const [sidebarTab, setSidebarTab] = useState('workbench')
  const [tiles, setTiles] = useState([])
  const [notesByDoc, setNotesByDoc] = useState({})
  const [clipboardHistory, setClipboardHistory] = useState(() => loadClipboardHistory())
  const [activeDoc, setActiveDoc] = useState('')
  const [versions, setVersionsState] = useState({})
  const setVersions = useCallback((docName, vs) => {
    if (!docName) return
    setVersionsState(prev => ({ ...prev, [docName]: vs || [] }))
  }, [])

  // The version comparison showing in the editor area: { docName, leftId, rightId }.
  // Deliberately NOT part of splitView — compare borrows the editor's space without
  // disturbing the panes underneath, so a split stays intact while you read a diff.
  const [compare, setCompare] = useState(null)
  const openCompare = useCallback((docName, leftId, rightId = 'current') => {
    if (!docName) return
    setCompare({ docName, leftId: String(leftId), rightId: String(rightId) })
  }, [])
  const closeCompare = useCallback(() => setCompare(null), [])

  const [splitView, setSplitView] = useState(null) // null, 'editor', or 'pinterest'
  const [splitOrientation, setSplitOrientation] = useState('columns') // 'columns' (side by side) | 'rows' (stacked)
  const [splitRatio, setSplitRatioState] = useState(0.5) // share of the split taken by the primary pane
  const [secondaryDoc, setSecondaryDoc] = useState(null) // The name of the second file
  // The dock's tabs. A tab is { id, docPath }, where docPath: null is a draft —
  // a tab that has not decided what document it is yet (see DraftTabPane).
  const [tabs, setTabs] = useState([])
  const [activeTabId, setActiveTabId] = useState(null)
  const refreshFilesRef = useRef(null)
  const draggedSelectionRef = useRef(null)

  // Switch to a project (or back to the landing page when passed a falsy name),
  // restoring that project's persisted docs/tiles/sidebar state.
  const openProject = useCallback((nextProjectName) => {
    if (!nextProjectName) {
      setProjectNameState('')
      setCurrentDoc('')
      setActiveDoc('')
      setSecondaryDoc(null)
      setCompare(null)
      setSplitView(null)
      setSplitOrientation('columns')
      setSplitRatioState(0.5)
      setTabs([])
      setActiveTabId(null)
      setSidebarTab('workbench')
      setTiles([])
      setNotesByDoc({})
      setVersionsState({})
      return
    }

    const projectOpenId = `${nextProjectName}:${Date.now()}:${Math.random().toString(16).slice(2)}`
    try {
      window.__inkblotProjectOpenId = projectOpenId
      window.__inkblotProjectName = nextProjectName
      window.sessionStorage?.setItem('inkblot:project-open-id', projectOpenId)
      window.sessionStorage?.setItem('inkblot:project-name', nextProjectName)
      window.dispatchEvent(new CustomEvent('inkblot:project-opened', {
        detail: { projectName: nextProjectName, projectOpenId },
      }))
    } catch {
      // Session markers are best-effort; project opening should never depend on them.
    }

    const projectSession = normalizeProjectSession(projectSessions[nextProjectName] || {})
    setProjectNameState(nextProjectName)
    setCurrentDoc(projectSession.currentDoc)
    setActiveDoc(projectSession.activeDoc || projectSession.currentDoc)
    setSecondaryDoc(projectSession.secondaryDoc)
    setSplitView(projectSession.splitView)
    setSplitOrientation(projectSession.splitOrientation)
    setSplitRatioState(projectSession.splitRatio)
    setTabs(projectSession.docTabs)
    setActiveTabId(projectSession.activeTabId)
    setSidebarTab(projectSession.sidebarTab)
    setTiles(projectSession.tiles)
    setNotesByDoc({})
    setVersionsState({})
  }, [projectSessions])

  const createAndOpenProject = useCallback((nextProjectName) => {
    const now = new Date().toISOString()
    setProjectSessions(prev => ({
      ...prev,
      [nextProjectName]: normalizeProjectSession({
        ...(prev[nextProjectName] || {}),
        updatedAt: now,
      }),
    }))
    openProject(nextProjectName)
  }, [openProject])

  // A comparison borrows the editor area from the document it is about. Once that
  // document is no longer in either pane, the diff on screen describes something
  // you can't see and can no longer merge into — so it closes with it.
  useEffect(() => {
    if (!compare) return
    if (compare.docName !== currentDoc && compare.docName !== secondaryDoc) setCompare(null)
  }, [compare, currentDoc, secondaryDoc])

  const {
    openDocInTab,
    selectTab,
    newDraftTab,
    adoptDraftDoc,
    closeTab,
    keepTab,
    closeOtherTabs,
    closeTabsToTheRight,
    closeAllTabs,
    openDocInSplit,
    closeSplit,
    draftTabActive,
    setSplitRatio,
  } = useTabs({
    activeTabId,
    currentDoc,
    secondaryDoc,
    setActiveDoc,
    setActiveTabId,
    setCurrentDoc,
    setSecondaryDoc,
    setSplitOrientation,
    setSplitRatioState,
    setSplitView,
    setTabs,
    tabs,
  })

  // Bounding rect of the clipboard panel (or its sidebar container) used as the drag-drop target.
  const {
    getClipboardDropZoneRect,
    isPointInAnyEditorPane,
    addClipboardEntry,
    clearClipboardHistory,
    moveClipboardEntryToEditor,
    handleDropToClipboard,
  } = useClipboardHistory({
    activeDoc,
    currentDoc,
    draggedSelectionRef,
    editor,
    secondaryEditor,
    setClipboardHistory,
  })


  const docRef = useRef(currentDoc)
  useEffect(() => { docRef.current = currentDoc }, [currentDoc])

  // Validate the restored session against disk: bail out to the landing page if the
  // project vanished, and close docs that no longer exist.
  useEffect(() => {
    let cancelled = false

    const validateSession = async () => {
      if (!projectName) return
      const projects = await listProjects()
      if (cancelled) return

      if (!projects.includes(projectName)) {
        openProject('')
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

      // A tab whose document was deleted (or renamed) elsewhere would be a dot
      // that opens nothing, so the dock drops it. Drafts have no document to check.
      const tabDocs = tabs.map(tab => tab.docPath).filter(Boolean)
      if (tabDocs.length) {
        const existence = await Promise.all(
          tabDocs.map(docPath => documentExists(projectName, docPath))
        )
        if (cancelled) return

        const missing = new Set(tabDocs.filter((docPath, index) => !existence[index]))
        if (missing.size) {
          setTabs(prev => prev.filter(tab => !tab.docPath || !missing.has(tab.docPath)))
        }
      }
    }

    validateSession()
    return () => {
      cancelled = true
    }
  }, [projectName, currentDoc, secondaryDoc, tabs, openProject])

  // A detached window opens its one document and nothing else — no landing page,
  // no restored tabs.
  useEffect(() => {
    if (!detachedTarget) return
    openProject(detachedTarget.projectName)
    setCurrentDoc(detachedTarget.docPath)
    setActiveDoc(detachedTarget.docPath)
    // Boot-once: re-running this would yank the window back to its opening document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist the session while on the landing page (covers project deletes/renames).
  useEffect(() => {
    if (detachedTarget) return
    if (projectName) return
    const payload = {
      lastProject: initialSession.lastProject || '',
      projects: projectSessions,
    }
    localStorage.setItem(PERSIST_KEY, JSON.stringify(payload))
  }, [detachedTarget, initialSession.lastProject, projectName, projectSessions])

  // Persist the open project's session whenever any of its state changes.
  useEffect(() => {
    if (detachedTarget) return
    if (!projectName) return
    const now = new Date().toISOString()
    const nextProjectSession = normalizeProjectSession({
      currentDoc,
      secondaryDoc,
      splitView,
      splitOrientation,
      splitRatio,
      activeDoc,
      sidebarTab,
      tiles,
      docTabs: tabs,
      activeTabId,
      updatedAt: now,
    })

    setProjectSessions(prev => {
      const nextProjectSessions = {
        ...prev,
        [projectName]: nextProjectSession,
      }

      const payload = {
        lastProject: projectName,
        projects: nextProjectSessions,
      }
      localStorage.setItem(PERSIST_KEY, JSON.stringify(payload))
      return nextProjectSessions
    })
  }, [detachedTarget, projectName, currentDoc, secondaryDoc, splitView, splitOrientation, splitRatio, activeDoc, sidebarTab, tiles, tabs, activeTabId])

  useEffect(() => {
    localStorage.setItem(CLIPBOARD_PERSIST_KEY, JSON.stringify(clipboardHistory))
  }, [clipboardHistory])

  // Outside of an editor split (or with no secondary doc), the primary doc is always active.
  useEffect(() => {
    if (splitView !== 'editor' || !secondaryDoc) {
      setActiveDoc(currentDoc)
    }
  }, [currentDoc, splitView, secondaryDoc])

  // Notes are stored per document; `notes`/`setNotes` below are views onto the active doc's list.
  const setNotesForDoc = useCallback((docName, updater) => {
    setNotesByDoc(prev => {
      const current = prev[docName] || []
      const next = typeof updater === 'function' ? updater(current) : updater
      return { ...prev, [docName]: normalizeNotes(next) }
    })
  }, [])

  const notes = notesByDoc[activeDoc] || []
  const setNotes = useCallback((updater) => {
    setNotesForDoc(activeDoc, updater)
  }, [activeDoc, setNotesForDoc])

  // Push a new entry onto the clipboard history (deduped, capped at MAX_CLIPBOARD_ENTRIES).

  // Bridge: EditorCanvas fires this event when a selection drag ends over the clipboard panel.
  useEffect(() => {
    const onEditorDragEndDropToClipboard = (event) => {
      const detail = event?.detail || {}
      handleDropToClipboard({
        text: detail.text || '',
        fromEditorSelection: true,
        selection: detail.selection || null,
      })
    }

    window.addEventListener('inkblot:editor-dragend-drop-to-clipboard', onEditorDragEndDropToClipboard)
    return () => {
      window.removeEventListener('inkblot:editor-dragend-drop-to-clipboard', onEditorDragEndDropToClipboard)
    }
  }, [handleDropToClipboard])

  // Track drags that start from an editor selection so we can tell, on dragend,
  // whether the text was dropped back into an editor pane (reorder) or onto the
  // clipboard panel (move to clipboard). State is mirrored on window globals
  // because native drag events cross React boundaries.
  useEffect(() => {
    const onDragStart = (event) => {
      const targetNode = event?.target
      const targetElement =
        targetNode instanceof Element ? targetNode :
          targetNode instanceof Node ? targetNode.parentElement : null
      if (!targetElement) return

      const paneEl = targetElement.closest('.primary-pane, .secondary-pane')
      if (!paneEl) return

      const isSecondary = paneEl.classList.contains('secondary-pane')
      const sourceEditor = isSecondary ? secondaryEditor : editor
      const sourceDocName = isSecondary ? secondaryDoc : currentDoc
      if (!sourceEditor?.state?.selection) return

      const { from, to, empty } = sourceEditor.state.selection
      if (empty) return

      const selectedText = sourceEditor.state.doc.textBetween(from, to, '\n')
      if (!selectedText.trim()) return

      const payload = {
        from,
        to,
        text: selectedText,
        source: isSecondary ? 'secondary' : 'primary',
        docName: sourceDocName || '',
      }

      draggedSelectionRef.current = payload
      try { window.__inkblot_draggedEditorSelection = payload } catch (e) {}

      try {
        event.dataTransfer?.setData('application/x-inkblot-editor-selection', JSON.stringify(payload))
        if (!event.dataTransfer?.getData('text/plain')) {
          event.dataTransfer?.setData('text/plain', selectedText)
        }
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move'
        }
      } catch (e) {}
    }

    const onDragEnd = (event) => {
      const draggedSelection = draggedSelectionRef.current || window.__inkblot_draggedEditorSelection || null
      if (!draggedSelection) return

      const point = {
        x: event?.clientX ?? window.__inkblot_dragPoint?.x ?? null,
        y: event?.clientY ?? window.__inkblot_dragPoint?.y ?? null,
      }

      const endedInEditorPane = isPointInAnyEditorPane(point.x, point.y)
      if (endedInEditorPane) {
        window.setTimeout(() => {
          draggedSelectionRef.current = null
          try { window.__inkblot_draggedEditorSelection = null } catch (e) {}
          try { window.__inkblot_dragPoint = null } catch (e) {}
          try { window.__inkblot_dropHandled = false } catch (e) {}
        }, 0)
        return
      }

      try {
        window.dispatchEvent(new CustomEvent('inkblot:editor-selection-dragend', {
          detail: {
            selection: draggedSelection,
            x: point.x,
            y: point.y,
          },
        }))
      } catch (e) {}

      const rect = getClipboardDropZoneRect()
      const endedOverClipboard = Boolean(
        draggedSelection?.text &&
        rect &&
        point.x != null &&
        point.y != null &&
        point.x >= rect.left &&
        point.x <= rect.right &&
        point.y >= rect.top &&
        point.y <= rect.bottom
      )

      if (!window.__inkblot_dropHandled && endedOverClipboard) {
        try {
          window.dispatchEvent(new CustomEvent('inkblot:editor-dragend-drop-to-clipboard', {
            detail: {
              text: draggedSelection.text,
              selection: draggedSelection,
              x: point.x,
              y: point.y,
            },
          }))
          window.__inkblot_dropHandled = true
        } catch (e) {}
      }

      window.setTimeout(() => {
        draggedSelectionRef.current = null
        try { window.__inkblot_draggedEditorSelection = null } catch (e) {}
        try { window.__inkblot_dragPoint = null } catch (e) {}
        try { window.__inkblot_dropHandled = false } catch (e) {}
      }, 0)
    }

    window.addEventListener('dragstart', onDragStart, true)
    window.addEventListener('dragend', onDragEnd, true)

    return () => {
      window.removeEventListener('dragstart', onDragStart, true)
      window.removeEventListener('dragend', onDragEnd, true)
    }
  }, [currentDoc, editor, getClipboardDropZoneRect, isPointInAnyEditorPane, secondaryDoc, secondaryEditor])

  // Record every copy (from the editor or any input) into the clipboard history.
  useEffect(() => {
    const getSelectedText = (target) => {
      const selectedInWindow = window.getSelection?.()?.toString?.()
      if (selectedInWindow) return selectedInWindow

      if (target && typeof target.value === 'string') {
        const start = target.selectionStart
        const end = target.selectionEnd
        if (typeof start === 'number' && typeof end === 'number' && end > start) {
          return target.value.slice(start, end)
        }
      }

      return ''
    }

    const onCopy = (event) => {
      const text = getSelectedText(event?.target)
      addClipboardEntry(text)
    }

    window.addEventListener('copy', onCopy, true)

    return () => {
      window.removeEventListener('copy', onCopy, true)
    }
  }, [addClipboardEntry])

  // Cmd+Shift+V: paste clipboard contents as plain text (HTML/styles stripped).
  useEffect(() => {
    const handlePastePlain = async (event) => {
      if (!(event.metaKey && event.shiftKey && event.key?.toLowerCase() === 'v')) return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()

      try {
        const clipboardText = await navigator.clipboard.readText()
        const doc = new DOMParser().parseFromString(clipboardText, 'text/html')
        const plainText = doc.body.textContent || ''

        // Prefer the focused TipTap editor, then its raw ProseMirror view,
        // then whatever editable element currently has focus.
        const targetEditor = activeEditor || editor || secondaryEditor
        if (typeof targetEditor?.chain === 'function') {
          targetEditor.chain().focus().insertContent(plainText).run()
          return
        }

        const view = getMountedEditorView(targetEditor)
        if (view?.state && view.dispatch) {
          view.dispatch(view.state.tr.insertText(plainText).scrollIntoView())
          view.dom?.focus?.()
          return
        }

        const activeEl = document.activeElement
        if (activeEl && (activeEl.isContentEditable || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT')) {
          if (typeof activeEl.setRangeText === 'function') {
            try {
              activeEl.setRangeText(plainText)
            } catch {
              activeEl.value = (activeEl.value || '') + plainText
            }
          } else if (typeof document.execCommand === 'function') {
            document.execCommand('insertText', false, plainText)
          } else {
            activeEl.textContent = (activeEl.textContent || '') + plainText
          }
          try { activeEl.focus() } catch {}
          return
        }

        console.error('No suitable editor target to paste into.')
      } catch (error) {
        console.error('Failed to read clipboard content:', error)
      }
    }

    // Capture phase so this runs before TipTap's own paste handling.
    window.addEventListener('keydown', handlePastePlain, { capture: true })
    return () => window.removeEventListener('keydown', handlePastePlain, { capture: true })
  }, [activeEditor, editor, secondaryEditor])

  if (!projectName) {
    return (
      <ProjectLanding
        projectSessions={projectSessions}
        onOpenProject={openProject}
        onCreateProject={createAndOpenProject}
      />
    )
  }

  return (
      <EditorLayout
        splitView={splitView}
        setSplitView={setSplitView}
        splitOrientation={splitOrientation}
        splitRatio={splitRatio}
        setSplitRatio={setSplitRatio}

        tabs={tabs}
        activeTabId={activeTabId}
        draftTabActive={draftTabActive}
        onSelectTab={selectTab}
        onCloseTab={closeTab}
        onCloseOtherTabs={closeOtherTabs}
        onCloseTabsToTheRight={closeTabsToTheRight}
        onCloseAllTabs={closeAllTabs}
        onKeepTab={keepTab}
        onNewTab={newDraftTab}
        onOpenDocInTab={openDocInTab}
        onOpenDocInSplit={openDocInSplit}
        onCloseSplit={closeSplit}
        onDraftCreated={adoptDraftDoc}

        editor={editor}
        setEditor={setEditor}
        secondaryEditor={secondaryEditor}
        setSecondaryEditor={setSecondaryEditor}
        activeEditor={activeEditor}
        setActiveEditor={setActiveEditor}

        projectName={projectName}
        setProjectName={openProject}
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
        compare={compare}
        openCompare={openCompare}
        closeCompare={closeCompare}
        clipboardHistory={clipboardHistory}
        clearClipboardHistory={clearClipboardHistory}
        onDropToClipboard={handleDropToClipboard}
        onMoveClipboardEntryToEditor={moveClipboardEntryToEditor}
        showWordCountBadge={showWordCountBadge}

        loadDocument={loadDocument}
        refreshFiles={() => refreshFilesRef.current?.()}
        registerRefreshFiles={(fn) => { refreshFilesRef.current = fn }}
      />
  )
}
