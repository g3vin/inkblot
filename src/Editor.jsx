import { useState, useRef, useEffect, useCallback } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import EditorLayout from './EditorLayout'
import { loadDocument, listProjects, documentExists, createProject, listProjectTree } from './FileSystem'
import { normalizeNotes } from './noteUtils'
import SFIcon from './SFIcon'
import appIconUrl from '../src-tauri/icons/icon.png'

import './Editor.css'

const PERSIST_KEY = 'inkblot-session'
const CLIPBOARD_PERSIST_KEY = 'inkblot-clipboard-history'
const MAX_CLIPBOARD_ENTRIES = 80
const RIGHT_SIDEBAR_TAB_IDS = new Set(['search', 'clipboard', 'workbench', 'notes', 'history'])
const LANDING_WINDOW_DRAG_HEIGHT = 52
const LANDING_WINDOW_DRAG_BLOCKER_SELECTOR = [
  'button',
  'input',
  'select',
  'textarea',
  'a',
  'label',
  '[role="button"]',
].join(',')

const createEmptySession = (fallbackProject) => ({
  lastProject: fallbackProject || '',
  projects: {},
})

const normalizeProjectSession = (session = {}) => ({
  currentDoc: session.currentDoc || '',
  secondaryDoc: session.secondaryDoc || null,
  splitView: session.splitView || null,
  activeDoc: session.activeDoc || session.currentDoc || '',
  sidebarTab: RIGHT_SIDEBAR_TAB_IDS.has(session.sidebarTab) ? session.sidebarTab : 'workbench',
  tiles: Array.isArray(session.tiles) ? session.tiles : [],
  updatedAt: session.updatedAt || null,
})

const loadSession = (fallbackProject) => {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return createEmptySession(fallbackProject)

    const parsed = JSON.parse(raw)
    if (parsed?.projects && typeof parsed.projects === 'object') {
      return {
        ...createEmptySession(fallbackProject),
        ...parsed,
        projects: Object.fromEntries(
          Object.entries(parsed.projects).map(([projectName, projectSession]) => [
            projectName,
            normalizeProjectSession(projectSession),
          ])
        ),
      }
    }

    if (parsed?.projectName) {
      return {
        lastProject: parsed.projectName,
        projects: {
          [parsed.projectName]: normalizeProjectSession(parsed),
        },
      }
    }

    return createEmptySession(fallbackProject)
  } catch {
    return createEmptySession(fallbackProject)
  }
}

const loadClipboardHistory = () => {
  try {
    const raw = localStorage.getItem(CLIPBOARD_PERSIST_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(item => item && typeof item.text === 'string')
  } catch {
    return []
  }
}

const getMountedEditorView = (instance) => {
  if (!instance || instance.isDestroyed) return null
  const view = instance.editorView
  if (!view || view.isDestroyed) return null
  return view
}

const countTreeEntries = (node) => {
  const totals = { files: 0, folders: 0 }

  const visit = (entry) => {
    if (!entry) return
    if (entry.type === 'file') {
      totals.files += 1
      return
    }
    if (entry.type === 'folder' && entry.path) {
      totals.folders += 1
    }
    ;(entry.children || []).forEach(visit)
  }

  visit(node)
  return totals
}

const formatRecentDate = (value) => {
  if (!value) return 'No recent activity'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No recent activity'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function ProjectLanding({
  projectSessions,
  onOpenProject,
  onCreateProject,
}) {
  const [projects, setProjects] = useState([])
  const [query, setQuery] = useState('')
  const [newProjectName, setNewProjectName] = useState('')
  const [createPromptOpen, setCreatePromptOpen] = useState(false)
  const [status, setStatus] = useState('')

  const refreshProjects = useCallback(async () => {
    const names = await listProjects()
    const summaries = await Promise.all(
      names.map(async (name) => {
        try {
          const tree = await listProjectTree(name)
          return { name, ...countTreeEntries(tree) }
        } catch {
          return { name, files: 0, folders: 0 }
        }
      })
    )
    setProjects(summaries)
  }, [])

  useEffect(() => {
    refreshProjects()
  }, [refreshProjects])

  const handleLandingMouseDown = useCallback((event) => {
    if (event.button !== 0) return
    if (event.clientY > LANDING_WINDOW_DRAG_HEIGHT) return
    if (event.target instanceof Element && event.target.closest(LANDING_WINDOW_DRAG_BLOCKER_SELECTOR)) {
      return
    }

    event.preventDefault()
    getCurrentWindow().startDragging().catch(error => {
      console.warn('Failed to start landing window drag:', error)
    })
  }, [])

  const visibleProjects = projects
    .filter(project => project.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((left, right) => {
      const leftTime = new Date(projectSessions[left.name]?.updatedAt || 0).getTime() || 0
      const rightTime = new Date(projectSessions[right.name]?.updatedAt || 0).getTime() || 0
      if (rightTime !== leftTime) return rightTime - leftTime
      return left.name.localeCompare(right.name)
    })

  const handleCreateProject = async (event) => {
    event?.preventDefault?.()
    const trimmed = newProjectName.trim()
    if (!trimmed) return

    if (projects.some(project => project.name.toLowerCase() === trimmed.toLowerCase())) {
      setStatus('A project with that name already exists.')
      return
    }

    const ok = await createProject(trimmed)
    if (!ok) {
      setStatus('Could not create that project.')
      return
    }

    setStatus('')
    setNewProjectName('')
    setCreatePromptOpen(false)
    await refreshProjects()
    onCreateProject(trimmed)
  }

  return (
    <div className="landing-page" onMouseDownCapture={handleLandingMouseDown} data-tauri-drag-region>
      <div className="landing-shell">
        <header className="landing-header">
          <svg className="landing-app-icon" viewBox="0 0 512 512" role="img" aria-label="Inkblot">
            <defs>
              <filter id="landing-app-icon-remove-bg" colorInterpolationFilters="sRGB">
                <feColorMatrix
                  type="matrix"
                  values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -4 -4 -4 0 11.1"
                />
              </filter>
            </defs>
            <image
              href={appIconUrl}
              width="512"
              height="512"
              preserveAspectRatio="xMidYMid meet"
              filter="url(#landing-app-icon-remove-bg)"
            />
          </svg>
        </header>

        <div className="landing-controls">
          <label className="landing-search">
            <SFIcon name="magnifyingglass.circle" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search projects"
              aria-label="Search projects"
            />
          </label>
        </div>

        {status && !createPromptOpen ? <div className="landing-status">{status}</div> : null}

        <div className="landing-project-actions">
          <button
            type="button"
            className="landing-create-button"
            onClick={() => {
              setCreatePromptOpen(true)
              setStatus('')
            }}
            aria-label="Create project"
            title="Create project"
          >
            <SFIcon name="plus" size={22} strokeWidth={1.7} />
          </button>
        </div>

        <div className="landing-project-grid">
          {visibleProjects.length === 0 ? (
            <div className="landing-empty">
              {projects.length === 0 ? 'Create a project to begin.' : 'No projects match your search.'}
            </div>
          ) : (
            visibleProjects.map((project) => {
              const projectSession = projectSessions[project.name] || {}
              return (
                <button
                  key={project.name}
                  type="button"
                  className="landing-project-tile"
                  onClick={() => onOpenProject(project.name)}
                >
                  <div className="landing-project-icon">
                    <SFIcon name="folder" />
                  </div>
                  <div className="landing-project-main">
                    <div className="landing-project-name">{project.name}</div>
                    <div className="landing-project-meta">
                      <span>{project.files} file{project.files === 1 ? '' : 's'}</span>
                      <span>{formatRecentDate(projectSession.updatedAt)}</span>
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {createPromptOpen ? (
        <div className="landing-create-overlay" onMouseDown={() => setCreatePromptOpen(false)}>
          <form
            className="landing-create-dialog"
            onSubmit={handleCreateProject}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="landing-create-dialog-header">
              <h2>New Project</h2>
              <button
                type="button"
                className="landing-create-close"
                onClick={() => setCreatePromptOpen(false)}
                aria-label="Close"
              >
                <SFIcon name="xmark" />
              </button>
            </div>
            <input
              value={newProjectName}
              onChange={(event) => {
                setNewProjectName(event.target.value)
                setStatus('')
              }}
              placeholder="Project name"
              aria-label="Project name"
              autoFocus
            />
            {status ? <div className="landing-status landing-dialog-status">{status}</div> : null}
            <button type="submit" className="landing-create-submit">
              Create
            </button>
          </form>
        </div>
      ) : null}
    </div>
  )
}

export default function Editor({
  projectName: initialProject = 'DefaultProject',
  showWordCountBadge = true,
}) {
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

  const [splitView, setSplitView] = useState(null) // null, 'editor', or 'pinterest'
  const [secondaryDoc, setSecondaryDoc] = useState(null) // The name of the second file
  const refreshFilesRef = useRef(null)
  const draggedSelectionRef = useRef(null)

  const openProject = useCallback((nextProjectName) => {
    if (!nextProjectName) {
      setProjectNameState('')
      setCurrentDoc('')
      setActiveDoc('')
      setSecondaryDoc(null)
      setSplitView(null)
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

  const getClipboardDropZoneRect = useCallback(() => {
    const clipboardPanel = document.querySelector('.clipboard-panel')
    if (!clipboardPanel) return null
    const rightSidebar = clipboardPanel.closest('.right-sidebar')
    const sidebarContent = clipboardPanel.closest('.sidebar-content')
    return (
      rightSidebar?.getBoundingClientRect?.() ||
      sidebarContent?.getBoundingClientRect?.() ||
      clipboardPanel.getBoundingClientRect?.() ||
      null
    )
  }, [])

  const isPointInsideRect = useCallback((x, y, rect) => {
    if (!rect || x == null || y == null) return false
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }, [])

  const isPointInAnyEditorPane = useCallback((x, y) => {
    const primaryPane = document.querySelector('.primary-pane')
    const secondaryPane = document.querySelector('.secondary-pane')
    const primaryRect = primaryPane?.getBoundingClientRect?.() || null
    const secondaryRect = secondaryPane?.getBoundingClientRect?.() || null

    return (
      isPointInsideRect(x, y, primaryRect) ||
      isPointInsideRect(x, y, secondaryRect)
    )
  }, [isPointInsideRect])

  const docRef = useRef(currentDoc)
  useEffect(() => { docRef.current = currentDoc }, [currentDoc])

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
    }

    validateSession()
    return () => {
      cancelled = true
    }
  }, [projectName, currentDoc, secondaryDoc, openProject])

  useEffect(() => {
    if (projectName) return
    const payload = {
      lastProject: initialSession.lastProject || '',
      projects: projectSessions,
    }
    localStorage.setItem(PERSIST_KEY, JSON.stringify(payload))
  }, [initialSession.lastProject, projectName, projectSessions])

  useEffect(() => {
    if (!projectName) return
    const now = new Date().toISOString()
    const nextProjectSession = normalizeProjectSession({
      currentDoc,
      secondaryDoc,
      splitView,
      activeDoc,
      sidebarTab,
      tiles,
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
  }, [projectName, currentDoc, secondaryDoc, splitView, activeDoc, sidebarTab, tiles])

  useEffect(() => {
    localStorage.setItem(CLIPBOARD_PERSIST_KEY, JSON.stringify(clipboardHistory))
  }, [clipboardHistory])

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
      return { ...prev, [docName]: normalizeNotes(next) }
    })
  }, [])

  const notes = notesByDoc[activeDoc] || []
  const setNotes = useCallback((updater) => {
    setNotesForDoc(activeDoc, updater)
  }, [activeDoc, setNotesForDoc])

  const addClipboardEntry = useCallback((text) => {
    const normalized = (text || '').trim()
    if (!normalized) return

    setClipboardHistory(prev => {
      const nextEntry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        text: normalized,
        docName: activeDoc || currentDoc || '',
        timestamp: new Date().toISOString(),
      }

      const deduped = prev.filter(entry => entry.text !== nextEntry.text)
      return [nextEntry, ...deduped].slice(0, MAX_CLIPBOARD_ENTRIES)
    })
  }, [activeDoc, currentDoc])

  const clearClipboardHistory = useCallback(() => {
    setClipboardHistory([])
  }, [])

  const moveClipboardEntryToEditor = useCallback((entryId) => {
    if (!entryId) return
    setClipboardHistory(prev => prev.filter(entry => entry.id !== entryId))
  }, [])

  const handleDropToClipboard = useCallback((payload) => {
    const text = (payload?.text || '').trim()
    if (!text) return

    const draggedSelection = draggedSelectionRef.current || payload?.selection
    const matchesDraggedSelection = Boolean(
      draggedSelection && draggedSelection.text?.trim() === text
    )
    const shouldRemoveFromDoc = Boolean(
      draggedSelection && (payload?.fromEditorSelection || matchesDraggedSelection)
    )

    if (shouldRemoveFromDoc) {
      const sourceEditor =
        draggedSelection.source === 'secondary' ? secondaryEditor : editor

      if (sourceEditor) {
        const docSize = sourceEditor.state?.doc?.content?.size ?? 0
        const from = Math.max(0, Math.min(draggedSelection.from, docSize))
        const to = Math.max(from, Math.min(draggedSelection.to, docSize))

        if (to > from) {
          sourceEditor
            .chain()
            .focus()
            .setTextSelection({ from, to })
            .deleteSelection()
            .run()
          try {
            window.dispatchEvent(new CustomEvent('inkblot:dnd-debug', {
              detail: {
                phase: 'editor-selection-removed',
                textLength: text.length,
                from,
                to,
                status: {
                  source: 'editor',
                  over: 'clipboard',
                },
              },
            }))
          } catch (e) {}
        }
      }
    }

    addClipboardEntry(text)
    draggedSelectionRef.current = null
    try { window.__inkblot_draggedEditorSelection = null } catch (e) {}
  }, [addClipboardEntry, editor, secondaryEditor])

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
        try {
          window.dispatchEvent(new CustomEvent('inkblot:dnd-debug', {
            detail: {
              phase: 'editor-dragend-cancelled-in-editor',
              info: `x=${String(point.x)} y=${String(point.y)}`,
              status: {
                source: 'editor',
                over: 'editor',
                dropHandled: false,
                editorSelection: true,
              },
            },
          }))
        } catch (e) {}

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
          window.dispatchEvent(new CustomEvent('inkblot:dnd-debug', {
            detail: {
              phase: 'editor-dragend-drop-to-clipboard',
              info: `x=${String(point.x)} y=${String(point.y)} len=${draggedSelection.text.length}`,
              status: {
                source: 'editor',
                over: 'clipboard',
                dropHandled: true,
                editorSelection: true,
              },
            },
          }))
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

  useEffect(() => {
    const handlePasteWithFormat = async (event) => {
      // Cmd+Shift+V (metaKey + shiftKey + 'v') — normalize key to lower
      if (event.metaKey && event.shiftKey && event.key && event.key.toLowerCase() === 'v') {
        // Prevent other handlers and default browser UI
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation();
        }

        try {
          const clipboardText = await navigator.clipboard.readText();

          // Sanitize: strip HTML and styles, keep plain text
          const parser = new DOMParser();
          const doc = parser.parseFromString(clipboardText, 'text/html');
          const plainText = doc.body.textContent || '';

          // Prefer the explicit activeTipTap editor, fall back to primary/secondary editor
          const targetEditor = activeEditor || editor || secondaryEditor;

          if (targetEditor && typeof targetEditor.chain === 'function') {
            // TipTap editor API
            targetEditor.chain().focus().insertContent(plainText).run();
            return;
          }

          // Fallback: if we have a ProseMirror view (TipTap exposes `view`), use tr.insertText
          const view = getMountedEditorView(targetEditor)
          if (view && view.state && view.dispatch) {
            const tr = view.state.tr.insertText(plainText);
            view.dispatch(tr.scrollIntoView());
            if (view.dom && typeof view.dom.focus === 'function') view.dom.focus();
            return;
          }

          // Last resort: try to paste into the active element (textarea or contenteditable)
          const activeEl = document.activeElement;
          if (activeEl && (activeEl.isContentEditable || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT')) {
            // For inputs/textareas, use setRangeText or value insertion
            if (typeof activeEl.setRangeText === 'function') {
              try {
                activeEl.setRangeText(plainText);
              } catch (e) {
                activeEl.value = (activeEl.value || '') + plainText;
              }
            } else if (typeof document.execCommand === 'function') {
              document.execCommand('insertText', false, plainText);
            } else {
              activeEl.textContent = (activeEl.textContent || '') + plainText;
            }
            // restore focus
            try { activeEl.focus(); } catch (e) {}
            return;
          }

          console.error('No suitable editor target to paste into.');
        } catch (error) {
          console.error('Failed to read clipboard content:', error);
        }
      }
    };

    // Use capture so we get the event before other listeners
    window.addEventListener('keydown', handlePasteWithFormat, { capture: true });

    return () => {
    window.removeEventListener('keydown', handlePasteWithFormat, { capture: true });
    };
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
    <>
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
        clipboardHistory={clipboardHistory}
        clearClipboardHistory={clearClipboardHistory}
        onDropToClipboard={handleDropToClipboard}
        onMoveClipboardEntryToEditor={moveClipboardEntryToEditor}
        showWordCountBadge={showWordCountBadge}

        loadDocument={loadDocument}
        refreshFiles={() => refreshFilesRef.current?.()}
        registerRefreshFiles={(fn) => { refreshFilesRef.current = fn }}
      />
    </>
  )
}
