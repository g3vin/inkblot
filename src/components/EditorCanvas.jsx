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
 *   useEditorDnd         pasting, and dragging text (attached: useEditorPaneDragListeners)
 *
 * tests/unit/editor.mjs mounts this component and exercises all of them.
 */
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEditor } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'

import { EditorTarget } from '../types'
import { documentSurface, editorRegistry, useRegisterEditor } from '../bridge'
import { canvasDelegates } from '../bridge/canvasDelegates'
import { mapDelegates } from '../bridge/mapDelegates'
import { useSurfacePublisher } from '../bridge/useSurfacePublisher'
import { buildEditorExtensions } from '../lib/editorExtensions'
import { getMountedEditorView, isEditorReady } from '../lib/editorUtils'
import { useEditorPaneDragListeners } from '../hooks/useEditorPaneDragListeners'
import { getDocKind, isTextDoc } from '../lib/docKind'
import { setPaneHandoff } from '../lib/paneHandoff'
import { excerptOfNode, noteExcerpt } from '../lib/docExcerpts'
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
import { useSplitDrop } from '../hooks/useSplitDrop'
import { formatWordStats, useEditorWordCount } from '../hooks/useEditorWordCount'
import DraftTabPane from './DraftTabPane'
import FocusModeOverlay from './FocusModeOverlay'
import BubbleEditor from './bubble/BubbleEditor'
import VersionComparePane from './VersionComparePane'
import Icon from '../ui/Icon.jsx'
import PaneEditorSurface from '../print/PaneEditorSurface'
import DocLockBadge from './DocLockBadge'
import TableToolbar from './TableToolbar'
import { lockReason, useLocks } from '../lib/docLocks'
import { setEditorLock } from '../extensions/DocumentLock'
import { Skeleton, SkeletonOverlay } from '../ui/Reveal.jsx'
import { SPLIT_RATIO_MAX, SPLIT_RATIO_MIN, clampSplitRatio } from '../lib/editorSession'
import { SPRINGS, rubberClamp, rubberCoefficient, rubberSlope, rubberUnclamp, trackSample, velocityFrom } from '../ui/physics.js'
import { useSpring } from '../ui/useSpring.js'
import { useDelayedFlag, useReveal, useRevealReady } from '../ui/revealState.js'
import { MapSkeleton } from '../canvas/PaneSkeletons'
import { FILETREE_NEW_ENTRY } from '../lib/appEvents'

// A map is a heavy editor (and its globe and space views heavier still): loaded the
// first time one opens, never for a writer who only writes.
const LazyMapPane = lazy(() => import('../map/MapPane'))

/** The map's paper while its code loads; its skeleton only if that is slow. */
function MapLoadingFallback() {
  const slow = useDelayedFlag(true)
  return (
    <>
      <div className="map-surface is-loading" />
      <SkeletonOverlay visible={slow} label="Opening map"><MapSkeleton /></SkeletonOverlay>
    </>
  )
}
/** Lines in the prose column's measure, for a text pane whose document is slow to arrive. */
function DocumentSkeleton({ visible }) {
  return (
    <SkeletonOverlay visible={visible} label="Opening document">
      <div className="pane-skeleton">
        <Skeleton width="38%" height="1.5em" />
        {['100%', '96%', '99%', '62%'].map((width, index) => <Skeleton key={`a${index}`} width={width} />)}
        {['97%', '100%', '84%'].map((width, index) => <Skeleton key={`b${index}`} width={width} className="pane-skeleton-paragraph" />)}
      </div>
    </SkeletonOverlay>
  )
}

function MapPane(props) {
  return (
    <Suspense fallback={<MapLoadingFallback />}>
      <LazyMapPane {...props} />
    </Suspense>
  )
}

const EMPTY_NOTES = []
// How far one arrow press moves the split divider, as a share of the split.
const SPLIT_KEY_STEP = 0.05
/** How far past its limits the divider could ever be pulled, as a share of the split. */
const SPLIT_GIVE = 0.08

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
  wordCountSlot = null,
  onMoveClipboardEntryToEditor,
  activeEditor,
  focusMode = 'closed',
  onExitFocusMode,
  onFocusModeExited,
  focusSidebars,
  bubble = null,
  onCloseBubble,
  bubbleToolbarSlot = null,
  draftTabActive = false,
  onDraftCreated,
  refreshFiles,
  compare = null,
  closeCompare,
  onOpenDocInTab,
  onPlaceDocBeside,
  onRestorePanes,
  versions,
}) {
  // A draft tab holds the primary pane without holding a document: the pane is
  // "open" (and any split stays up) while DraftTabPane asks what it should be.
  const hasActiveDoc = Boolean(projectName && (currentDoc || draftTabActive))
  const primaryPaneRef = useRef(null)
  const secondaryPaneRef = useRef(null)
  const splitContainerRef = useRef(null)
  const [isResizingSplit, setIsResizingSplit] = useState(false)
  // The divider where it is drawn while a hand or a spring moves it: past its limits
  // on a rubber band, then springing to where the ratio was kept. Null at rest. Written
  // straight to the split's grid every frame (paintSplit), never through React: a
  // render of the whole canvas per frame would stall the divider under a slow one.
  const drawnRef = useRef(null)
  const paintSplit = (ratio) => {
    const container = splitContainerRef.current
    if (!container || splitView !== 'editor' || comparing) return
    const tracks = `${ratio}fr var(--split-gutter) ${1 - ratio}fr`
    if (splitOrientation === 'rows') container.style.gridTemplateRows = tracks
    else container.style.gridTemplateColumns = tracks
  }
  const divider = useSpring(splitRatio, {
    spring: SPRINGS.smooth,
    precision: 0.0005,
    onChange: (ratio) => {
      drawnRef.current = ratio
      paintSplit(ratio)
    },
    onRest: (ratio) => {
      drawnRef.current = null
      paintSplit(ratio)
    },
  })
  // A render while the divider is moving draws the kept ratio: put it back where it is
  // drawn before the frame is painted.
  useLayoutEffect(() => {
    if (drawnRef.current !== null) paintSplit(drawnRef.current)
  })
  /** Spring the divider to `ratio` and keep it there, from wherever it is drawn. */
  const glideSplit = (ratio, velocity) => {
    const target = clampSplitRatio(ratio)
    if (!divider.moving) divider.jump(drawnRef.current ?? splitRatio)
    divider.set(target, velocity === undefined ? undefined : { velocity })
    setSplitRatio?.(target)
    // Already there: nothing to spring, so the kept ratio is drawn again.
    if (!divider.moving) {
      drawnRef.current = null
      paintSplit(target)
    }
  }
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

  // Drags into, out of and between the panes, and the panes as the clipboard panel's drop target.
  useEditorPaneDragListeners({
    editor,
    secondaryEditor,
    currentDoc,
    secondaryDoc,
    splitView,
    primaryPaneRef,
    secondaryPaneRef,
    dnd: {
      setDragCaret,
      handlePaneDragStart,
      handlePaneDragOver,
      handlePaneDrop,
      getDraggedClipboardPayload,
      getTargetEditorAtPoint,
      updateDropCaret,
      hoverClipboardAt,
      previewClipboardAt,
      clearClipboardDrag,
      dropClipboardAt,
    },
  })

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

  // Which document each pane last finished loading. A pane shows the document it is
  // named for only once this says so; until then what it holds is the last one, or
  // nothing.
  const [loadedPanes, setLoadedPanes] = useState({ primary: '', secondary: '' })
  const markPaneLoaded = useCallback((paneId, docPath) => {
    const key = `${projectName}::${docPath}`
    setLoadedPanes((prev) => (prev[paneId] === key ? prev : { ...prev, [paneId]: key }))
  }, [projectName])
  const markPrimaryLoaded = useCallback((docPath) => markPaneLoaded('primary', docPath), [markPaneLoaded])
  const markSecondaryLoaded = useCallback((docPath) => markPaneLoaded('secondary', docPath), [markPaneLoaded])
  const onPaneLoaded = useCallback((paneId, paneEditor, docPath) => {
    syncWordStats(paneId, paneEditor)
    markPaneLoaded(paneId, docPath)
    // What the landing page's pile shows of it (lib/docExcerpts.js).
    if (isTextDoc(docPath) && paneEditor?.state?.doc) noteExcerpt(projectName, docPath, excerptOfNode(paneEditor.state.doc))
  }, [markPaneLoaded, projectName, syncWordStats])

  useEditorDocLoader({
    currentDoc,
    docCache,
    editor,
    flushPane,
    onPaneLoaded,
    projectName,
    secondaryDoc,
    secondaryEditor,
    setVersions,
    splitView,
  })

  // A rename or move keeps the open document on screen (lib/paneHandoff.js). Only a
  // pane showing the document as text can hold it; anything else is closed instead.
  const { beginPaneLoad, carryDoc, endPaneLoad, isDocLoaded } = docCache
  useEffect(() => setPaneHandoff({
    hold: (paneId, docPath) => {
      if (!isTextDoc(docPath) || !isDocLoaded(docPath, paneId)) return false
      if (paneId === 'secondary' && splitView !== 'editor') return false
      flushPane(paneId)
      beginPaneLoad(paneId)
      return true
    },
    carry: (paneId, fromDoc, toDoc) => carryDoc(fromDoc, toDoc, paneId),
    release: endPaneLoad,
  }), [beginPaneLoad, carryDoc, endPaneLoad, flushPane, isDocLoaded, splitView])

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

  // A document dragged in from the file tree opens a split on the side it is held over.
  const { outline: splitDropOutline, provisional: provisionalPane } = useSplitDrop({
    enabled: Boolean(
      hasActiveDoc && currentDoc && focusMode === 'closed'
      && !(compare && (compare.docName === currentDoc || compare.docName === secondaryDoc))
    ),
    split: splitView === 'editor',
    splitOrientation,
    currentDoc,
    secondaryDoc,
    containerRef: splitContainerRef,
    secondaryPaneRef,
    onPlaceDocBeside,
    onRestorePanes,
  })

  /* ---------------- Render ---------------- */

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

  // Each pane is one of the pieces opening a project waits for (Editor's RevealGate).
  const holds = (paneId, docPath) => loadedPanes[paneId] === `${projectName}::${docPath}`
  const primaryReady = !currentDoc || holds('primary', currentDoc)
  const secondaryReady = splitView !== 'editor' || !secondaryDoc || holds('secondary', secondaryDoc)
  useRevealReady('primary', primaryReady)
  useRevealReady('secondary', secondaryReady)
  const primaryReveal = useReveal(primaryReady)
  const secondaryReveal = useReveal(secondaryReady)

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
                    new CustomEvent(FILETREE_NEW_ENTRY, {
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

  // The pane a bubble was opened in, by its editor (or, for a canvas card's, by the
  // document the pane shows). It is drawn there in the editor's place, and is
  // `detached` once that pane shows another document.
  const isSplit = splitView === 'editor'
  const bubblePane = !bubble ? null
    : bubble.editor === liveSecondaryEditor && isSplit ? 'secondary'
      : bubble.editor === liveEditor ? 'primary'
        : isSplit && bubble.docPath === secondaryDoc ? 'secondary'
          : 'primary'
  const bubblePaneDoc = bubblePane === 'secondary' ? secondaryDoc : currentDoc
  const renderBubble = (pane) => (bubblePane === pane ? (
    <BubbleEditor
      key={bubble.session.id}
      session={bubble.session}
      onClose={onCloseBubble}
      toolbarSlot={bubbleToolbarSlot}
      detached={Boolean(bubble.docPath) && bubble.docPath !== bubblePaneDoc}
    />
  ) : null)

  const splitClassName = `${comparing ? ' is-comparing' : ''}${bubblePane ? ` has-bubble bubble-in-${bubblePane}` : ''}${
    splitView && !comparing
      ? ` split-active${splitOrientation === 'rows' ? ' split-rows' : ''}${isResizingSplit ? ' is-split-resizing' : ''}`
      : ''
  }`
  const showDraftPane = draftTabActive && !currentDoc
  const primaryPaneOwnsFocus = primaryIsStructured || showDraftPane

  // The divider is a track in the split grid, so the two panes are sized by the
  // ratio and the gutter never has to be accounted for twice.
  const shownRatio = splitRatio
  const splitStyle = splitView === 'editor' && !comparing
    ? (splitOrientation === 'rows'
      ? {
        gridTemplateColumns: '1fr',
        gridTemplateRows: `${shownRatio}fr var(--split-gutter) ${1 - shownRatio}fr`,
      }
      : {
        gridTemplateColumns: `${shownRatio}fr var(--split-gutter) ${1 - shownRatio}fr`,
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
    const band = rubberCoefficient(event.pointerType)
    const ratioAt = (pointer) => {
      const rect = container.getBoundingClientRect()
      return splitOrientation === 'rows'
        ? (pointer.clientY - rect.top) / rect.height
        : (pointer.clientX - rect.left) / rect.width
    }
    // Held where it was grabbed, and where it is drawn if caught mid-spring: the hand
    // is wherever it would have to be for the divider to be drawn there.
    const drawn = divider.moving ? divider.value : drawnRef.current ?? splitRatio
    divider.stop()
    const offset = rubberUnclamp(drawn, SPLIT_RATIO_MIN, SPLIT_RATIO_MAX, SPLIT_GIVE, band) - ratioAt(event)
    const samples = []
    let hand = null

    const onMove = (moveEvent) => {
      hand = ratioAt(moveEvent) + offset
      trackSample(samples, { t: moveEvent.timeStamp, x: hand })
      // Drawn as it goes; the ratio is kept once, when it is let go (glideSplit).
      divider.jump(rubberClamp(hand, SPLIT_RATIO_MIN, SPLIT_RATIO_MAX, SPLIT_GIVE, band))
    }

    const onUp = (upEvent) => {
      setIsResizingSplit(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (hand === null) return
      // Past a limit it springs back, at the speed it was drawn moving: the hand's,
      // slowed by the band. Inside them it stays where it was let go.
      const banded = divider.value !== clampSplitRatio(divider.value)
      const speed = banded && upEvent.type !== 'pointercancel' ? velocityFrom(samples, undefined, upEvent.timeStamp).x : 0
      glideSplit(divider.value, speed * rubberSlope(hand, SPLIT_RATIO_MIN, SPLIT_RATIO_MAX, SPLIT_GIVE, band))
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // The divider from the keyboard: the arrows along it move it, Enter evens it out.
  const nudgeSplit = (event) => {
    const rows = splitOrientation === 'rows'
    const step = { [rows ? 'ArrowUp' : 'ArrowLeft']: -SPLIT_KEY_STEP, [rows ? 'ArrowDown' : 'ArrowRight']: SPLIT_KEY_STEP }[event.key]
    if (step) glideSplit(splitRatio + step)
    else if (event.key === 'Enter') glideSplit(0.5)
    else return
    event.preventDefault()
  }

  // Docked, the inspector's foot holds the count: the active pane's, as one row has
  // room for one number. A canvas, map or timeline has none to give.
  const sidebarCountsSecondary = splitView === 'editor' && activeDoc === secondaryDoc && activeDoc !== currentDoc
  const sidebarWordStats = sidebarCountsSecondary
    ? (secondaryIsStructured ? null : secondaryWordStats)
    : (primaryIsStructured || showDraftPane ? null : primaryWordStats)
  const sidebarWordCount = wordCountSlot && showWordCountBadge && sidebarWordStats
    ? createPortal(<div className="word-count">{formatWordStats(sidebarWordStats)}</div>, wordCountSlot)
    : null

  return (
    <div className="middle-section">
      {sidebarWordCount}
      <div ref={splitContainerRef} className={`editor-container${splitClassName}`} style={splitStyle}>

        <div
          ref={primaryPaneRef}
          className={`pane primary-pane${provisionalPane === 'primary' ? ' is-provisional' : ''}${bubblePane === 'primary' ? ' is-bubbling' : ''}`}
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
          {provisionalPane === 'primary' ? <div className="split-drop-outline is-pane" aria-hidden="true" /> : null}
          {splitDropOutline?.pane === 'primary' ? (
            <div className={`split-drop-outline is-${splitView === 'editor' ? 'pane' : splitDropOutline.side}`} aria-hidden="true" />
          ) : null}
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
              isActive={activeDoc === currentDoc}
              onLoaded={markPrimaryLoaded}
            />
          ) : primaryKind === 'map' ? (
            <MapPane
              projectName={projectName}
              docPath={currentDoc}
              setActiveEditor={setActiveEditor}
              onActivate={() => activatePane(currentDoc, null)}
              onOpenDoc={(docPath) => openDocFromCanvas('primary', docPath)}
              isActive={activeDoc === currentDoc}
              onLoaded={markPrimaryLoaded}
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
              isActive={activeDoc === currentDoc}
              onLoaded={markPrimaryLoaded}
            />
          ) : (
            <PaneEditorSurface
              editor={liveEditor}
              projectName={projectName}
              docPath={currentDoc}
              revealProps={primaryReveal.contentProps}
              onOpenDoc={(path) => openDocFromCanvas('primary', path)}
              header={<TimeLensBar projectName={projectName} />}
            />
          )}
          {!primaryIsStructured && !showDraftPane ? <DocumentSkeleton visible={primaryReveal.skeleton} /> : null}
          {!primaryIsStructured && !showDraftPane ? (
            <div className="pane-status" data-pane="primary" data-doc={currentDoc} data-project={projectName} data-reveal={primaryReveal.phase}>
              {showWordCountBadge && !wordCountSlot ? <div className="word-count floating-capsule">{formatWordStats(primaryWordStats)}</div> : null}
              <DocLockBadge projectName={projectName} docPath={currentDoc} />
            </div>
          ) : null}
          {!primaryIsStructured && !showDraftPane ? (
            <TableToolbar editor={liveEditor} />
          ) : null}
          {renderBubble('primary')}
        </div>

        {splitView === 'editor' && (
          <div
            className="split-resizer"
            role="separator"
            aria-orientation={splitOrientation === 'rows' ? 'horizontal' : 'vertical'}
            aria-label="Resize split"
            aria-valuenow={Math.round(splitRatio * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            tabIndex={0}
            title="Drag to resize · double-click to even out"
            onPointerDown={startSplitResize}
            onDoubleClick={() => glideSplit(0.5)}
            onKeyDown={nudgeSplit}
          >
            <span className="split-resizer-grip" />
          </div>
        )}

        {splitView === 'editor' && (
          <div
            ref={secondaryPaneRef}
            className={`pane secondary-pane${provisionalPane === 'secondary' ? ' is-provisional' : ''}${bubblePane === 'secondary' ? ' is-bubbling' : ''}`}
            data-locked={secondaryLocked}
            onFocus={secondaryIsStructured ? undefined : () => activatePane(secondaryDoc, liveSecondaryEditor, EditorTarget.Secondary)}
            onMouseEnter={secondaryIsStructured ? undefined : () => activatePane(secondaryDoc, liveSecondaryEditor, EditorTarget.Secondary)}
            onWheel={secondaryIsStructured ? undefined : () => activatePane(secondaryDoc, liveSecondaryEditor, EditorTarget.Secondary)}
            onMouseDown={secondaryIsStructured ? undefined : () => focusEditor(liveSecondaryEditor)}
            onClick={secondaryIsStructured ? undefined : () => focusEditor(liveSecondaryEditor)}
            onMouseMove={secondaryIsStructured ? undefined : () => activatePane(secondaryDoc, liveSecondaryEditor, EditorTarget.Secondary)}
          >
            {provisionalPane === 'secondary' ? <div className="split-drop-outline is-pane" aria-hidden="true" /> : null}
            {splitDropOutline?.pane === 'secondary' ? (
              <div className="split-drop-outline is-pane" aria-hidden="true" />
            ) : null}
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
                isActive={activeDoc === secondaryDoc}
                onLoaded={markSecondaryLoaded}
              />
            ) : secondaryKind === 'map' ? (
              <MapPane
                projectName={projectName}
                docPath={secondaryDoc}
                setActiveEditor={setActiveEditor}
                onActivate={() => activatePane(secondaryDoc, null)}
                onOpenDoc={(docPath) => openDocFromCanvas('secondary', docPath)}
                isActive={activeDoc === secondaryDoc}
                onLoaded={markSecondaryLoaded}
                chromeWhileInactive={primaryKind !== 'map'}
              />
            ) : secondaryKind === 'timeline' ? (
              <TimelinePane
                projectName={projectName}
                docPath={secondaryDoc}
                onActivate={() => activatePane(secondaryDoc, null)}
                onOpenDoc={(docPath) => openDocBesideTimeline('secondary', docPath)}
                isActive={activeDoc === secondaryDoc}
                onLoaded={markSecondaryLoaded}
              />
            ) : (
              <PaneEditorSurface
                editor={liveSecondaryEditor}
                projectName={projectName}
                docPath={secondaryDoc}
                revealProps={secondaryReveal.contentProps}
                onOpenDoc={(path) => openDocFromCanvas('secondary', path)}
                header={<TimeLensBar projectName={projectName} />}
              />
            )}
            {!secondaryIsStructured ? <DocumentSkeleton visible={secondaryReveal.skeleton} /> : null}
            {!secondaryIsStructured ? (
              <div className="pane-status" data-pane="secondary" data-doc={secondaryDoc} data-project={projectName} data-reveal={secondaryReveal.phase}>
                {showWordCountBadge && !wordCountSlot ? <div className="word-count floating-capsule">{formatWordStats(secondaryWordStats)}</div> : null}
                <DocLockBadge projectName={projectName} docPath={secondaryDoc} />
              </div>
            ) : null}
            {!secondaryIsStructured ? (
              <TableToolbar editor={liveSecondaryEditor} />
            ) : null}
            {renderBubble('secondary')}
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
            initialVersions={versions?.[compare.docName]}
          />
        ) : null}

        {/* Focus Mode is a prose surface — it has nothing to show for a canvas, a map or a draft. */}
        {focusMode !== 'closed' && !showDraftPane && isTextDoc(activeDoc || currentDoc) ? (
          <FocusModeOverlay
            editor={focusModeEditor}
            onExit={onExitFocusMode}
            leaving={focusMode === 'leaving'}
            onExited={onFocusModeExited}
            sidebars={focusSidebars}
          />
        ) : null}
      </div>
    </div>
  )
}
