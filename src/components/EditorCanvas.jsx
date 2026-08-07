/**
 * EditorCanvas.jsx — the writing surface.
 *
 * Creates the primary and secondary TipTap editors (secondary appears in
 * split view), loads/saves documents through FileSystem, and manages:
 *  - autosave (debounced) plus slower version-history checkpoints
 *  - per-pane word-count badges
 *  - caching editor state per document so switching docs is instant
 *  - drag & drop of clipboard entries and editor selections between panes
 *  - pasting images and Pinterest board URLs as rich nodes
 *  - remapping quote-note anchors as the document changes
 *  - the Focus Mode overlay (see FocusModeOverlay.jsx)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { createDocument } from '@tiptap/core'
import { Fragment } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { debounce } from 'lodash'

import { syncEditorNotes } from '../extensions/NoteAnnotation'
import { normalizePinterestBoardUrl } from '../extensions/PinterestBoard'
import { buildEditorExtensions } from '../lib/editorExtensions'
import { saveDocument, loadDocument, getVersions } from '../lib/FileSystem'
import { isEditorReady } from '../lib/editorUtils'
import { isCanvasDoc } from '../lib/docKind'
import CanvasPane from '../canvas/CanvasPane'
import DraftTabPane from './DraftTabPane'
import FocusModeOverlay from './FocusModeOverlay'
import VersionComparePane from './VersionComparePane'
import SFIcon from './SFIcon'

const EMPTY_NOTES = []
const EMPTY_DOC_CONTENT = '<p></p>'
const WORD_COUNT_DEBOUNCE_MS = 300
const HISTORY_CHECKPOINT_DEBOUNCE_MS = 15000

/** Whitespace-delimited word count. */
const countWords = (text = '') => {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

const emptyWordStats = {
  total: 0,
  selected: null,
}

const areWordStatsEqual = (left, right) => (
  left.total === right.total &&
  left.selected === right.selected
)

/** Shallow-compare two note arrays (per-note key/value equality) to avoid redundant state updates. */
const areNoteArraysEqual = (left = [], right = []) => {
  if (left === right) return true
  if (!Array.isArray(left) || !Array.isArray(right)) return false
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    const leftNote = left[index]
    const rightNote = right[index]

    if (leftNote === rightNote) continue
    if (!leftNote || !rightNote) return false

    const leftKeys = Object.keys(leftNote)
    const rightKeys = Object.keys(rightNote)
    if (leftKeys.length !== rightKeys.length) return false

    for (const key of leftKeys) {
      if (leftNote[key] !== rightNote[key]) {
        return false
      }
    }
  }

  return true
}

export default function EditorCanvas({
  setEditor,
  setSecondaryEditor,
  setActiveEditor,
  projectName,
  currentDoc,
  setCurrentDoc,
  splitView,
  setSplitView,
  splitOrientation = 'columns',
  splitRatio = 0.5,
  setSplitRatio,
  secondaryDoc,
  setSecondaryDoc,
  notesByDoc,
  setNotesForDoc,
  activeDoc,
  setActiveDoc,
  setVersions,
  showWordCountBadge = true,
  onMoveClipboardEntryToEditor,
  activeEditor,
  focusModeOpen = false,
  onExitFocusMode,
  draftTabActive = false,
  onDraftCreated,
  refreshFiles,
  compare = null,
  closeCompare,
  onOpenDocInTab,
}) {
  // A draft tab holds the primary pane without holding a document: the pane is
  // "open" (and any split stays up) while DraftTabPane asks what it should be.
  const hasActiveDoc = Boolean(projectName && (currentDoc || draftTabActive))
  const primaryPaneRef = useRef(null)
  const secondaryPaneRef = useRef(null)
  const splitContainerRef = useRef(null)
  const [isResizingSplit, setIsResizingSplit] = useState(false)
  const [dragCaret, setDragCaret] = useState(null)
  const notesByDocRef = useRef(notesByDoc)
  const loadedDocsRef = useRef(new Set())
  const docStateCacheRef = useRef(new Map())
  const primaryAutosaveRef = useRef(null)
  const secondaryAutosaveRef = useRef(null)
  const primaryVersionCheckpointRef = useRef(null)
  const isLoadingPrimaryRef = useRef(false)
  const isLoadingSecondaryRef = useRef(false)
  const activeDocRef = useRef(activeDoc)
  const activeEditorRef = useRef(activeEditor)

  // Editor state is cached per project/pane/doc so revisiting a doc restores
  // scroll, selection, and undo history instantly without re-parsing content.
  const getDocCacheKey = useCallback((docProjectName, docName, paneId) => (
    docProjectName && docName && paneId ? `${docProjectName}::${paneId}::${docName}` : ''
  ), [])

  const hasNotesForDoc = useCallback((docName) => (
    Object.prototype.hasOwnProperty.call(notesByDocRef.current || {}, docName)
  ), [])

  // Build a fresh ProseMirror EditorState from stored document content.
  const createEditorStateFromContent = useCallback((targetEditor, content) => {
    const doc = createDocument(
      content || EMPTY_DOC_CONTENT,
      targetEditor.schema,
      {},
      { errorOnInvalidContent: targetEditor.options.enableContentCheck }
    )

    return EditorState.create({
      doc,
      schema: targetEditor.schema,
      plugins: targetEditor.state.plugins,
    })
  }, [])

  const installEditorState = useCallback((targetEditor, nextState) => {
    targetEditor.view.updateState(nextState)
    targetEditor.createNodeViews?.()
  }, [])

  // Save the pane's current editor state into the doc cache before switching away.
  const stashEditorState = useCallback((targetEditor, docName, paneId) => {
    if (!isEditorReady(targetEditor)) return
    const cacheKey = getDocCacheKey(projectName, docName, paneId)
    if (!cacheKey || !loadedDocsRef.current.has(cacheKey)) return
    docStateCacheRef.current.set(cacheKey, targetEditor.state)
  }, [getDocCacheKey, projectName])

  const flushAutosave = useCallback((handlerRef) => {
    const handler = handlerRef.current
    if (handler && typeof handler.flush === 'function') {
      handler.flush()
    }
  }, [])

  useEffect(() => {
    activeDocRef.current = activeDoc
  }, [activeDoc])

  useEffect(() => {
    activeEditorRef.current = activeEditor
  }, [activeEditor])

  // Install a doc into a pane: prefer the cached state, else build one from
  // the loaded content; also seed the doc's notes on first open.
  const restoreEditorStateForDoc = useCallback((targetEditor, docName, paneId, loadedDoc) => {
    const cacheKey = getDocCacheKey(projectName, docName, paneId)
    const cachedState = cacheKey ? docStateCacheRef.current.get(cacheKey) : null
    const nextState = cachedState || createEditorStateFromContent(targetEditor, loadedDoc?.content)

    installEditorState(targetEditor, nextState)
    if (cacheKey) {
      loadedDocsRef.current.add(cacheKey)
    }

    if (!hasNotesForDoc(docName)) {
      setNotesForDoc(docName, loadedDoc?.notes || [])
    }

    return Boolean(cachedState)
  }, [
    createEditorStateFromContent,
    getDocCacheKey,
    hasNotesForDoc,
    installEditorState,
    projectName,
    setNotesForDoc,
  ])

  const getMountedEditorView = (instance) => {
    if (!isEditorReady(instance)) return null
    const view = instance.editorView || instance.view
    if (!view || view.isDestroyed) return null
    return view
  }

  // Paste interception: images become image nodes, Pinterest board URLs become
  // embedded boards, and a globally-requested plain paste inserts raw text.
  // Everything else falls through to TipTap's default handling.
  const createPasteHandler = () => {
    return (view, event) => {
      const items = event.clipboardData?.items

      const imageItem = items
        ? Array.from(items).find(item => item.type.startsWith('image/'))
        : null

      if (imageItem) {
        const file = imageItem.getAsFile()
        if (!file) return false

        const reader = new FileReader()
        reader.onload = () => {
          const src = reader.result
          if (typeof src !== 'string') return

          const { schema, tr } = view.state
          const imageNode = schema.nodes.image?.create({ src })
          if (!imageNode) return
          view.dispatch(tr.replaceSelectionWith(imageNode))
        }
        reader.readAsDataURL(file)
        return true
      }

      // Pinterest board auto-embed when pasting a board URL.
      const pastedText = event.clipboardData?.getData('text/plain')
      const boardUrl = normalizePinterestBoardUrl(pastedText)
      if (boardUrl) {
        const { schema, tr, selection } = view.state
        const boardNode = schema.nodes.pinterestBoard?.create({ url: boardUrl })
        if (!boardNode) return false

        const paragraph = schema.nodes.paragraph?.create()
        const fragment = paragraph
          ? Fragment.fromArray([boardNode, paragraph])
          : Fragment.fromArray([boardNode])

        view.dispatch(
          tr
            .replaceRange(selection.from, selection.to, fragment)
            .scrollIntoView()
        )
        return true
      }

      // If a plain-paste was explicitly requested elsewhere (e.g. Cmd+Shift+V handler),
      // handle it here by inserting plain text only. Otherwise, let default paste proceed
      // so normal Cmd+V preserves formatting.
      if (window.__inkblot_forcePlainPaste) {
        try { event.preventDefault(); } catch (e) {}

        const plainTextFromClipboard = event.clipboardData?.getData('text/plain') || ''
        const { tr, selection } = view.state
        tr.insertText(plainTextFromClipboard, selection.from, selection.to)
        view.dispatch(tr.scrollIntoView())
        // reset the flag so subsequent pastes behave normally
        try { window.__inkblot_forcePlainPaste = false } catch (e) {}
        return true
      }

      // Not a forced plain paste — return false to allow TipTap's default paste handling
      return false
    }
  }

  // Resolve the {id, text} being dragged from the clipboard panel, from the
  // dataTransfer payload or the window-global fallbacks. Returns null for
  // drags that originated as editor selections.
  const getDraggedClipboardPayload = (event) => {
    const transfer = event?.dataTransfer
    const globalDragged = window.__inkblot_draggedClipboardEntry
    const globalDraggedEditorSelection = window.__inkblot_draggedEditorSelection
    const raw = transfer?.getData('application/x-inkblot-clipboard-entry')
    const plainText = transfer?.getData('text/plain') || ''
    if (!raw && !globalDragged?.text && !plainText) return null
    if (!raw && !globalDragged?.text && globalDraggedEditorSelection) return null

    let parsed = null
    if (raw) {
      try { parsed = JSON.parse(raw) } catch (e) {}
    }

    const text = parsed?.text || globalDragged?.text || plainText
    const id = parsed?.id || globalDragged?.id || ''
    if (!String(text).trim()) return null
    return { id, text: String(text) }
  }

  const clearDragGlobals = () => {
    try { window.__inkblot_draggedClipboardEntry = null } catch (e) {}
    try { window.__inkblot_draggedEditorSelection = null } catch (e) {}
    try { window.__inkblot_dragPoint = null } catch (e) {}
    try { window.__inkblot_dropHandled = false } catch (e) {}
  }

  const isPointInRect = (x, y, rect) => {
    if (!rect) return false
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
  }

  const getTargetEditorAtPoint = (x, y) => {
    if (x == null || y == null) return null

    const primaryRect = primaryPaneRef.current?.getBoundingClientRect?.()
    if (isEditorReady(editor) && isPointInRect(x, y, primaryRect)) return editor

    const secondaryRect = secondaryPaneRef.current?.getBoundingClientRect?.()
    if (splitView === 'editor' && isEditorReady(secondaryEditor) && isPointInRect(x, y, secondaryRect)) {
      return secondaryEditor
    }

    return null
  }

  // Move the target editor's selection under the drag point and position the
  // visual drop caret within the pane.
  const updateDropCaret = (targetEditor, event) => {
    const view = getMountedEditorView(targetEditor)
    if (!view) return
    const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
    if (!coords?.pos) return

    const nextSelection = TextSelection.create(view.state.doc, coords.pos)
    const samePos =
      view.state.selection.from === nextSelection.from &&
      view.state.selection.to === nextSelection.to

    if (!samePos) {
      view.dispatch(view.state.tr.setSelection(nextSelection))
    }

    const caretCoords = view.coordsAtPos(coords.pos)
    const paneEl =
      targetEditor === secondaryEditor ? secondaryPaneRef.current : primaryPaneRef.current
    const paneRect = paneEl?.getBoundingClientRect?.()
    if (!paneRect || !caretCoords) return

    setDragCaret({
      pane: targetEditor === secondaryEditor ? 'secondary' : 'primary',
      left: Math.max(0, caretCoords.left - paneRect.left),
      top: Math.max(0, caretCoords.top - paneRect.top),
      height: Math.max(18, caretCoords.bottom - caretCoords.top),
    })
  }

  const handlePaneDragStart = (event, targetEditor, source, docName) => {
    if (!isEditorReady(targetEditor)) return
    const { selection, doc } = targetEditor?.state || {}
    if (!selection || selection.empty) return

    const text = doc.textBetween(selection.from, selection.to, '\n')
    if (!text.trim()) return

    const payload = {
      from: selection.from,
      to: selection.to,
      text,
      source,
      docName: docName || '',
    }

    try { window.__inkblot_draggedEditorSelection = payload } catch (e) {}
    try { window.__inkblot_dropHandled = false } catch (e) {}
    try {
      event.dataTransfer?.setData('application/x-inkblot-editor-selection', JSON.stringify(payload))
      if (!event.dataTransfer?.getData('text/plain')) {
        event.dataTransfer?.setData('text/plain', text)
      }
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move'
      }
    } catch (e) {}
  }

  const handlePaneDragOver = (event, targetEditor) => {
    const payload = getDraggedClipboardPayload(event)
    if (!payload || !isEditorReady(targetEditor)) return
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move'
    }
    updateDropCaret(targetEditor, event)
  }

  const handlePaneDrop = (event, targetEditor) => {
    const payload = getDraggedClipboardPayload(event)
    if (!payload || !getMountedEditorView(targetEditor)) return

    event.preventDefault()
    event.stopPropagation()
    insertClipboardPayloadAtPoint(payload, targetEditor, event.clientX, event.clientY)
  }

  // Insert dragged clipboard text at the drop point and consume the entry.
  const insertClipboardPayloadAtPoint = (payload, targetEditor, x, y) => {
    const view = getMountedEditorView(targetEditor)
    if (!payload || !view) return false
    const coords = view.posAtCoords({ left: x, top: y })
    const insertPos = coords?.pos ?? view.state.selection.from
    const tr = view.state.tr.insertText(payload.text, insertPos, insertPos)
    view.dispatch(tr.scrollIntoView())
    view.focus()
    onMoveClipboardEntryToEditor?.(payload.id)
    try { window.__inkblot_dropHandled = true } catch (e) {}
    setDragCaret(null)
    return true
  }

  const [primaryWordStats, setPrimaryWordStats] = useState(emptyWordStats)
  const [secondaryWordStats, setSecondaryWordStats] = useState(emptyWordStats)
  const currentDocNotes = notesByDoc?.[currentDoc] ?? EMPTY_NOTES
  const secondaryDocNotes = notesByDoc?.[secondaryDoc] ?? EMPTY_NOTES
  const activeDocNotes = notesByDoc?.[activeDoc] ?? EMPTY_NOTES

  const getWordStats = useCallback((targetEditor, previousTotal = 0, includeTotal = true) => {
    if (!isEditorReady(targetEditor)) return emptyWordStats

    const { selection, doc } = targetEditor.state
    const selectedText = selection?.empty
      ? ''
      : doc.textBetween(selection.from, selection.to, '\n')

    return {
      total: includeTotal ? countWords(targetEditor.getText()) : previousTotal,
      selected: selection?.empty ? null : countWords(selectedText),
    }
  }, [])

  const formatWordStats = ({ total, selected }) => {
    const count = selected == null ? total : selected
    const wordLabel = count === 1 ? 'word' : 'words'
    return selected == null ? `${count} ${wordLabel}` : `${count} ${wordLabel} selected`
  }

  useEffect(() => {
    notesByDocRef.current = notesByDoc
  }, [notesByDoc])

  /* ---------------- Editors ---------------- */

  const editor = useEditor({
    extensions: buildEditorExtensions(
      StarterKit.configure({
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true },
      })
    ),
    content: '',
    editorProps: {
      handlePaste: createPasteHandler(),
    },
  })

  const secondaryEditor = useEditor({
    extensions: buildEditorExtensions(StarterKit),
    content: '',
    editorProps: {
      handlePaste: createPasteHandler(),
    },
  })

  // Tag drags that start inside an editor's DOM with the selection payload so
  // other drop targets (clipboard panel, opposite pane) know what is moving.
  useEffect(() => {
    const attachDragMeta = (instance, source, docName) => {
      const dom = getMountedEditorView(instance)?.dom
      if (!dom || !instance?.state) return () => {}

      const onDragStart = (event) => {
        const { selection, doc } = instance.state
        if (!selection || selection.empty) return

        const text = doc.textBetween(selection.from, selection.to, '\n')
        if (!text.trim()) return

        const payload = {
          from: selection.from,
          to: selection.to,
          text,
          source,
          docName: docName || '',
        }

        try { window.__inkblot_draggedEditorSelection = payload } catch (e) {}
        try {
          event.dataTransfer?.setData('application/x-inkblot-editor-selection', JSON.stringify(payload))
          event.dataTransfer?.setData('text/plain', text)
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move'
          }
        } catch (e) {}
      }

      dom.addEventListener('dragstart', onDragStart, true)
      return () => {
        dom.removeEventListener('dragstart', onDragStart, true)
      }
    }

    const offPrimary = attachDragMeta(editor, 'primary', currentDoc)
    const offSecondary = attachDragMeta(secondaryEditor, 'secondary', secondaryDoc)
    return () => {
      offPrimary()
      offSecondary()
    }
  }, [editor, secondaryEditor, currentDoc, secondaryDoc])

  useEffect(() => {
    const pane = primaryPaneRef.current
    if (!pane || !isEditorReady(editor)) return

    const onDragStart = (event) => handlePaneDragStart(event, editor, 'primary', currentDoc)
    const onDragOver = (event) => handlePaneDragOver(event, editor)
    const onDrop = (event) => handlePaneDrop(event, editor)

    pane.addEventListener('dragstart', onDragStart, true)
    pane.addEventListener('dragover', onDragOver, true)
    pane.addEventListener('drop', onDrop, true)

    return () => {
      pane.removeEventListener('dragstart', onDragStart, true)
      pane.removeEventListener('dragover', onDragOver, true)
      pane.removeEventListener('drop', onDrop, true)
    }
  // DnD helpers intentionally read the current editor globals at event time.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, currentDoc])

  useEffect(() => {
    const pane = secondaryPaneRef.current
    if (!pane || !isEditorReady(secondaryEditor) || splitView !== 'editor') return

    const onDragStart = (event) => handlePaneDragStart(event, secondaryEditor, 'secondary', secondaryDoc)
    const onDragOver = (event) => handlePaneDragOver(event, secondaryEditor)
    const onDrop = (event) => handlePaneDrop(event, secondaryEditor)

    pane.addEventListener('dragstart', onDragStart, true)
    pane.addEventListener('dragover', onDragOver, true)
    pane.addEventListener('drop', onDrop, true)

    return () => {
      pane.removeEventListener('dragstart', onDragStart, true)
      pane.removeEventListener('dragover', onDragOver, true)
      pane.removeEventListener('drop', onDrop, true)
    }
  // DnD helpers intentionally read the current editor globals at event time.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondaryEditor, secondaryDoc, splitView])

  useEffect(() => {
    const onWindowDragOver = (event) => {
      try { window.__inkblot_dragPoint = { x: event.clientX, y: event.clientY } } catch (e) {}
      const payload = getDraggedClipboardPayload(event)
      if (!payload) {
        setDragCaret(null)
        return
      }

      const targetEditor = getTargetEditorAtPoint(event.clientX, event.clientY)
      if (!targetEditor) {
        setDragCaret(null)
        return
      }

      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move'
      }
      updateDropCaret(targetEditor, event)
    }

    const onWindowDrag = (event) => {
      try { window.__inkblot_dragPoint = { x: event.clientX, y: event.clientY } } catch (e) {}
      const payload = window.__inkblot_draggedClipboardEntry || null
      if (!payload?.text) {
        setDragCaret(null)
        return
      }

      const targetEditor = getTargetEditorAtPoint(event.clientX, event.clientY)
      if (!targetEditor) {
        setDragCaret(null)
        return
      }

      updateDropCaret(targetEditor, event)
    }

    const onWindowDrop = (event) => {
      const payload = getDraggedClipboardPayload(event)
      if (!payload) return

      const targetEditor = getTargetEditorAtPoint(event.clientX, event.clientY)
      if (!targetEditor) return

      handlePaneDrop(event, targetEditor)
    }

    const onWindowDragEnd = (event) => {
      if (!window.__inkblot_dragPoint && (event?.clientX || event?.clientY)) {
        try { window.__inkblot_dragPoint = { x: event.clientX, y: event.clientY } } catch (e) {}
      }
      setDragCaret(null)
    }

    window.addEventListener('drag', onWindowDrag, true)
    window.addEventListener('dragover', onWindowDragOver, true)
    window.addEventListener('drop', onWindowDrop, true)
    window.addEventListener('dragend', onWindowDragEnd, true)

    return () => {
      window.removeEventListener('drag', onWindowDrag, true)
      window.removeEventListener('dragover', onWindowDragOver, true)
      window.removeEventListener('drop', onWindowDrop, true)
      window.removeEventListener('dragend', onWindowDragEnd, true)
    }
  // Window DnD listeners depend on stable DOM globals and active editor refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, secondaryEditor, splitView])

  useEffect(() => {
    const onClipboardDragEndDrop = (event) => {
      const detail = event?.detail || {}
      const point = {
        x: detail.x ?? window.__inkblot_dragPoint?.x ?? null,
        y: detail.y ?? window.__inkblot_dragPoint?.y ?? null,
      }
      const payload = {
        id: detail.id || '',
        text: detail.text || '',
      }

      if (window.__inkblot_dropHandled) {
        setDragCaret(null)
        clearDragGlobals()
        return
      }

      const targetEditor = getTargetEditorAtPoint(point.x, point.y)
      if (targetEditor && payload.text) {
        insertClipboardPayloadAtPoint(payload, targetEditor, point.x, point.y)
      }

      setDragCaret(null)
      clearDragGlobals()
    }

    window.addEventListener('inkblot:clipboard-dragend-drop', onClipboardDragEndDrop)
    return () => {
      window.removeEventListener('inkblot:clipboard-dragend-drop', onClipboardDragEndDrop)
    }
  // Clipboard drag completion reads the current drop globals at event time.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, secondaryEditor, splitView])

  /* ---------------- Expose Editor ---------------- */

  useEffect(() => {
    if (isEditorReady(editor)) setEditor(editor)
    return () => {
      setEditor(current => (current === editor ? null : current))
      setActiveEditor?.(current => (current === editor ? null : current))
    }
  }, [editor, setActiveEditor, setEditor])

  useEffect(() => {
    if (isEditorReady(secondaryEditor)) setSecondaryEditor?.(secondaryEditor)
    return () => {
      setSecondaryEditor?.(current => (current === secondaryEditor ? null : current))
      setActiveEditor?.(current => (current === secondaryEditor ? null : current))
    }
  }, [secondaryEditor, setActiveEditor, setSecondaryEditor])

  /* ---------------- Load Primary Doc ---------------- */

  useEffect(() => {
    if (!isEditorReady(editor) || !currentDoc) return
    // A canvas has no TipTap content — feeding its JSON to createDocument() would
    // throw. CanvasPane loads and saves it instead; this editor stays idle.
    if (isCanvasDoc(currentDoc)) return
    let cancelled = false
    const cacheKey = getDocCacheKey(projectName, currentDoc, 'primary')

    const load = async () => {
      isLoadingPrimaryRef.current = true
      loadedDocsRef.current.delete(cacheKey)

      try {
        const doc = await loadDocument(projectName, currentDoc)
        if (cancelled || !isEditorReady(editor)) return

        restoreEditorStateForDoc(editor, currentDoc, 'primary', doc)
        // Open an empty document ready to write in — caret placed and blinking,
        // no click needed. Asking the editor whether it is empty is the only
        // reliable test: a new document is stored as `content: []`, which is
        // neither missing nor a node with children, so shape checks miss it.
        if (editor.isEmpty) {
          editor.commands.focus('start')
        }
        setPrimaryWordStats(getWordStats(editor))

        // load versions for the right sidebar
        try {
          const vs = await getVersions(projectName, currentDoc)
          setVersions?.(currentDoc, vs)
        } catch (e) {
          console.error('Failed to load versions:', e)
          setVersions?.(currentDoc, [])
        }
      } finally {
        isLoadingPrimaryRef.current = false
      }
    }

    load()
    return () => {
      cancelled = true
      flushAutosave(primaryAutosaveRef)
      flushAutosave(primaryVersionCheckpointRef)
      stashEditorState(editor, currentDoc, 'primary')
    }
  }, [
    currentDoc,
    editor,
    flushAutosave,
    getWordStats,
    getDocCacheKey,
    projectName,
    restoreEditorStateForDoc,
    setVersions,
    stashEditorState,
  ])

  /* ---------------- Load Secondary Doc ---------------- */

  useEffect(() => {
    if (!isEditorReady(secondaryEditor) || splitView !== 'editor' || !secondaryDoc) return
    if (isCanvasDoc(secondaryDoc)) return
    let cancelled = false
    const cacheKey = getDocCacheKey(projectName, secondaryDoc, 'secondary')

    const load = async () => {
      isLoadingSecondaryRef.current = true
      loadedDocsRef.current.delete(cacheKey)

      try {
        const doc = await loadDocument(projectName, secondaryDoc)
        if (cancelled || !isEditorReady(secondaryEditor)) return

        restoreEditorStateForDoc(secondaryEditor, secondaryDoc, 'secondary', doc)
        setSecondaryWordStats(getWordStats(secondaryEditor))
      } finally {
        isLoadingSecondaryRef.current = false
      }
    }

    load()
    return () => {
      cancelled = true
      flushAutosave(secondaryAutosaveRef)
      stashEditorState(secondaryEditor, secondaryDoc, 'secondary')
    }
  }, [
    flushAutosave,
    getDocCacheKey,
    getWordStats,
    projectName,
    restoreEditorStateForDoc,
    secondaryDoc,
    secondaryEditor,
    splitView,
    stashEditorState,
  ])

  /* ---------------- Sync Notes → Editor Storage ---------------- */

  useEffect(() => {
    if (!isEditorReady(editor)) return
    syncEditorNotes(editor, currentDocNotes, currentDoc)
  }, [currentDoc, currentDocNotes, editor])

  useEffect(() => {
    if (!isEditorReady(secondaryEditor) || splitView !== 'editor') return
    syncEditorNotes(secondaryEditor, secondaryDocNotes, secondaryDoc)
  }, [secondaryDoc, secondaryDocNotes, secondaryEditor, splitView])

  const saveVersionCheckpoint = useCallback(async (targetEditor, docName, paneId) => {
    if (!isEditorReady(targetEditor) || !docName) return
    // Canvas checkpoints are written by useCanvasDocument, not this TipTap path.
    if (isCanvasDoc(docName)) return
    if (!loadedDocsRef.current.has(getDocCacheKey(projectName, docName, paneId))) return
    if (
      (paneId === 'primary' && isLoadingPrimaryRef.current) ||
      (paneId === 'secondary' && isLoadingSecondaryRef.current)
    ) {
      return
    }

    const contentJson = targetEditor.getJSON()
    const contentHtml = targetEditor.getHTML()

    await saveDocument(projectName, docName, {
      content: contentJson,
      notes: notesByDocRef.current?.[docName] || [],
      _appendVersion: true,
      _version: {
        contentHtml,
        contentJson,
      },
    })

    try {
      const vs = await getVersions(projectName, docName)
      setVersions?.(docName, vs)
    } catch (e) {
      console.error('Failed to refresh versions:', e)
    }
  }, [getDocCacheKey, projectName, setVersions])

  /* ---------------- Autosave ---------------- */

  useEffect(() => {
    if (!isEditorReady(editor) || !currentDoc) return
    if (isCanvasDoc(currentDoc)) return
    const handler = debounce(async () => {
      if (!isEditorReady(editor)) return
      if (isLoadingPrimaryRef.current) return
      if (!loadedDocsRef.current.has(getDocCacheKey(projectName, currentDoc, 'primary'))) return

      const contentJson = editor.getJSON()

      await saveDocument(projectName, currentDoc, {
        content: contentJson,
        notes: notesByDocRef.current?.[currentDoc] || [],
      })

    }, 800)

    const checkpointHandler = debounce(() => {
      void saveVersionCheckpoint(editor, currentDoc, 'primary')
    }, HISTORY_CHECKPOINT_DEBOUNCE_MS)

    const handleUpdate = () => {
      handler()
      checkpointHandler()
    }

    primaryAutosaveRef.current = handler
    primaryVersionCheckpointRef.current = checkpointHandler
    editor.on('update', handleUpdate)

    return () => {
      if (!editor.isDestroyed) editor.off('update', handleUpdate)
      handler.flush()
      handler.cancel()
      checkpointHandler.flush()
      checkpointHandler.cancel()
      if (primaryAutosaveRef.current === handler) {
        primaryAutosaveRef.current = null
      }
      if (primaryVersionCheckpointRef.current === checkpointHandler) {
        primaryVersionCheckpointRef.current = null
      }
    }
  }, [currentDoc, editor, getDocCacheKey, projectName, saveVersionCheckpoint])

  /* ---------------- Word Count ---------------- */

  useEffect(() => {
    if (!showWordCountBadge || !isEditorReady(editor)) return

    const updateSelectedCount = () => {
      if (!isEditorReady(editor)) return
      setPrimaryWordStats((current) => {
        const next = getWordStats(editor, current.total, false)
        return areWordStatsEqual(current, next) ? current : next
      })
    }

    const updateTotalCount = debounce(() => {
      if (!isEditorReady(editor)) return
      setPrimaryWordStats((current) => {
        const next = getWordStats(editor)
        return areWordStatsEqual(current, next) ? current : next
      })
    }, WORD_COUNT_DEBOUNCE_MS)

    editor.on('update', updateTotalCount)
    editor.on('selectionUpdate', updateSelectedCount)
    updateTotalCount()

    return () => {
      if (!editor.isDestroyed) {
        editor.off('update', updateTotalCount)
        editor.off('selectionUpdate', updateSelectedCount)
      }
      updateTotalCount.cancel()
    }
  }, [editor, getWordStats, showWordCountBadge])

  useEffect(() => {
    if (!isEditorReady(secondaryEditor) || splitView !== 'editor' || !secondaryDoc) return
    if (isCanvasDoc(secondaryDoc)) return

    const handler = debounce(async () => {
      if (!isEditorReady(secondaryEditor)) return
      if (isLoadingSecondaryRef.current) return
      if (!loadedDocsRef.current.has(getDocCacheKey(projectName, secondaryDoc, 'secondary'))) return

      await saveDocument(projectName, secondaryDoc, {
        content: secondaryEditor.getJSON(),
        notes: notesByDocRef.current?.[secondaryDoc] || [],
      })
    }, 800)

    const handleUpdate = () => {
      handler()
    }

    secondaryAutosaveRef.current = handler
    secondaryEditor.on('update', handleUpdate)

    return () => {
      if (!secondaryEditor.isDestroyed) secondaryEditor.off('update', handleUpdate)
      handler.flush()
      handler.cancel()
      if (secondaryAutosaveRef.current === handler) {
        secondaryAutosaveRef.current = null
      }
    }
  }, [getDocCacheKey, projectName, secondaryDoc, secondaryEditor, splitView])

  useEffect(() => {
    if (!showWordCountBadge || !isEditorReady(secondaryEditor) || splitView !== 'editor') return

    const updateSelectedCount = () => {
      if (!isEditorReady(secondaryEditor)) return
      setSecondaryWordStats((current) => {
        const next = getWordStats(secondaryEditor, current.total, false)
        return areWordStatsEqual(current, next) ? current : next
      })
    }

    const updateTotalCount = debounce(() => {
      if (!isEditorReady(secondaryEditor)) return
      setSecondaryWordStats((current) => {
        const next = getWordStats(secondaryEditor)
        return areWordStatsEqual(current, next) ? current : next
      })
    }, WORD_COUNT_DEBOUNCE_MS)

    secondaryEditor.on('update', updateTotalCount)
    secondaryEditor.on('selectionUpdate', updateSelectedCount)
    updateTotalCount()

    return () => {
      if (!secondaryEditor.isDestroyed) {
        secondaryEditor.off('update', updateTotalCount)
        secondaryEditor.off('selectionUpdate', updateSelectedCount)
      }
      updateTotalCount.cancel()
    }
  }, [getWordStats, secondaryEditor, showWordCountBadge, splitView])

  /* ---------------- Autosave Notes ---------------- */

  useEffect(() => {
    if (!activeDoc) return
    const activePaneId = activeDoc === secondaryDoc && activeDoc !== currentDoc ? 'secondary' : 'primary'
    if (!loadedDocsRef.current.has(getDocCacheKey(projectName, activeDoc, activePaneId))) return

    const getEditorForDoc = (docName) => {
      if (docName === currentDoc) return editor
      if (docName === secondaryDoc) return secondaryEditor
      return null
    }

    const targetEditor = getEditorForDoc(activeDoc)
    if (!isEditorReady(targetEditor)) return

    const handler = debounce(async () => {
      if (!isEditorReady(targetEditor)) return
      if (
        (activeDoc === currentDoc && isLoadingPrimaryRef.current) ||
        (activeDoc === secondaryDoc && isLoadingSecondaryRef.current)
      ) {
        return
      }

      const contentJson = targetEditor.getJSON()
      await saveDocument(projectName, activeDoc, {
        content: contentJson,
        notes: activeDocNotes,
      })
    }, 800)

    const checkpointHandler = debounce(() => {
      void saveVersionCheckpoint(targetEditor, activeDoc, activePaneId)
    }, HISTORY_CHECKPOINT_DEBOUNCE_MS)

    // Persist notes promptly; create a history snapshot only after a slower idle checkpoint.
    try { handler() } catch (e) {}
    try { checkpointHandler() } catch (e) {}

    return () => {
      handler.cancel()
      checkpointHandler.cancel()
    }
  }, [
    activeDoc,
    activeDocNotes,
    currentDoc,
    editor,
    getDocCacheKey,
    projectName,
    saveVersionCheckpoint,
    secondaryDoc,
    secondaryEditor,
  ])

  /* ---------------- Anchor Remapping ---------------- */

  // Keep quote-note positions in sync with edits: map each note's from/to
  // through every transaction and refresh its anchor text, dropping notes
  // whose range collapses to nothing.
  useEffect(() => {
    if (!isEditorReady(editor)) return

    const handler = ({ transaction }) => {
      if (!isEditorReady(editor)) return
      if (!transaction.docChanged) return
      if (isLoadingPrimaryRef.current) return

      const existingNotes = notesByDocRef.current?.[currentDoc] || []
      const hasQuoteNotes = existingNotes.some(note => note.type === 'quote')
      if (!hasQuoteNotes) return

      const mapping = transaction.mapping

      const updated = existingNotes
        .map(note => {
          if (note.type !== 'quote') return note

          const newFrom = mapping.map(note.from)
          const newTo = mapping.map(note.to)

          if (newFrom >= newTo) return null

          return {
            ...note,
            from: newFrom,
            to: newTo,
            anchor: editor.state.doc.textBetween(newFrom, newTo),
          }
        })
        .filter(Boolean)

      if (areNoteArraysEqual(existingNotes, updated)) {
        return
      }

      setNotesForDoc(currentDoc, updated)
    }

    editor.on('transaction', handler)
    return () => {
      if (!editor.isDestroyed) editor.off('transaction', handler)
    }

  }, [editor, currentDoc, setNotesForDoc])

  /* ---------------- Render ---------------- */

  const closeSecondary = () => {
    setSecondaryDoc?.(null)
    setSplitView?.(null)
  }

  const closePrimary = () => {
    if (secondaryDoc) {
      setCurrentDoc?.(secondaryDoc)
    }
    closeSecondary()
  }

  const focusEditor = (target) => {
    if (!isEditorReady(target)) return
    if (target.isEmpty) {
      target.commands.focus('start')
      return
    }
    target.chain().focus().run()
  }

  const activatePane = useCallback((docName, targetEditor) => {
    if (docName && activeDocRef.current !== docName) {
      activeDocRef.current = docName
      setActiveDoc(docName)
    }

    if (targetEditor && activeEditorRef.current !== targetEditor) {
      activeEditorRef.current = targetEditor
      setActiveEditor?.(targetEditor)
    }
  }, [setActiveDoc, setActiveEditor])

  // Double-clicking a document card on a canvas opens that document in the pane the
  // canvas is in — the card is a window onto the document, so following it swaps
  // what the pane shows, exactly as clicking the file tree would.
  const openDocs = useMemo(
    () => [currentDoc, secondaryDoc].filter(Boolean),
    [currentDoc, secondaryDoc]
  )

  const openDocFromCanvas = useCallback((pane, docPath) => {
    if (!docPath) return
    if (pane === 'secondary') setSecondaryDoc?.(docPath)
    else setCurrentDoc?.(docPath)
    activatePane(docPath, null)
  }, [activatePane, setCurrentDoc, setSecondaryDoc])

  const liveEditor = isEditorReady(editor) ? editor : null
  const liveSecondaryEditor = isEditorReady(secondaryEditor) ? secondaryEditor : null
  const liveActiveEditor = isEditorReady(activeEditor) ? activeEditor : null
  const focusModeEditor = liveActiveEditor || liveEditor || liveSecondaryEditor

  // A canvas pane renders CanvasPane instead of an EditorContent. The two TipTap
  // editors above still exist (hooks can't be conditional) — they just sit idle,
  // holding no document, and must never be handed to the canvas pane.
  const primaryIsCanvas = isCanvasDoc(currentDoc)
  const secondaryIsCanvas = isCanvasDoc(secondaryDoc)

  if (!hasActiveDoc) {
    return (
      <div className="middle-section">
        <div className="empty-state">
          <div className="empty-state-content">
            {projectName ? 'Create a new document to begin.' : 'Select a project to begin.'}
            {projectName && (
              <button
                className="empty-state-action"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent('filetree:new-entry', {
                      detail: { type: 'file', parent: '' },
                    })
                  )
                }}
                aria-label="Create new document"
                title="Create new document"
              >
                <SFIcon name="plus" />
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // A comparison hides the panes and takes the container for itself, so the split
  // grid must stand down while it is up — otherwise the compare pane would be laid
  // into the primary pane's track instead of the full width. The split is only
  // suspended, not closed: it comes back exactly as it was when compare closes.
  const comparing = Boolean(
    compare && (compare.docName === currentDoc || compare.docName === secondaryDoc)
  )

  const splitClassName = `${comparing ? ' is-comparing' : ''}${
    splitView && !comparing
      ? ` split-active${splitOrientation === 'rows' ? ' split-rows' : ''}${isResizingSplit ? ' is-split-resizing' : ''}`
      : ''
  }`
  const showDraftPane = draftTabActive && !currentDoc
  const primaryPaneOwnsFocus = primaryIsCanvas || showDraftPane

  // The divider is a track in the split grid, so the two panes are sized by the
  // ratio and the gutter never has to be accounted for twice.
  const splitStyle = splitView === 'editor' && !comparing
    ? (splitOrientation === 'rows'
      ? {
        gridTemplateColumns: '1fr',
        gridTemplateRows: `${splitRatio}fr var(--split-gutter) ${1 - splitRatio}fr`,
      }
      : {
        gridTemplateColumns: `${splitRatio}fr var(--split-gutter) ${1 - splitRatio}fr`,
        gridTemplateRows: '1fr',
      })
    : undefined

  const compareEditor = compare?.docName === secondaryDoc && compare?.docName !== currentDoc
    ? liveSecondaryEditor
    : liveEditor

  const startSplitResize = (event) => {
    if (event.button !== 0) return
    event.preventDefault()

    const container = splitContainerRef.current
    if (!container) return

    setIsResizingSplit(true)

    const onMove = (moveEvent) => {
      const rect = container.getBoundingClientRect()
      const ratio = splitOrientation === 'rows'
        ? (moveEvent.clientY - rect.top) / rect.height
        : (moveEvent.clientX - rect.left) / rect.width
      // Editor owns the clamp, so the ratio can never strand a pane off screen.
      setSplitRatio?.(ratio)
    }

    const onUp = () => {
      setIsResizingSplit(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="middle-section">
      <div ref={splitContainerRef} className={`editor-container${splitClassName}`} style={splitStyle}>

        <div
          ref={primaryPaneRef}
          className="pane primary-pane"
          // A canvas owns its own wheel/pointer handling and stops propagation, so
          // it activates its pane itself rather than through these editor handlers.
          // A draft pane has no document either, and its form must keep focus —
          // handing it to the idle editor would steal the caret out of the name box.
          onFocus={primaryPaneOwnsFocus ? undefined : () => activatePane(currentDoc, liveEditor)}
          onMouseEnter={primaryPaneOwnsFocus ? undefined : () => activatePane(currentDoc, liveEditor)}
          onWheel={primaryPaneOwnsFocus ? undefined : () => activatePane(currentDoc, liveEditor)}
          onMouseDown={primaryPaneOwnsFocus ? undefined : () => focusEditor(liveEditor)}
          onClick={primaryPaneOwnsFocus ? undefined : () => focusEditor(liveEditor)}
          onMouseMove={primaryPaneOwnsFocus ? undefined : () => activatePane(currentDoc, liveEditor)}
        >
          {dragCaret?.pane === 'primary' ? (
            <div
              className="drag-drop-caret"
              style={{
                left: `${dragCaret.left}px`,
                top: `${dragCaret.top}px`,
                height: `${dragCaret.height}px`,
              }}
            />
          ) : null}
          {showDraftPane ? (
            <DraftTabPane
              projectName={projectName}
              onCreated={onDraftCreated}
              refreshFiles={refreshFiles}
            />
          ) : primaryIsCanvas ? (
            <CanvasPane
              projectName={projectName}
              docPath={currentDoc}
              setActiveEditor={setActiveEditor}
              onActivate={() => activatePane(currentDoc, null)}
              onOpenDoc={(docPath) => openDocFromCanvas('primary', docPath)}
              notesByDoc={notesByDoc}
              setNotesForDoc={setNotesForDoc}
              openDocs={openDocs}
              showHeader={splitView === 'editor'}
              onClose={closePrimary}
              isActive={activeDoc === currentDoc}
            />
          ) : (
            <div className="pane-scroll">
              {splitView === 'editor' && (
                <div className="pane-header pane-header-centered">
                  <span>{currentDoc}</span>
                  <button onClick={closePrimary}>×</button>
                </div>
              )}
              {liveEditor ? <EditorContent editor={liveEditor} className="editor" /> : null}
            </div>
          )}
          {showWordCountBadge && !primaryIsCanvas && !showDraftPane ? (
            <div className="word-count">{formatWordStats(primaryWordStats)}</div>
          ) : null}
        </div>

        {splitView === 'editor' && (
          <div
            className="split-resizer"
            role="separator"
            aria-orientation={splitOrientation === 'rows' ? 'horizontal' : 'vertical'}
            aria-label="Resize split"
            title="Drag to resize · double-click to even out"
            onMouseDown={startSplitResize}
            onDoubleClick={() => setSplitRatio?.(0.5)}
          >
            <span className="split-resizer-grip" />
          </div>
        )}

        {splitView === 'editor' && (
          <div
            ref={secondaryPaneRef}
            className="pane secondary-pane"
            onFocus={secondaryIsCanvas ? undefined : () => activatePane(secondaryDoc, liveSecondaryEditor)}
            onMouseEnter={secondaryIsCanvas ? undefined : () => activatePane(secondaryDoc, liveSecondaryEditor)}
            onWheel={secondaryIsCanvas ? undefined : () => activatePane(secondaryDoc, liveSecondaryEditor)}
            onMouseDown={secondaryIsCanvas ? undefined : () => focusEditor(liveSecondaryEditor)}
            onClick={secondaryIsCanvas ? undefined : () => focusEditor(liveSecondaryEditor)}
            onMouseMove={secondaryIsCanvas ? undefined : () => activatePane(secondaryDoc, liveSecondaryEditor)}
          >
            {dragCaret?.pane === 'secondary' ? (
              <div
                className="drag-drop-caret"
                style={{
                  left: `${dragCaret.left}px`,
                  top: `${dragCaret.top}px`,
                  height: `${dragCaret.height}px`,
                }}
              />
            ) : null}
            {secondaryIsCanvas ? (
              <CanvasPane
                projectName={projectName}
                docPath={secondaryDoc}
                setActiveEditor={setActiveEditor}
                onActivate={() => activatePane(secondaryDoc, null)}
                onOpenDoc={(docPath) => openDocFromCanvas('secondary', docPath)}
                notesByDoc={notesByDoc}
                setNotesForDoc={setNotesForDoc}
                openDocs={openDocs}
                showHeader
                onClose={closeSecondary}
                isActive={activeDoc === secondaryDoc}
              />
            ) : (
              <div className="pane-scroll">
                <div className="pane-header split-header pane-header-centered">
                  <span>{secondaryDoc}</span>
                  <button onClick={closeSecondary}>×</button>
                </div>
                {liveSecondaryEditor ? <EditorContent editor={liveSecondaryEditor} className="editor" /> : null}
              </div>
            )}
            {showWordCountBadge && !secondaryIsCanvas ? (
              <div className="word-count">{formatWordStats(secondaryWordStats)}</div>
            ) : null}
          </div>
        )}
        {comparing ? (
          <VersionComparePane
            projectName={projectName}
            docName={compare.docName}
            editor={compareEditor}
            initialLeftId={compare.leftId}
            initialRightId={compare.rightId}
            onClose={closeCompare}
            refreshFiles={refreshFiles}
            onOpenDocInTab={onOpenDocInTab}
            setVersions={setVersions}
          />
        ) : null}

        {/* Focus Mode is a prose surface — it has nothing to show for a canvas or a draft. */}
        {focusModeOpen && !showDraftPane && !isCanvasDoc(activeDoc || currentDoc) ? (
          <FocusModeOverlay
            editor={focusModeEditor}
            onExit={onExitFocusMode}
          />
        ) : null}
      </div>
    </div>
  )
}
