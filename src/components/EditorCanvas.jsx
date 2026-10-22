/**
 * EditorCanvas.jsx — the writing surface.
 *
 * Creates the primary and secondary TipTap editors (secondary appears in split
 * view), lays the panes out, and hosts the split-view divider, the drop caret, the
 * draft pane, the canvas pane, the version-compare pane and the Focus Mode overlay.
 *
 * What a pane *does* with a document lives in six hooks in src/hooks, each one
 * a path where a bug is silent rather than loud:
 *
 *   useEditorDocCache    what each pane is holding, and whether it is mid-swap
 *   useEditorDocLoader   reading a document in, and flushing the last one out
 *   useEditorAutosave    debounced saves and slower version-history checkpoints
 *   useEditorWordCount   the per-pane word-count badge
 *   useEditorNotes       note storage, and remapping quote anchors across edits
 *   useEditorDnd         pasting, and dragging text between panes
 *
 * tests/unit/editor.mjs mounts this component and exercises all of them.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'

import { EditorTarget } from '../types'
import { documentSurface, dragHandoff, DragPayloadKind, editorRegistry, useRegisterEditor } from '../bridge'
import { readAnchor } from '../bridge/anchors'
import { canvasDelegates } from '../bridge/canvasDelegates'
import { mapDelegates } from '../bridge/mapDelegates'
import { useSurfacePublisher } from '../bridge/useSurfacePublisher'
import { buildEditorExtensions } from '../lib/editorExtensions'
import { setClipboardDropTarget } from '../lib/clipboardDropTarget'
import { isEditorReady } from '../lib/editorUtils'
import { getDocKind, isTextDoc } from '../lib/docKind'
import CanvasPane from '../canvas/CanvasPane'
import TimelinePane from '../timeline/TimelinePane'
import TimeLensBar from '../timeline/TimeLensBar'
import { createTimelineDelegates } from '../timeline/timelineDelegates'
import { getStoryCursor, subscribeStoryCursor } from '../lib/timeline/storyCursor'
import { useEditorAutosave } from '../hooks/useEditorAutosave'
import { useEditorDnd } from '../hooks/useEditorDnd'
import { useEditorDocCache } from '../hooks/useEditorDocCache'
import { useEditorDocLoader } from '../hooks/useEditorDocLoader'
import { useEditorNotes } from '../hooks/useEditorNotes'
import { useEditorTimeline } from '../hooks/useEditorTimeline'
import { formatWordStats, useEditorWordCount } from '../hooks/useEditorWordCount'
import DraftTabPane from './DraftTabPane'
import FocusModeOverlay from './FocusModeOverlay'
import VersionComparePane from './VersionComparePane'
import Icon from '../ui/Icon.jsx'
import DocumentTabBar from './tabs/DocumentTabBar'
import { useShowsTabBar } from './tabs/tabBarState'
import PaneEditorSurface from '../print/PaneEditorSurface'
import DocLockBadge from './DocLockBadge'
import TableToolbar from './TableToolbar'
import { lockReason, useLocks } from '../lib/docLocks'
import { setEditorLock } from '../extensions/DocumentLock'
import { FadeScrim } from '../ui/Surfaces.jsx'

// A map is a heavy editor (and its globe and space views heavier still): loaded the
// first time one opens, never for a writer who only writes.
const LazyMapPane = lazy(() => import('../map/MapPane'))
function MapPane(props) {
  return (
    <Suspense fallback={<div className="map-surface is-loading" />}>
      <LazyMapPane {...props} />
    </Suspense>
  )
}

const EMPTY_NOTES = []

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
  const tabBarShown = useShowsTabBar()
  const [dragCaret, setDragCaret] = useState(null)
  // The pane's live view of notesByDoc. The hooks below run from editor events and
  // debounced timers, so they must read the notes as they are when the save fires,
  // not as they were when the effect was set up.
  const notesByDocRef = useRef(notesByDoc)
  const activeDocRef = useRef(activeDoc)
  const activeEditorRef = useRef(activeEditor)

  useEffect(() => {
    notesByDocRef.current = notesByDoc
  }, [notesByDoc])

  const getNotesForDoc = useCallback((docName) => (
    notesByDocRef.current?.[docName] || []
  ), [])

  // Whether the doc has an entry at all, which is not the same as having notes: an
  // absent key means "never opened", and only then are the stored notes seeded in.
  const hasNotesForDoc = useCallback((docName) => (
    Object.prototype.hasOwnProperty.call(notesByDocRef.current || {}, docName)
  ), [])

  useEffect(() => {
    activeDocRef.current = activeDoc
  }, [activeDoc])

  useEffect(() => {
    activeEditorRef.current = activeEditor
  }, [activeEditor])

  const docCache = useEditorDocCache({ hasNotesForDoc, projectName, setNotesForDoc })

  const getMountedEditorView = (instance) => {
    if (!isEditorReady(instance)) return null
    const view = instance.editorView || instance.view
    if (!view || view.isDestroyed) return null
    return view
  }

  // Paste interception: images become image nodes, Pinterest board URLs become
  // embedded boards, and a globally-requested plain paste inserts raw text.
  // Everything else falls through to TipTap's default handling.
  const {
    createPasteHandler,
    getDraggedClipboardPayload,
    getTargetEditorAtPoint,
    updateDropCaret,
    handlePaneDragStart,
    handlePaneDragOver,
    handlePaneDrop,
    hoverClipboardAt,
    previewClipboardAt,
    dropClipboardAt,
    clearClipboardDrag,
  } = useEditorDnd({
    // Accessors, not values: this hook runs before `editor` and `secondaryEditor`
    // are declared below — `editor` supplies useEditor's paste handler, so the
    // order cannot be swapped — and passing the bindings directly reads them in
    // their temporal dead zone, which throws on every mount. Both are only ever
    // needed at event time, by which point the declarations have run.
    getEditor: () => editor,
    getMountedEditorView,
    getSecondaryEditor: () => secondaryEditor,
    onMoveClipboardEntryToEditor,
    primaryPaneRef,
    secondaryPaneRef,
    setDragCaret,
    splitView,
  })

  const currentDocNotes = notesByDoc?.[currentDoc] ?? EMPTY_NOTES
  const secondaryDocNotes = notesByDoc?.[secondaryDoc] ?? EMPTY_NOTES
  const activeDocNotes = notesByDoc?.[activeDoc] ?? EMPTY_NOTES

  /* ---------------- Editors ---------------- */

  // Built once. useEditor compares these options by identity on every render, and a
  // fresh extension array or editorProps object made it call setOptions — handing both
  // editors new props and recomputing every decoration and plugin view — each time
  // this component rendered, which is on every word-count tick and note change.
  const [primaryOptions] = useState(() => ({
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
  }))
  const [secondaryOptions] = useState(() => ({
    extensions: buildEditorExtensions(StarterKit),
    content: '',
    editorProps: {
      handlePaste: createPasteHandler(),
    },
  }))

  const editor = useEditor(primaryOptions)

  const secondaryEditor = useEditor(secondaryOptions)

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

        dragHandoff.begin({
          kind: DragPayloadKind.EditorSelection,
          text,
          docPath: docName || null,
          anchor: readAnchor(instance, selection.from, selection.to),
          detail: { source },
        })
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
      dragHandoff.moveTo(event.clientX, event.clientY)
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
      dragHandoff.moveTo(event.clientX, event.clientY)
      const session = dragHandoff.current()
      const payload = session?.kind === DragPayloadKind.ClipboardEntry ? session : null
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
      if (!dragHandoff.point() && (event?.clientX || event?.clientY)) {
        dragHandoff.moveTo(event.clientX, event.clientY)
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

  // The panes are where a clipboard piece dragged from the panel lands
  // (lib/clipboardDropTarget). The handlers read the live editors at event time.
  useEffect(() => setClipboardDropTarget({
    hover: hoverClipboardAt,
    preview: previewClipboardAt,
    clear: clearClipboardDrag,
    drop: dropClipboardAt,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [editor, secondaryEditor, splitView])

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

  /* ---------------- The bridge ---------------- */

  // Follows the election and publishes toolbar state and selection context for
  // whichever editor is active.
  useSurfacePublisher()

  /* ---------------- Expose Editor, to the bridge ---------------- */

  // The same two editors, under the names the protocol uses. A pane keeps its TipTap
  // instance across document swaps, so both of these are registered once and answer
  // for whatever the pane is showing — which is why they are accessors and not values.
  useRegisterEditor(EditorTarget.Primary, {
    getEditor: () => editor,
    getDocPath: () => currentDoc || null,
  })
  useRegisterEditor(EditorTarget.Secondary, {
    getEditor: () => secondaryEditor,
    getDocPath: () => secondaryDoc || null,
  })

  /* ---------------- Documents, saving, counting, notes ---------------- */

  // Order matters: the cache is the bookkeeping the other three read; autosave
  // publishes the flush handles the loader calls on its way out of a document; the
  // loader is what tells the word-count badge a pane has changed underneath it.
  const { flushPane } = useEditorAutosave({
    activeDoc,
    activeDocNotes,
    currentDoc,
    docCache,
    editor,
    getNotesForDoc,
    projectName,
    secondaryDoc,
    secondaryEditor,
    setVersions,
    splitView,
  })

  const { primaryWordStats, secondaryWordStats, syncWordStats } = useEditorWordCount({
    editor,
    secondaryEditor,
    showWordCountBadge,
    splitView,
  })

  useEditorDocLoader({
    currentDoc,
    docCache,
    editor,
    flushPane,
    onPaneLoaded: syncWordStats,
    projectName,
    secondaryDoc,
    secondaryEditor,
    setVersions,
    splitView,
  })

  useEditorNotes({
    currentDoc,
    currentDocNotes,
    docCache,
    editor,
    getNotesForDoc,
    secondaryDoc,
    secondaryDocNotes,
    secondaryEditor,
    setNotesForDoc,
    splitView,
  })

  // Passages attached to timeline events: drawn from the chronology, saved with the text.
  useEditorTimeline({
    projectName,
    currentDoc,
    editor,
    secondaryDoc,
    secondaryEditor,
    splitView,
    docCache,
  })

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

  const activatePane = useCallback((docName, targetEditor, target) => {
    if (docName && activeDocRef.current !== docName) {
      activeDocRef.current = docName
      setActiveDoc(docName)
    }

    if (targetEditor && activeEditorRef.current !== targetEditor) {
      activeEditorRef.current = targetEditor
      setActiveEditor?.(targetEditor)
    }

    // The election result, as a name. This is the half that survives a process
    // boundary — `setActiveEditor` above hands out a live object, which does not.
    if (target) editorRegistry.setActive(target)
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

  // A timeline opens what it links to beside itself, so it stays in view: in the other
  // pane of a split, or in a split it opens.
  const openDocBesideTimeline = useCallback((timelinePane, docPath) => {
    if (!docPath) return
    if (splitView !== 'editor') setSplitView?.('editor')
    openDocFromCanvas(timelinePane === 'primary' ? 'secondary' : 'primary', docPath)
  }, [openDocFromCanvas, setSplitView, splitView])

  // The commands the surface cannot serve alone. The canvas ones need nothing from
  // React — they resolve a surface id and dispatch what the canvas already listens
  // for — so they are a module. `openDocument` needs app state, and is the same swap
  // a canvas card's double-click makes, so it is that callback. Declared here, after
  // `openDocFromCanvas`, because a dependency array is read during render and this
  // file has already shipped one crash from reading a binding in its temporal dead zone.
  useEffect(() => {
    documentSurface.setDelegates({
      ...canvasDelegates,
      ...mapDelegates,
      ...createTimelineDelegates({ projectName, openDoc: (path) => openDocFromCanvas('primary', path) }),
      openDocument: ({ path, pane }) => openDocFromCanvas(pane, path),
    })
  }, [openDocFromCanvas, projectName])

  // The time lens's switches, for a shell's menus to tick.
  useEffect(() => {
    if (!projectName) return undefined
    const publish = (cursor) => documentSurface.publishTimelineCursor({
      lensOn: Boolean(cursor.lens.on),
      lensEditing: Boolean(cursor.lens.editing),
      editingRanges: Boolean(cursor.editingRanges),
    })
    publish(getStoryCursor(projectName))
    return subscribeStoryCursor(projectName, publish)
  }, [projectName])

  const liveEditor = isEditorReady(editor) ? editor : null
  const liveSecondaryEditor = isEditorReady(secondaryEditor) ? secondaryEditor : null

  // A locked document's text is frozen (docLocks.ts); each editor is told what it holds.
  const locks = useLocks()
  const primaryLocked = isTextDoc(currentDoc) && lockReason(currentDoc, locks) !== null
  const secondaryLocked = isTextDoc(secondaryDoc) && lockReason(secondaryDoc, locks) !== null
  useEffect(() => {
    setEditorLock(liveEditor, currentDoc, primaryLocked)
  }, [currentDoc, liveEditor, primaryLocked])
  useEffect(() => {
    setEditorLock(liveSecondaryEditor, secondaryDoc, secondaryLocked)
  }, [liveSecondaryEditor, secondaryDoc, secondaryLocked])
  const liveActiveEditor = isEditorReady(activeEditor) ? activeEditor : null
  const focusModeEditor = liveActiveEditor || liveEditor || liveSecondaryEditor

  // A canvas or map pane renders its own surface instead of an EditorContent. The two
  // TipTap editors above still exist (hooks can't be conditional) — they just sit
  // idle, holding no document, and must never be handed to such a pane.
  const primaryKind = getDocKind(currentDoc)
  const secondaryKind = getDocKind(secondaryDoc)
  const primaryIsCanvas = primaryKind === 'canvas'
  const secondaryIsCanvas = secondaryKind === 'canvas'
  const primaryIsStructured = primaryKind !== 'text'
  const secondaryIsStructured = secondaryKind !== 'text'

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
                <Icon name="add" />
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
  // A split pane names its document above it, with a × to close it — unless the shell
  // draws the tabs, whose split tab names both documents, the first pane's first.
  const paneHeaders = splitView === 'editor' && !tabBarShown
  const primaryPaneOwnsFocus = primaryIsStructured || showDraftPane

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
      <DocumentTabBar activeDoc={currentDoc} />
      <div ref={splitContainerRef} className={`editor-container${splitClassName}`} style={splitStyle}>

        <div
          ref={primaryPaneRef}
          className="pane primary-pane"
          data-locked={primaryLocked}
          // A canvas owns its own wheel/pointer handling and stops propagation, so
          // it activates its pane itself rather than through these editor handlers.
          // A draft pane has no document either, and its form must keep focus —
          // handing it to the idle editor would steal the caret out of the name box.
          onFocus={primaryPaneOwnsFocus ? undefined : () => activatePane(currentDoc, liveEditor, EditorTarget.Primary)}
          onMouseEnter={primaryPaneOwnsFocus ? undefined : () => activatePane(currentDoc, liveEditor, EditorTarget.Primary)}
          onWheel={primaryPaneOwnsFocus ? undefined : () => activatePane(currentDoc, liveEditor, EditorTarget.Primary)}
          onMouseDown={primaryPaneOwnsFocus ? undefined : () => focusEditor(liveEditor)}
          onClick={primaryPaneOwnsFocus ? undefined : () => focusEditor(liveEditor)}
          onMouseMove={primaryPaneOwnsFocus ? undefined : () => activatePane(currentDoc, liveEditor, EditorTarget.Primary)}
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
              showHeader={paneHeaders}
              onClose={closePrimary}
              isActive={activeDoc === currentDoc}
            />
          ) : primaryKind === 'map' ? (
            <MapPane
              projectName={projectName}
              docPath={currentDoc}
              setActiveEditor={setActiveEditor}
              onActivate={() => activatePane(currentDoc, null)}
              onOpenDoc={(docPath) => openDocFromCanvas('primary', docPath)}
              showHeader={paneHeaders}
              onClose={closePrimary}
              isActive={activeDoc === currentDoc}
              // Its inspector panel stays while the other pane is worked in — unless
              // that is a map too, whose panel it then is.
              chromeWhileInactive={secondaryKind !== 'map'}
            />
          ) : primaryKind === 'timeline' ? (
            <TimelinePane
              projectName={projectName}
              docPath={currentDoc}
              onActivate={() => activatePane(currentDoc, null)}
              onOpenDoc={(docPath) => openDocBesideTimeline('primary', docPath)}
              showHeader={paneHeaders}
              onClose={closePrimary}
              isActive={activeDoc === currentDoc}
            />
          ) : (
            <PaneEditorSurface
              editor={liveEditor}
              projectName={projectName}
              docPath={currentDoc}
              onOpenDoc={(path) => openDocFromCanvas('primary', path)}
              header={(
                <>
                  {paneHeaders ? (
                    <div className="pane-header pane-header-centered">
                      <span>{currentDoc}</span>
                      <button onClick={closePrimary}>×</button>
                    </div>
                  ) : null}
                  <TimeLensBar projectName={projectName} />
                </>
              )}
            />
          )}
          {!primaryIsStructured && !showDraftPane ? <FadeScrim edge="bottom" height={56} className="pane-bottom-scrim" /> : null}
          {!primaryIsStructured && !showDraftPane ? (
            <div className="pane-status" data-pane="primary" data-doc={currentDoc} data-project={projectName}>
              {showWordCountBadge ? <div className="word-count floating-capsule">{formatWordStats(primaryWordStats)}</div> : null}
              <DocLockBadge projectName={projectName} docPath={currentDoc} />
            </div>
          ) : null}
          {!primaryIsStructured && !showDraftPane ? (
            <TableToolbar editor={liveEditor} />
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
            data-locked={secondaryLocked}
            onFocus={secondaryIsStructured ? undefined : () => activatePane(secondaryDoc, liveSecondaryEditor, EditorTarget.Secondary)}
            onMouseEnter={secondaryIsStructured ? undefined : () => activatePane(secondaryDoc, liveSecondaryEditor, EditorTarget.Secondary)}
            onWheel={secondaryIsStructured ? undefined : () => activatePane(secondaryDoc, liveSecondaryEditor, EditorTarget.Secondary)}
            onMouseDown={secondaryIsStructured ? undefined : () => focusEditor(liveSecondaryEditor)}
            onClick={secondaryIsStructured ? undefined : () => focusEditor(liveSecondaryEditor)}
            onMouseMove={secondaryIsStructured ? undefined : () => activatePane(secondaryDoc, liveSecondaryEditor, EditorTarget.Secondary)}
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
                showHeader={paneHeaders}
                onClose={closeSecondary}
                isActive={activeDoc === secondaryDoc}
              />
            ) : secondaryKind === 'map' ? (
              <MapPane
                projectName={projectName}
                docPath={secondaryDoc}
                setActiveEditor={setActiveEditor}
                onActivate={() => activatePane(secondaryDoc, null)}
                onOpenDoc={(docPath) => openDocFromCanvas('secondary', docPath)}
                showHeader={paneHeaders}
                onClose={closeSecondary}
                isActive={activeDoc === secondaryDoc}
                chromeWhileInactive={primaryKind !== 'map'}
              />
            ) : secondaryKind === 'timeline' ? (
              <TimelinePane
                projectName={projectName}
                docPath={secondaryDoc}
                onActivate={() => activatePane(secondaryDoc, null)}
                onOpenDoc={(docPath) => openDocBesideTimeline('secondary', docPath)}
                showHeader={paneHeaders}
                onClose={closeSecondary}
                isActive={activeDoc === secondaryDoc}
              />
            ) : (
              <PaneEditorSurface
                editor={liveSecondaryEditor}
                projectName={projectName}
                docPath={secondaryDoc}
                onOpenDoc={(path) => openDocFromCanvas('secondary', path)}
                header={(
                  <>
                    {paneHeaders ? (
                      <div className="pane-header split-header pane-header-centered">
                        <span>{secondaryDoc}</span>
                        <button onClick={closeSecondary}>×</button>
                      </div>
                    ) : null}
                    <TimeLensBar projectName={projectName} />
                  </>
                )}
              />
            )}
            {!secondaryIsStructured ? <FadeScrim edge="bottom" height={56} className="pane-bottom-scrim" /> : null}
            {!secondaryIsStructured ? (
              <div className="pane-status" data-pane="secondary" data-doc={secondaryDoc} data-project={projectName}>
                {showWordCountBadge ? <div className="word-count floating-capsule">{formatWordStats(secondaryWordStats)}</div> : null}
                <DocLockBadge projectName={projectName} docPath={secondaryDoc} />
              </div>
            ) : null}
            {!secondaryIsStructured ? (
              <TableToolbar editor={liveSecondaryEditor} />
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

        {/* Focus Mode is a prose surface — it has nothing to show for a canvas, a map or a draft. */}
        {focusModeOpen && !showDraftPane && isTextDoc(activeDoc || currentDoc) ? (
          <FocusModeOverlay
            editor={focusModeEditor}
            onExit={onExitFocusMode}
          />
        ) : null}
      </div>
    </div>
  )
}
