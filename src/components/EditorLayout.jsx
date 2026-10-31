/**
 * EditorLayout.jsx — main workspace layout.
 *
 * Arranges the window as Arc and Dia do: the left sidebar (file tree) and right
 * sidebar (inspector) docked on the window's tinted tray, and between them one
 * floating card holding the toolbar and the editor canvas. A sidebar that is not
 * pinned hides and hovers over the card when the pointer reaches its window edge;
 * the buttons in the card's top corners pin and unpin them. Also hosts
 * cross-cutting UI behaviors: the custom window-drag titlebar and fullscreen
 * chrome detection (useWindowChrome), the right-click context menu, "jump to text"
 * for notes and search results (useJumpToText), Print Layout's actions
 * (useLayoutPrintActions), and the Bubble editor's sessions (EditorCanvas draws one
 * in its pane, and its bar takes over the toolbar).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { documentSurface, shellBridge, useBridgeEvent, useBridgeState, useLatestBridgeState } from '../bridge'
import { EditorTarget } from '../types'
import { FILETREE_NEW_ENTRY, IMPORT_SCRIPT, PAGE_SETUP } from '../lib/appEvents'

/** A stable identity, so useBridgeState's initial value is not a new object each render. */
const EMPTY_ACTIVE_EDITOR = {}
import { useWindowChrome } from '../hooks/useWindowChrome'
import { useJumpToText } from '../hooks/useJumpToText'
import { useSidebarCommands } from '../hooks/useSidebarCommands'
import EditorCanvas from './EditorCanvas'
import PageSetupSheet from '../print/PageSetupSheet'
import { useLayoutPrintActions } from '../print/useLayoutPrintActions'
import { importFountainScript } from '../script/importScript'

import LeftSidebar from './LeftSidebar'
import RightSidebar from './RightSidebar/RightSidebar'
import FindBar from './FindBar'
import { useResizableSidebar } from '../hooks/useResizableSidebar'
import { useEditorContextMenu } from '../hooks/useEditorContextMenu'
import { isCanvasDoc, isMapDoc, isTextDoc, isTimelineDoc } from '../lib/docKind'
import { CanvasToolbarSlotContext, NATIVE_CANVAS_TOOLBAR } from '../canvas/canvasToolbarSlot'
import { CompareToolbarSlotContext } from './compareToolbarSlot'
import { paragraphForBubble, selectionForBubble, useBubbleSessions } from '../hooks/useBubbleSessions'
import { useReferences } from '../hooks/useReferences'
import NoteHoverPreview from './NoteHoverPreview'
import NotePanelTether from './NotePanelTether'
import ToolbarHost from './toolbar/ToolbarHost'
import IconButton from '../ui/IconButton'
import { useReveal, useRevealReady } from '../ui/revealState.js'
import { readDisplayMode, TOOLBAR_LAYOUT_CHANGED } from './toolbar/useToolbarLayout'
import { CUSTOMIZE_INSPECTOR_EVENT, popUpToolbarMenu } from '../hooks/contextMenu/toolbarMenu'
import InspectorLayoutEditor from './RightSidebar/InspectorLayoutEditor'
import { useCommands } from '../lib/commands'
import { createClipboardNote, createFreeNote, createQuoteNote } from '../lib/noteUtils'
import { requestDraftKind } from '../lib/draftDocument'
import { requestFind, requestMapFind } from '../lib/sidebarSearch'
import { refreshFolderPresets } from '../lib/folderPresets'
import FolderPresetsSheet from './FolderPresetsSheet'
import { refreshLocks, setDocumentLocked, setFolderLocked, useLockReason, useLocks } from '../lib/docLocks'
import { placeTrafficLights } from '../lib/trafficLights'
import { rememberCardRect } from '../lib/landingCard'
import { SPRINGS, springEasing } from '../ui/physics.js'
import SelectionWheel from './SelectionWheel'

// Room in the card's toolbar row for a corner's pin button.
const CARD_TOGGLE_WIDTH = 44

/** How long a hovering sidebar takes to slide in (--spring-smooth): its lights wait for it. */
const PEEK_SETTLE_MS = springEasing(SPRINGS.smooth).duration

/** Return the editor only if it is fully mounted and usable (guards against destroyed instances). */
const getLiveEditor = (editor) => {
  if (!editor || editor.isDestroyed) return null
  if (!editor.state?.schema?.nodes) return null
  if (!editor.view || editor.view.isDestroyed) return null
  if (!editor.commands || typeof editor.chain !== 'function') return null
  return editor
}

export default function EditorLayout(props) {
  const left = useResizableSidebar(220, 200, 340, 'left')
  const right = useResizableSidebar(300, 260, 520, 'right')
  const { setSidebarTab, documentCardRef, arriving } = props
  // Where the card is when the project closes is where the next one's flight from the
  // landing page aims (lib/landingCard.js). A layout effect's cleanup runs while the
  // card is still in the window.
  useLayoutEffect(() => () => rememberCardRect(documentCardRef?.current), [documentCardRef])
  // Use splitView/secondaryDoc from props (managed at top-level `Editor`) to avoid
  // shadowing state and keep all parts of the UI in sync.
  // Focus mode is 'open', 'leaving' (zooming back onto the page, still drawn) or
  // 'closed'. Asking it to close while open lets it leave; it reports when it has.
  const [focusMode, setFocusMode] = useState('closed')
  const focusModeOpen = focusMode === 'open'
  const setFocusModeOpen = useCallback((next) => setFocusMode((current) => {
    const open = typeof next === 'function' ? next(current === 'open') : next
    if (open) return 'open'
    return current === 'closed' ? 'closed' : 'leaving'
  }), [])
  const finishLeavingFocusMode = useCallback(() => {
    setFocusMode((current) => (current === 'leaving' ? 'closed' : current))
  }, [])
  // The inspector's foot, where the word count goes while the inspector is docked.
  const [inspectorFooter, setInspectorFooter] = useState(null)
  const openRightSidebar = right.open
  const {
    activeDoc,
    activeEditor,
    currentDoc,
    editor,
    notesByDoc,
    setActiveDoc,
    setCurrentDoc,
  } = props
  // The toolbar's Focus Mode item. The mode stays this page's; the toolbar asks for it
  // and lights its button from what is published back.
  useEffect(() => documentSurface.onCommand('setFocusMode', ({ open }) => setFocusModeOpen(Boolean(open))), [setFocusModeOpen])
  useEffect(() => {
    documentSurface.publishViewOptions({ focusMode: focusModeOpen })
  }, [focusModeOpen])
  // Focus mode opens with both sidebars put away (they still hover in from the window's
  // edges, and its bar can pin them), and gives back the ones that were docked once it
  // has zoomed back onto the page. Stowed, not unpinned, so the saved layout survives
  // the app quitting in focus mode. Before paint, so focus mode measures the page as
  // the writer last saw it and opens on the card it will have.
  const sidebarsRef = useRef({ left, right })
  useLayoutEffect(() => { sidebarsRef.current = { left, right } })
  useLayoutEffect(() => {
    const { left: leftSide, right: rightSide } = sidebarsRef.current
    if (focusMode === 'open') {
      leftSide.stow()
      rightSide.stow()
    } else if (focusMode === 'closed') {
      leftSide.unstow()
      rightSide.unstow()
    }
  }, [focusMode])
  const bubbles = useBubbleSessions({ docPath: activeDoc || currentDoc, projectName: props.projectName })
  // While a bubble is open its bar is the toolbar, portaled into this slot.
  const [bubbleToolbarSlot, setBubbleToolbarSlot] = useState(null)
  const bubbling = Boolean(bubbles.open)
  // A bubble takes the place of its pane, which focus mode is drawn over.
  useEffect(() => {
    if (bubbling) setFocusModeOpen(false)
  }, [bubbling, setFocusModeOpen])
  // Citations format in every open editor; the References panel is the shell's.
  useReferences({
    projectName: props.projectName,
    activeDoc: activeDoc || currentDoc,
    panes: [
      { editor, path: currentDoc },
      { editor: props.secondaryEditor, path: props.secondaryDoc },
    ],
  })
  // On a canvas, the only editor the Toolbar may drive is a card's own editor.
  // Falling back to the pane's TipTap editors would point the Toolbar at an idle
  // instance holding no document.
  //
  // The election result arrives as the `activeEditorChanged` event, whose target is
  // `canvasCard` when a card's editor is active. The live editor is still resolved
  // locally, because the dictation and read-aloud controls inside the Toolbar need
  // the instance.
  const activeEditorInfo = useBridgeState('activeEditorChanged', EMPTY_ACTIVE_EDITOR)
  const activeIsCanvas = isCanvasDoc(activeDoc || currentDoc)
  const [compareToolbarSlot, setCompareToolbarSlot] = useState(null)
  const liveActiveEditor = getLiveEditor(activeEditor)
  const toolbarEditor = activeIsCanvas
    ? (activeEditorInfo.target === EditorTarget.CanvasCard ? liveActiveEditor : null)
    : (liveActiveEditor || getLiveEditor(editor) || getLiveEditor(props.secondaryEditor))

  // Which toolbar is up: a canvas's own while no card is being edited, a map's, a
  // timeline's, the Typeset toolbar for a document in Typeset mode, else the document's.
  const pageLayoutState = useLatestBridgeState('pageLayoutState', null)
  const activeIsMap = isMapDoc(activeDoc || currentDoc)
  const activeIsTimeline = isTimelineDoc(activeDoc || currentDoc)
  const toolbarContext = activeIsCanvas
    ? (toolbarEditor ? 'document' : 'canvas')
    : activeIsMap
      ? 'map'
      : activeIsTimeline
        ? 'timeline'
        : toolbarEditor
          ? (pageLayoutState?.mode === 'typeset' ? 'typeset' : 'document')
          : null
  // Customize Inspector Layout…, from the toolbar's menu or the inspector's own.
  const [customizingInspector, setCustomizingInspector] = useState(false)
  useEffect(() => {
    const open = () => setCustomizingInspector(true)
    window.addEventListener(CUSTOMIZE_INSPECTOR_EVENT, open)
    return () => window.removeEventListener(CUSTOMIZE_INSPECTOR_EVENT, open)
  }, [])
  const [toolbarDisplay, setToolbarDisplay] = useState(readDisplayMode)
  useEffect(() => {
    const update = () => setToolbarDisplay(readDisplayMode())
    window.addEventListener(TOOLBAR_LAYOUT_CHANGED, update)
    return () => window.removeEventListener(TOOLBAR_LAYOUT_CHANGED, update)
  }, [])

  // While a comparison is up it owns the titlebar: the editor underneath is hidden,
  // so a formatting toolbar would drive something nobody can see. Handing the canvas
  // a null slot is what stops the two from both mounting a toolbar there.
  const comparing = Boolean(props.compare)
  // The toolbar arrives with the document it acts on (Editor's RevealGate), not on its own.
  const toolbarReveal = useReveal(comparing || Boolean(toolbarContext) || !(activeDoc || currentDoc))

  const isFullscreenChrome = useWindowChrome()

  const openRightSidebarTab = useCallback((tab) => {
    setSidebarTab(tab)
    openRightSidebar()
  }, [setSidebarTab, openRightSidebar])

  // A panel something asks for (a citation ⌥-clicked: References; the Timer menu: Stats)
  // comes up.
  useBridgeEvent('showSidebarTab', ({ tab }) => { if (tab) openRightSidebarTab(tab) })

  // The toolbar's panel items: show a panel, or hide the inspector if it is showing.
  const rightOpen = right.shown
  // With it open, a note's dot strings to its card there rather than opening a hover note.
  const notesPanelOpen = rightOpen && props.sidebarTab === 'notes'
  const togglePanel = useCallback((tab) => {
    if (rightOpen && props.sidebarTab === tab) {
      right.collapse()
      return
    }
    openRightSidebarTab(tab)
  }, [rightOpen, props.sidebarTab, right, openRightSidebarTab])
  const toolbarPanel = useMemo(
    () => ({ tab: props.sidebarTab, open: rightOpen, toggle: togglePanel }),
    [props.sidebarTab, rightOpen, togglePanel]
  )

  // A note on the selection, or a free one with nothing selected (⌥⌘N, the toolbar's
  // Add Note, the command palette).
  const { setNotes } = props
  const addNote = useCallback(() => {
    const live = getLiveEditor(props.activeEditor)
    const selection = live?.state.selection
    const note = selection && !selection.empty
      ? createQuoteNote({ from: selection.from, to: selection.to, anchor: live.state.doc.textBetween(selection.from, selection.to) })
      : createFreeNote()
    setNotes?.((notes) => [note, ...notes])
    openRightSidebarTab('notes')
  }, [props.activeEditor, setNotes, openRightSidebarTab])

  // A clipboard piece kept as a note on the active document (the clipboard keeps it too).
  const makeNoteFromClipboard = useCallback((entry) => {
    if (!entry) return
    setNotes?.((notes) => [createClipboardNote(entry), ...notes])
    openRightSidebarTab('notes')
  }, [setNotes, openRightSidebarTab])

  // ⌘F: the find bar, finding what is selected.
  const findInDocument = useCallback(() => {
    if (isMapDoc(activeDoc || currentDoc)) {
      requestMapFind()
      return
    }
    const live = props.activeEditor
    const selection = live && !live.isDestroyed ? live.state.selection : null
    const query = selection && !selection.empty ? live.state.doc.textBetween(selection.from, selection.to, ' ').trim() : ''
    requestFind(query)
  }, [activeDoc, currentDoc, props.activeEditor])

  // The project's locks (docLocks.ts), read when it opens; the file tree re-reads them.
  // And its own folder types (folderPresets.ts).
  useEffect(() => {
    void refreshLocks(props.projectName)
    void refreshFolderPresets(props.projectName)
  }, [props.projectName])
  // A locked document opens with its badge, never gains it a moment later (Editor's RevealGate).
  useRevealReady('locks', useLocks().project === props.projectName)
  const lockTarget = activeDoc || currentDoc
  const lock = useLockReason(lockTarget)

  const leftShown = left.shown
  const activeIsText = isTextDoc(activeDoc || currentDoc)
  // Focus mode draws prose only: a canvas, map or draft taking the pane ends it.
  useEffect(() => {
    if (!activeIsText) setFocusMode('closed')
  }, [activeIsText])
  const editorMode = pageLayoutState?.mode
  const split = props.splitView
  const lastCopy = props.clipboardHistory?.[0]
  useCommands(() => {
    const send = (type, payload = {}) => shellBridge.send(type, payload)
    const newOf = (kind) => () => { requestDraftKind(kind); send('newTab') }
    return [
      { id: 'document.new', section: 'Document', title: 'New document…', icon: 'new-document', keys: 'Mod+N', keywords: ['create', 'chapter', 'page', 'file'], when: () => Boolean(props.projectName), run: newOf('doc') },
      { id: 'folder.new', section: 'Document', title: 'New folder…', icon: 'folder', keys: 'Mod+Shift+N', keywords: ['create', 'group', 'directory'], when: () => Boolean(props.projectName), run: () => {
        if (!leftShown) left.open()
        window.dispatchEvent(new CustomEvent(FILETREE_NEW_ENTRY, { detail: { type: 'folder', parent: '' } }))
      } },
      { id: 'canvas.new', section: 'Document', title: 'New canvas…', icon: 'canvas', keywords: ['create', 'board', 'cards'], when: () => Boolean(props.projectName), run: newOf('canvas') },
      { id: 'map.new', section: 'Document', title: 'New map…', icon: 'map', keywords: ['create', 'world', 'places'], when: () => Boolean(props.projectName), run: newOf('map') },
      { id: 'timeline.new', section: 'Document', title: 'New timeline…', icon: 'timeline', keywords: ['create', 'chronology', 'events', 'dates'], when: () => Boolean(props.projectName), run: newOf('timeline') },
      { id: 'notes.add', section: 'Notes', title: 'Add note', icon: 'note', keys: 'Mod+Alt+N', keywords: ['comment', 'annotate'], when: () => activeIsText, run: addNote },
      { id: 'clipboard.make-note', section: 'Notes', title: 'Make a note of the last copy', icon: 'note', keywords: ['clipboard', 'paste', 'copied'], when: () => activeIsText && Boolean(lastCopy), run: () => makeNoteFromClipboard(lastCopy) },
      { id: 'search.find', section: 'Search', title: 'Find…', icon: 'search', keys: 'Mod+F', keywords: ['search', 'look for', 'replace', 'selection'], run: findInDocument },
      { id: 'writing.bubble', section: 'Writing', title: 'Bubble the selection', icon: 'chats', keywords: ['rearrange', 'reorder', 'words', 'sentence'], when: () => activeIsText && !bubbling && Boolean(selectionForBubble(getLiveEditor(props.activeEditor))), run: () => bubbles.openFromSelection(getLiveEditor(props.activeEditor)) },
      { id: 'writing.hide', section: 'Writing', title: 'Hide the selection', icon: 'hide', keywords: ['fold', 'collapse', 'conceal', 'hidden'], when: () => activeIsText && !lock && Boolean(getLiveEditor(props.activeEditor)?.state.selection.empty === false), run: () => getLiveEditor(props.activeEditor)?.chain().focus().setHiddenText().run() },
      { id: 'writing.show-hidden', section: 'Writing', title: 'Show all hidden text', icon: 'show', keywords: ['unfold', 'expand', 'reveal', 'hidden'], when: () => activeIsText, run: () => getLiveEditor(props.activeEditor)?.commands.setAllHiddenOpen(true) },
      { id: 'writing.fold-hidden', section: 'Writing', title: 'Fold all hidden text', icon: 'hide', keywords: ['collapse', 'conceal', 'hidden'], when: () => activeIsText, run: () => getLiveEditor(props.activeEditor)?.commands.setAllHiddenOpen(false) },
      { id: 'writing.bubble-paragraph', section: 'Writing', title: 'Bubble this paragraph', icon: 'chats', keywords: ['rearrange', 'reorder', 'sentences'], when: () => activeIsText && !bubbling && Boolean(paragraphForBubble(getLiveEditor(props.activeEditor))), run: () => bubbles.openParagraph(getLiveEditor(props.activeEditor)) },
      { id: 'view.focus-mode', section: 'View', title: focusModeOpen ? 'Leave focus mode' : 'Enter focus mode', icon: 'crosshair', keywords: ['distraction free', 'zen', 'full screen'], when: () => activeIsText, run: () => setFocusModeOpen((open) => !open) },
      { id: 'view.sidebar', section: 'View', title: left.pinned ? 'Hide sidebar' : 'Show sidebar', icon: 'sidebar', keywords: ['files', 'file tree', 'left panel', 'pin', 'unpin'], run: left.togglePin },
      { id: 'view.inspector', section: 'View', title: right.pinned ? 'Hide inspector' : 'Show inspector', icon: 'sidebar', keywords: ['right panel', 'panels', 'pin', 'unpin'], run: right.togglePin },
      { id: 'view.split.right', section: 'View', title: 'Split right', icon: 'split-columns', keywords: ['side by side', 'two documents'], when: () => split !== 'editor', run: () => send('openInSplit', { orientation: 'columns' }) },
      { id: 'view.split.down', section: 'View', title: 'Split down', icon: 'split-rows', keywords: ['above and below', 'two documents'], when: () => split !== 'editor', run: () => send('openInSplit', { orientation: 'rows' }) },
      { id: 'view.split.toggle', section: 'View', title: split === 'editor' ? 'Close split view' : 'Split view', icon: 'split-columns', keys: 'Mod+\\', keywords: ['side by side', 'two documents'], run: () => (split === 'editor' ? send('closeSplit') : send('openInSplit', { orientation: 'columns' })) },
      { id: 'view.split.close', section: 'View', title: 'Close split', icon: 'close', when: () => split === 'editor', run: () => send('closeSplit') },
      lock?.by === 'folder'
        ? { id: 'document.lock', section: 'Document', title: `Unlock folder “${lock.folder.split('/').pop()}”`, icon: 'unlock', keywords: ['read only', 'edit', 'lock'], run: () => setFolderLocked(props.projectName, lock.folder, false) }
        : { id: 'document.lock', section: 'Document', title: lock ? 'Unlock document' : 'Lock document', icon: lock ? 'unlock' : 'lock', keywords: ['read only', 'freeze', 'protect', 'edit'], when: () => Boolean(props.projectName && lockTarget), run: () => setDocumentLocked(props.projectName, lockTarget, !lock) },
      { id: 'history.open', section: 'Document', title: 'Show version history', icon: 'history', keywords: ['versions', 'snapshots', 'restore', 'undo'], run: () => openRightSidebarTab('history') },
      { id: 'view.typeset', section: 'Print & export', title: editorMode === 'typeset' ? 'Back to Write' : 'Typeset the book', icon: editorMode === 'typeset' ? 'write' : 'type-style', keywords: ['pages', 'layout', 'print', 'book', 'write'], when: () => activeIsText, run: () => send('setEditorMode', { mode: editorMode === 'typeset' ? 'write' : 'typeset' }) },
    ]
  }, [props.projectName, props.activeEditor, bubbles, bubbling, activeIsText, addNote, lastCopy, makeNoteFromClipboard, focusModeOpen, leftShown, rightOpen, left, right, split, editorMode, openRightSidebarTab, lock, lockTarget, findInDocument])

  // What the selection wheel's tools borrow from here (lib/selectionTools.js).
  const getWheelEditor = useCallback(() => getLiveEditor(props.activeEditor), [props.activeEditor])
  const setTiles = props.setTiles
  const wheelCtx = useMemo(() => ({
    bubbles,
    addNote,
    lastHighlightColor: () => documentSurface.lastHighlightColor(),
    // Through the bridge, like the toolbar's, so the colour is remembered for next time.
    setHighlight: (color, remember) => shellBridge.send('setHighlight', { color, remember }),
    workbench: setTiles ? (type) => {
      const editor = getLiveEditor(props.activeEditor)
      if (!editor) return
      const { from, to } = editor.state.selection
      const text = editor.state.doc.textBetween(from, to, ' ')
      setTiles((tiles) => [{ id: Date.now(), type, text, from, to, anchor: text, doc: activeDoc || currentDoc }, ...tiles])
      openRightSidebarTab('workbench')
    } : null,
  }), [bubbles, addNote, setTiles, props.activeEditor, activeDoc, currentDoc, openRightSidebarTab])

  const handleContextMenu = useEditorContextMenu({
    editor: props.activeEditor,
    setTiles: props.setTiles,
    setNotes: props.setNotes,
    openRightSidebarTab,
    setSplitView: props.setSplitView,
    setSecondaryDoc: props.setSecondaryDoc,
    setCurrentDoc: props.setCurrentDoc,
    splitView: props.splitView,
    currentDoc: props.currentDoc,
    secondaryDoc: props.secondaryDoc,
    activeDoc: props.activeDoc,
    projectName: props.projectName,
    refreshFiles: props.refreshFiles,
    bubbles,
    onEnterFocusMode: () => setFocusModeOpen(true),
    onOpenDocInTab: props.onOpenDocInTab,
    onOpenDocInSplit: props.onOpenDocInSplit,
    onCloseSplit: props.onCloseSplit,
  })

  // Renaming and creating happen in the tree's own inline text box, which is no
  // use if the sidebar is collapsed — and these actions are reachable from the
  // editor, where it usually is.
  const openLeftSidebar = left.open
  useEffect(() => {
    const reveal = () => openLeftSidebar?.()
    window.addEventListener(FILETREE_NEW_ENTRY, reveal)
    return () => window.removeEventListener(FILETREE_NEW_ENTRY, reveal)
  }, [openLeftSidebar])

  const { jumpToText, openSearchTarget } = useJumpToText({ activeEditor, editor, activeDoc, currentDoc, setActiveDoc, setCurrentDoc })

  // Print Layout, Print… and Export, for whichever document is active.
  const printLayout = useLayoutPrintActions({
    projectName: props.projectName,
    activeDoc,
    currentDoc,
    secondaryDoc: props.secondaryDoc,
    editor,
    secondaryEditor: props.secondaryEditor,
    setActiveDoc,
    setCurrentDoc,
  })

  // File ▸ Import Fountain Script…: a new document beside the open one, opened in a tab.
  const { projectName: importProject, refreshFiles: importRefresh, onOpenDocInTab: importOpen } = props
  useEffect(() => {
    const onImport = () => {
      importFountainScript({ projectName: importProject, nearDoc: activeDoc || currentDoc })
        .then(async (path) => {
          if (!path) return
          await importRefresh?.()
          importOpen?.(path)
        })
        .catch((error) => console.error('[import] failed:', error))
    }
    window.addEventListener(IMPORT_SCRIPT, onImport)
    return () => window.removeEventListener(IMPORT_SCRIPT, onImport)
  }, [activeDoc, currentDoc, importOpen, importProject, importRefresh])

  // File ▸ Page Setup….
  const [pageSetupOpen, setPageSetupOpen] = useState(false)
  useEffect(() => {
    const open = () => setPageSetupOpen(true)
    window.addEventListener(PAGE_SETUP, open)
    return () => window.removeEventListener(PAGE_SETUP, open)
  }, [])

  // The right sidebar's state and edits, for a shell that draws the sidebar itself.
  // Here, after openSearchTarget, because a hook argument is read during render.
  useSidebarCommands({
    projectName: props.projectName,
    activeDoc,
    currentDoc,
    secondaryDoc: props.secondaryDoc,
    editor,
    secondaryEditor: props.secondaryEditor,
    notesByDoc,
    setNotesForDoc: props.setNotesForDoc,
    clipboardHistory: props.clipboardHistory,
    clearClipboardHistory: props.clearClipboardHistory,
    onDropToClipboard: props.onDropToClipboard,
    onMoveClipboardEntryToEditor: props.onMoveClipboardEntryToEditor,
    tiles: props.tiles,
    setTiles: props.setTiles,
    openCompare: props.openCompare,
    refreshFiles: props.refreshFiles,
    onOpenDocInTab: props.onOpenDocInTab,
    openSearchTarget,
  })

  const sidebarResizing = left.resizing || right.resizing

  // A canvas never draws its own toolbar: while no card is being edited it publishes
  // its state (NATIVE_CANVAS_TOOLBAR) and the canvas toolbar is drawn from that.
  const canvasToolbarTarget = comparing
    ? null
    : (activeIsCanvas && !toolbarEditor ? NATIVE_CANVAS_TOOLBAR : null)

  // The page's clearance at the top (`--app-titlebar-height`, where the document's
  // scroller starts): taller when the toolbar shows its labels.
  const pageToolbarStyle = toolbarDisplay === 'iconAndLabel' ? { '--app-titlebar-height': '56px' } : undefined

  // The traffic lights stay where the landing page has them (the left sidebar's first
  // row is centred on the same line), shown while the sidebar is docked or hovering and
  // hidden while it is hidden. A hovering sidebar slides in, so they wait until it has
  // arrived. In fullscreen AppKit owns them.
  const leftShowing = left.pinned || left.peeked
  useEffect(() => {
    if (isFullscreenChrome) return undefined
    const place = (event) => placeTrafficLights({ visible: leftShowing, force: event?.type === 'resize' })
    const timer = window.setTimeout(place, leftShowing && !left.pinned ? PEEK_SETTLE_MS : 0)
    window.addEventListener('resize', place)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('resize', place)
    }
  }, [isFullscreenChrome, leftShowing, left.pinned])
  useEffect(() => () => placeTrafficLights({ visible: true }), [])

  const focusSidebars = useMemo(() => ({
    left: { pinned: left.pinned, togglePin: left.togglePin },
    right: { pinned: right.pinned, togglePin: right.togglePin },
  }), [left.pinned, left.togglePin, right.pinned, right.togglePin])

  // The card's top-left holds only its pin button: the traffic lights go with the left
  // sidebar and never sit over the card.
  const cardLeftChrome = CARD_TOGGLE_WIDTH

  return (
    <CanvasToolbarSlotContext.Provider value={canvasToolbarTarget}>
    <CompareToolbarSlotContext.Provider value={comparing ? compareToolbarSlot : null}>
    <div
      className={`editor-page-wrapper${isFullscreenChrome ? ' is-fullscreen' : ''}${focusMode !== 'closed' ? ' is-focus-mode' : ''}${focusMode === 'leaving' ? ' is-leaving-focus-mode' : ''}${sidebarResizing ? ' is-sidebar-resizing' : ''}`}
      style={pageToolbarStyle}
      data-arrival={arriving}
      onContextMenu={handleContextMenu}
    >
      {pageSetupOpen && printLayout.activeEditor ? (
        <PageSetupSheet
          editor={printLayout.activeEditor}
          projectName={props.projectName}
          docPath={printLayout.activeTextDoc}
          pageCount={printLayout.pageCount}
          onClose={() => setPageSetupOpen(false)}
        />
      ) : null}
      {customizingInspector ? (
        <InspectorLayoutEditor onClose={() => setCustomizingInspector(false)} />
      ) : null}
      <FolderPresetsSheet projectName={props.projectName} />
      <div className="main-layout ib-tray">

        <LeftSidebar
          {...props}
          width={left.width}
          onResize={left.start}
          resizing={left.resizing}
          collapsed={left.collapsed}
          peeked={left.peeked}
          pinned={left.pinned}
          gliding={left.gliding}
          togglePin={left.togglePin}
          onAutoCollapse={left.collapse}
          onOpenSearchTarget={openSearchTarget}
        />

        <div
          ref={documentCardRef}
          className={`document-card${props.splitView === 'editor' && !comparing && !focusModeOpen ? ' is-split' : ''}${bubbling && !comparing ? ' is-bubbling' : ''}${left.pinned ? ' has-left-dock' : ''}${right.pinned ? ' has-right-dock' : ''}${left.gliding ? ' is-left-gliding' : ''}${right.gliding ? ' is-right-gliding' : ''}`}
        >
          <div
            onContextMenu={comparing ? undefined : popUpToolbarMenu}
            className="app-titlebar"
            style={{
              '--titlebar-left-width': `${cardLeftChrome}px`,
              '--titlebar-right-width': `${CARD_TOGGLE_WIDTH}px`,
            }}
          >
            {/* One slot, four states, in precedence order: a comparison takes the
                titlebar outright (portaled in by VersionComparePane), else a card being
                edited gets the text Toolbar, else a canvas gets its own toolbar
                (portaled in by the active CanvasSurface), else a plain document gets
                the text Toolbar. */}
            {/* The card's top corners pin and unpin each sidebar, as Dia's do. */}
            <div className="titlebar-toggle is-left">
              <IconButton
                icon="sidebar"
                label={left.pinned ? 'Hide sidebar' : 'Keep sidebar open'}
                onClick={left.togglePin}
              />
            </div>
            <div className="titlebar-toggle is-right">
              <IconButton
                icon="sidebar"
                className="is-mirrored"
                label={right.pinned ? 'Hide inspector' : 'Keep inspector open'}
                onClick={right.togglePin}
              />
            </div>
            <div className="app-titlebar-toolbar" {...toolbarReveal.contentProps}>
              {comparing ? (
                <div className="canvas-toolbar-slot" ref={setCompareToolbarSlot} />
              ) : bubbling ? (
                <div className="bubble-toolbar-slot" ref={setBubbleToolbarSlot} />
              ) : toolbarContext ? (
                <ToolbarHost
                  context={toolbarContext}
                  editor={toolbarEditor}
                  activeDoc={activeDoc || currentDoc}
                  hasProject={Boolean(props.projectName)}
                  panel={toolbarPanel}
                  split={props.splitView === 'editor' ? props.splitOrientation : null}
                />
              ) : (
                <div className="toolbar-placeholder" data-tauri-drag-region />
              )}
              {comparing || activeIsMap ? null : <FindBar editor={props.activeEditor} />}
            </div>
          </div>

          <EditorCanvas
            {...props}
            focusMode={focusMode}
            onExitFocusMode={() => setFocusModeOpen(false)}
            onFocusModeExited={finishLeavingFocusMode}
            focusSidebars={focusSidebars}
            bubble={comparing ? null : bubbles.open}
            onCloseBubble={bubbles.close}
            bubbleToolbarSlot={bubbleToolbarSlot}
            wordCountSlot={right.pinned ? inspectorFooter : null}
          />
        </div>

        <RightSidebar
          width={right.width}
          onResize={right.start}
          resizing={right.resizing}
          collapsed={right.collapsed}
          peeked={right.peeked}
          pinned={right.pinned}
          gliding={right.gliding}
          togglePin={right.togglePin}
          onAutoCollapse={right.collapse}
          footerRef={setInspectorFooter}

          sidebarTab={props.sidebarTab}
          setSidebarTab={openRightSidebarTab}

          tiles={props.tiles}
          setTiles={props.setTiles}
          notes={props.notes}
          setNotes={props.setNotes}

          editor={props.editor}
          secondaryEditor={props.secondaryEditor}
          currentDoc={props.currentDoc}
          secondaryDoc={props.secondaryDoc}

          versions={props.versions}
          setVersions={props.setVersions}
          onOpenCompare={props.openCompare}
          clipboardHistory={props.clipboardHistory}
          clearClipboardHistory={props.clearClipboardHistory}
          onDropToClipboard={props.onDropToClipboard}
          onRemoveClipboardEntry={props.onRemoveClipboardEntry}
          onMakeNoteFromClipboard={makeNoteFromClipboard}
          activeDoc={props.activeDoc}
          projectName={props.projectName}

          jumpToText={jumpToText}

          refreshFiles={props.refreshFiles}
          onOpenDocInTab={props.onOpenDocInTab}
        />

        <NoteHoverPreview
          notesByDoc={props.notesByDoc}
          setNotesForDoc={props.setNotesForDoc}
          projectName={props.projectName}
          notesPanelOpen={notesPanelOpen}
        />
        <NotePanelTether notesByDoc={props.notesByDoc} panelOpen={notesPanelOpen} />
        <SelectionWheel getEditor={getWheelEditor} ctx={wheelCtx} enabled={activeIsText && !bubbling && !lock} />


      </div>
    </div>
    </CompareToolbarSlotContext.Provider>
    </CanvasToolbarSlotContext.Provider>
  )
}
