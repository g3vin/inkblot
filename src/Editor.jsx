import { useState, useRef, useEffect, useCallback } from 'react'
import EditorLayout from './EditorLayout'
import { debounce } from 'lodash'
import { saveDocument, loadDocument, listProjects, documentExists } from './FileSystem'

import './Editor.css'

const PERSIST_KEY = 'inkblot-session'
const CLIPBOARD_PERSIST_KEY = 'inkblot-clipboard-history'
const MAX_CLIPBOARD_ENTRIES = 80

const loadSession = (fallbackProject) => {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return { projectName: fallbackProject }
    return { projectName: fallbackProject, ...JSON.parse(raw) }
  } catch {
    return { projectName: fallbackProject }
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
  const [clipboardHistory, setClipboardHistory] = useState(() => loadClipboardHistory())
  const [activeDoc, setActiveDoc] = useState(session.activeDoc || session.currentDoc || 'doc1')
  const [versions, setVersionsState] = useState({})
  const setVersions = useCallback((docName, vs) => {
    if (!docName) return
    try {
      console.debug('[setVersions] set', { docName, count: Array.isArray(vs) ? vs.length : 0 })
    } catch (e) {}
    setVersionsState(prev => ({ ...prev, [docName]: vs || [] }))
  }, [])

  const [splitView, setSplitView] = useState(session.splitView || null) // null, 'editor', or 'pinterest'
  const [secondaryDoc, setSecondaryDoc] = useState(session.secondaryDoc || null) // The name of the second file
  const refreshFilesRef = useRef(null)
  const initialProjectRef = useRef(projectName)
  const draggedSelectionRef = useRef(null)

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
      return { ...prev, [docName]: next }
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

  const debouncedSave = useCallback(
    debounce(async content => {
      await saveDocument(projectName, docRef.current, content)
    }, 2000),
    [projectName]
  )

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
        clipboardHistory={clipboardHistory}
        clearClipboardHistory={clearClipboardHistory}
        onDropToClipboard={handleDropToClipboard}
        onMoveClipboardEntryToEditor={moveClipboardEntryToEditor}

        debouncedSave={debouncedSave}
        loadDocument={loadDocument}
        refreshFiles={() => refreshFilesRef.current?.()}
        registerRefreshFiles={(fn) => { refreshFilesRef.current = fn }}
      />
    </>
  )
}
