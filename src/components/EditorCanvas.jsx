/**
 * EditorCanvas.jsx — the writing surface.
 *
 * Creates the primary and secondary TipTap editors (secondary appears in split
 * view), lays the panes out, and hosts the split-view divider, the drop caret, the
 * draft pane, the canvas pane, the version-compare pane and the Focus Mode overlay.
 *
 * What a pane *does* with a document lives in five hooks beside this file, each one
 * a path where a bug is silent rather than loud:
 *
 *   useEditorDocCache    what each pane is holding, and whether it is mid-swap
 *   useEditorDocLoader   reading a document in, and flushing the last one out
 *   useEditorAutosave    debounced saves and slower version-history checkpoints
 *   useEditorWordCount   the per-pane word-count badge
 *   useEditorNotes       note storage, and remapping quote anchors across edits
 *   useEditorDnd         pasting, and dragging text between panes
 *
 * scripts/canvas-tests/editor.mjs mounts this component and exercises all of them.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'

import { EditorTarget } from '../types'
import { documentSurface, dragHandoff, DragPayloadKind, editorRegistry, useRegisterEditor } from '../bridge'
import { readAnchor } from '../bridge/anchors'
import { canvasDelegates } from '../bridge/canvasDelegates'
import { useSurfacePublisher } from '../bridge/useSurfacePublisher'
import { buildEditorExtensions } from '../lib/editorExtensions'
import { isEditorReady } from '../lib/editorUtils'
import { getDocKind, isTextDoc } from '../lib/docKind'
import CanvasPane from '../canvas/CanvasPane'
import MapPane from '../map/MapPane'
import { useEditorAutosave } from './useEditorAutosave'
import { useEditorDnd } from './useEditorDnd'
import { useEditorDocCache } from './useEditorDocCache'
import { useEditorDocLoader } from './useEditorDocLoader'
import { useEditorNotes } from './useEditorNotes'
import { formatWordStats, useEditorWordCount } from './useEditorWordCount'
import DraftTabPane from './DraftTabPane'
import FocusModeOverlay from './FocusModeOverlay'
import VersionComparePane from './VersionComparePane'
import SFIcon from './SFIcon'
import PaneEditorSurface from '../print/PaneEditorSurface'

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
    clearDragGlobals,
    getTargetEditorAtPoint,
    updateDropCaret,
    handlePaneDragStart,
    handlePaneDragOver,
    handlePaneDrop,
    insertClipboardPayloadAtPoint,
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

  useEffect(() => {
    const onClipboardDragEndDrop = (event) => {
      const detail = event?.detail || {}
      const held = dragHandoff.point()
      const point = { x: detail.x ?? held?.x ?? null, y: detail.y ?? held?.y ?? null }
      const payload = {
        id: detail.id || '',
        text: detail.text || '',
      }

      // Somebody already took this drop — the clipboard panel, most likely, since it
      // is the other end of this same drag.
      if (dragHandoff.isClaimed()) {
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

  /* ---------------- The bridge ---------------- */

  // Follows the election and publishes toolbar state and selection context for
  // whichever editor is active. This is the loop Toolbar.jsx used to run on itself.
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

  // The commands the surface cannot serve alone. The canvas ones need nothing from
  // React — they resolve a surface id and dispatch what the canvas already listens
  // for — so they are a module. `openDocument` needs app state, and is the same swap
  // a canvas card's double-click makes, so it is that callback. Declared here, after
  // `openDocFromCanvas`, because a dependency array is read during render and this
  // file has already shipped one crash from reading a binding in its temporal dead zone.
  useEffect(() => {
    documentSurface.setDelegates({
      ...canvasDelegates,
      openDocument: ({ path, pane }) => openDocFromCanvas(pane, path),
    })
  }, [openDocFromCanvas])

  const liveEditor = isEditorReady(editor) ? editor : null
  const liveSecondaryEditor = isEditorReady(secondaryEditor) ? secondaryEditor : null
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
      <div ref={splitContainerRef} className={`editor-container${splitClassName}`} style={splitStyle}>

        <div
          ref={primaryPaneRef}
          className="pane primary-pane"
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
              showHeader={splitView === 'editor'}
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
              showHeader={splitView === 'editor'}
              onClose={closePrimary}
              isActive={activeDoc === currentDoc}
            />
          ) : (
            <PaneEditorSurface
              editor={liveEditor}
              projectName={projectName}
              docPath={currentDoc}
              header={splitView === 'editor' ? (
                <div className="pane-header pane-header-centered">
                  <span>{currentDoc}</span>
                  <button onClick={closePrimary}>×</button>
                </div>
              ) : null}
            />
          )}
          {!primaryIsStructured && !showDraftPane ? (
            <div className="pane-status">
              {showWordCountBadge ? <div className="word-count">{formatWordStats(primaryWordStats)}</div> : null}
            </div>
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
                showHeader
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
                showHeader
                onClose={closeSecondary}
                isActive={activeDoc === secondaryDoc}
              />
            ) : (
              <PaneEditorSurface
                editor={liveSecondaryEditor}
                projectName={projectName}
                docPath={secondaryDoc}
                header={(
                  <div className="pane-header split-header pane-header-centered">
                    <span>{secondaryDoc}</span>
                    <button onClick={closeSecondary}>×</button>
                  </div>
                )}
              />
            )}
            {!secondaryIsStructured ? (
              <div className="pane-status">
                {showWordCountBadge ? <div className="word-count">{formatWordStats(secondaryWordStats)}</div> : null}
              </div>
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
