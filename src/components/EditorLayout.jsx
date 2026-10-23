/**
 * EditorLayout.jsx — main workspace layout.
 *
 * Arranges the window as Arc and Dia do: the left sidebar (file tree) and right
 * sidebar (inspector) docked on the window's tinted tray, and between them one
 * floating card holding the toolbar and the editor canvas. A sidebar that is not
 * pinned hides and hovers over the card when the pointer reaches its window edge;
 * the buttons in the card's top corners pin and unpin them. Also hosts
 * cross-cutting UI behaviors: the custom window-drag titlebar, fullscreen
 * chrome detection, the right-click context menu, "jump to text" for notes
 * and search results, and the Bubble editor.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { resolveAnchor } from '../bridge/anchors'
import { documentSurface, shellBridge, useBridgeEvent, useBridgeState, useLatestBridgeState } from '../bridge'
import { EditorTarget } from '../types'

/** A stable identity, so useBridgeState's initial value is not a new object each render. */
const EMPTY_ACTIVE_EDITOR = {}
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window'
import { useSidebarCommands } from '../hooks/useSidebarCommands'
import EditorCanvas from './EditorCanvas'
import usePrintLayoutController from '../print/usePrintLayoutController'
import PageSetupSheet from '../print/PageSetupSheet'
import { measurePrint, runPrintJob } from '../print/printJob'
import { runExport, runExportAllEditions } from '../print/export/runExport'
import { importFountainScript } from '../script/importScript'
import { bookFolderFor } from '../print/compile'
import { getBookForDoc, getBookSettings, getPrintScope, setMeasurement } from '../print/printLayoutStore'
import { TYPESET_MILESTONE_EVENT } from '../print/useTypesetHistory'

/** What a format is called in the typeset history: "Exported PDF". */
const EXPORT_NAMES = { pdf: 'PDF', epub: 'EPUB', docx: 'Word', html: 'HTML', markdown: 'Markdown', plainText: 'Plain text', fountain: 'Fountain', fdx: 'Final Draft' }
const milestone = (label) => window.dispatchEvent(new CustomEvent(TYPESET_MILESTONE_EVENT, { detail: { label } }))
import LeftSidebar from './LeftSidebar'
import RightSidebar from './RightSidebar/RightSidebar'
import FindBar from './FindBar'
import { useResizableSidebar } from '../hooks/useResizableSidebar'
import { useEditorContextMenu } from '../hooks/useEditorContextMenu'
import { isCanvasDoc, isMapDoc, isTextDoc, isTimelineDoc } from '../lib/docKind'
import { requestCanvasReveal } from '../canvas/canvasEvents'
import { requestMapReveal } from '../map/mapEvents'
import { CanvasToolbarSlotContext, NATIVE_CANVAS_TOOLBAR } from '../canvas/canvasToolbarSlot'
import { CompareToolbarSlotContext } from './compareToolbarSlot'
import BubbleEditor from './bubble/BubbleEditor'
import { useBubbleSessions } from '../hooks/useBubbleSessions'
import { useReferences } from '../hooks/useReferences'
import NoteHoverPreview from './NoteHoverPreview'
import ToolbarHost from './toolbar/ToolbarHost'
import IconButton from '../ui/IconButton'
import { readDisplayMode, TOOLBAR_LAYOUT_CHANGED } from './toolbar/useToolbarLayout'
import { CUSTOMIZE_INSPECTOR_EVENT, popUpToolbarMenu } from '../hooks/contextMenu/toolbarMenu'
import InspectorLayoutEditor from './RightSidebar/InspectorLayoutEditor'
import { useCommands } from '../lib/commands'
import { createClipboardNote, createFreeNote, createQuoteNote } from '../lib/noteUtils'
import { requestDraftKind } from '../lib/draftDocument'
import { requestFind, requestMapFind } from '../lib/sidebarSearch'
import { refreshFolderPresets } from '../lib/folderPresets'
import FolderPresetsSheet from './FolderPresetsSheet'
import { refreshLocks, setDocumentLocked, setFolderLocked, useLockReason } from '../lib/docLocks'
import { currentTrafficLights, DEFAULT_TRAFFIC_LIGHTS, placeTrafficLights, TRAFFIC_LIGHT_DIAMETER, TRAFFIC_LIGHT_SPACING } from '../lib/trafficLights'

// Room in the card's toolbar row for a corner's pin button.
const CARD_TOGGLE_WIDTH = 44

// The green (fullscreen) traffic light's box, from where the lights were last put
// (lib/trafficLights.js), padded a few px so a click near its edge still counts.
const fullscreenButtonBox = () => {
  const lights = currentTrafficLights()
  const left = lights.x + TRAFFIC_LIGHT_SPACING * 2
  return {
    visible: lights.visible,
    left: left - 4,
    right: left + TRAFFIC_LIGHT_DIAMETER + 6,
    top: lights.centerY - 14,
    bottom: lights.centerY + 14,
  }
}

// Drag strip, as in Apple's own apps: a full-width band centered on the traffic
// lights, reaching from the top of the window to as far below their centers as
// the window top is above them.
const WINDOW_DRAG_STRIP_HEIGHT = DEFAULT_TRAFFIC_LIGHTS.centerY * 2

/** How long a hovering sidebar takes to slide in (--dur-slow): its lights wait for it. */
const PEEK_SETTLE_MS = 240

/** Return the editor only if it is fully mounted and usable (guards against destroyed instances). */
const getLiveEditor = (editor) => {
  if (!editor || editor.isDestroyed) return null
  if (!editor.state?.schema?.nodes) return null
  if (!editor.view || editor.view.isDestroyed) return null
  if (!editor.commands || typeof editor.chain !== 'function') return null
  return editor
}

// Elements inside the drag strip that should receive clicks instead of starting a window drag.
const WINDOW_DRAG_BLOCKER_SELECTOR = [
  'button',
  'input',
  'select',
  'textarea',
  'a',
  'label',
  '[role="button"]',
  '[contenteditable="true"]',
  '.dictation-popover',
  '.read-aloud-popover',
  '.resizer',
  // The split divider reaches up under the drag strip (the titlebar is only 44px
  // tall, the strip is 72px), so without this its top would move the window.
  '.split-resizer',
  // Owns its own drag gestures (panning, moving nodes) in the band the strip
  // overhangs below the toolbar.
  '.canvas-surface',
  '.map-surface',
].join(',')

export default function EditorLayout(props) {
  const left = useResizableSidebar(220, 200, 340, 'left')
  const right = useResizableSidebar(300, 260, 520, 'right')
  const { setSidebarTab } = props
  // Use splitView/secondaryDoc from props (managed at top-level `Editor`) to avoid
  // shadowing state and keep all parts of the UI in sync.
  const [pendingSearchTarget, setPendingSearchTarget] = useState(null)
  const [isFullscreenChrome, setIsFullscreenChrome] = useState(false)
  const [focusModeOpen, setFocusModeOpen] = useState(false)
  const openRightSidebar = right.open
  const pendingSearchTargetRef = useRef(null)
  const fullscreenChromeRef = useRef(false)
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
  useEffect(() => documentSurface.onCommand('setFocusMode', ({ open }) => setFocusModeOpen(Boolean(open))), [])
  useEffect(() => {
    documentSurface.publishViewOptions({ focusMode: focusModeOpen })
  }, [focusModeOpen])
  const bubbles = useBubbleSessions({ docPath: activeDoc || currentDoc, projectName: props.projectName })
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

  // Custom titlebar: a left-click anywhere in the drag strip moves the window,
  // unless it landed on something interactive. Bound to the window rather than
  // the titlebar element so the strip also covers the sidebars beneath it.
  useEffect(() => {
    const handleWindowDragMouseDown = (event) => {
      if (event.button !== 0) return
      if (event.clientY > WINDOW_DRAG_STRIP_HEIGHT) return
      if (event.target instanceof Element && event.target.closest(WINDOW_DRAG_BLOCKER_SELECTOR)) {
        return
      }

      event.preventDefault()
      getCurrentWindow().startDragging().catch(error => {
        console.warn('Failed to start window drag:', error)
      })
    }

    window.addEventListener('mousedown', handleWindowDragMouseDown, true)
    return () => window.removeEventListener('mousedown', handleWindowDragMouseDown, true)
  }, [])

  // Track (and predict) fullscreen state so the layout can restyle its chrome.
  // macOS reports fullscreen late during the animation, so we also treat
  // near-monitor-sized windows and clicks on the green traffic-light button as
  // fullscreen, then re-sync with the real state once things settle.
  useEffect(() => {
    let cancelled = false
    let unlistenResize = null
    let settleTimeout = null
    const appWindow = getCurrentWindow()

    const setFullscreenChrome = (nextFullscreen) => {
      fullscreenChromeRef.current = nextFullscreen
      setIsFullscreenChrome(nextFullscreen)
    }

    const syncFullscreen = async (event) => {
      try {
        const nextFullscreen = await appWindow.isFullscreen()
        if (cancelled) return

        if (nextFullscreen) {
          setFullscreenChrome(true)
          return
        }

        const size = event?.payload
        const monitor = size ? await currentMonitor() : null
        if (!cancelled && monitor?.size && size) {
          const nearFullscreenSize =
            size.width >= monitor.size.width * 0.94 &&
            size.height >= monitor.size.height * 0.9

          if (nearFullscreenSize) {
            setFullscreenChrome(true)
            window.clearTimeout(settleTimeout)
            settleTimeout = window.setTimeout(() => {
              void syncFullscreen()
            }, 900)
            return
          }
        }

        setFullscreenChrome(false)
      } catch {
        if (!cancelled) setFullscreenChrome(false)
      }
    }

    const handleFullscreenButtonPointerDown = (event) => {
      if (event.button !== 0) return
      const box = fullscreenButtonBox()
      if (!box.visible) return
      if (event.clientX < box.left || event.clientX > box.right) return
      if (event.clientY < box.top || event.clientY > box.bottom) return

      setFullscreenChrome(!fullscreenChromeRef.current)
      window.clearTimeout(settleTimeout)
      settleTimeout = window.setTimeout(() => {
        void syncFullscreen()
      }, 1200)
    }

    void syncFullscreen()
    window.addEventListener('pointerdown', handleFullscreenButtonPointerDown, true)
    appWindow.onResized(syncFullscreen)
      .then((unlisten) => {
        if (cancelled) {
          unlisten?.()
        } else {
          unlistenResize = unlisten
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
      window.clearTimeout(settleTimeout)
      window.removeEventListener('pointerdown', handleFullscreenButtonPointerDown, true)
      unlistenResize?.()
    }
  }, [])

  useEffect(() => {
    pendingSearchTargetRef.current = pendingSearchTarget
  }, [pendingSearchTarget])

  const openRightSidebarTab = useCallback((tab) => {
    setSidebarTab(tab)
    openRightSidebar()
  }, [setSidebarTab, openRightSidebar])

  // A panel something asks for (a citation ⌥-clicked: References; the Timer menu: Stats)
  // comes up.
  useBridgeEvent('showSidebarTab', ({ tab }) => { if (tab) openRightSidebarTab(tab) })

  // The toolbar's panel items: show a panel, or hide the inspector if it is showing.
  const rightOpen = right.shown
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
  const lockTarget = activeDoc || currentDoc
  const lock = useLockReason(lockTarget)

  const leftShown = left.shown
  const activeIsText = isTextDoc(activeDoc || currentDoc)
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
        window.dispatchEvent(new CustomEvent('filetree:new-entry', { detail: { type: 'folder', parent: '' } }))
      } },
      { id: 'canvas.new', section: 'Document', title: 'New canvas…', icon: 'canvas', keywords: ['create', 'board', 'cards'], when: () => Boolean(props.projectName), run: newOf('canvas') },
      { id: 'map.new', section: 'Document', title: 'New map…', icon: 'map', keywords: ['create', 'world', 'places'], when: () => Boolean(props.projectName), run: newOf('map') },
      { id: 'timeline.new', section: 'Document', title: 'New timeline…', icon: 'timeline', keywords: ['create', 'chronology', 'events', 'dates'], when: () => Boolean(props.projectName), run: newOf('timeline') },
      { id: 'notes.add', section: 'Notes', title: 'Add note', icon: 'note', keys: 'Mod+Alt+N', keywords: ['comment', 'annotate'], when: () => activeIsText, run: addNote },
      { id: 'clipboard.make-note', section: 'Notes', title: 'Make a note of the last copy', icon: 'note', keywords: ['clipboard', 'paste', 'copied'], when: () => activeIsText && Boolean(lastCopy), run: () => makeNoteFromClipboard(lastCopy) },
      { id: 'search.find', section: 'Search', title: 'Find…', icon: 'search', keys: 'Mod+F', keywords: ['search', 'look for', 'replace', 'selection'], run: findInDocument },
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
  }, [props.projectName, activeIsText, addNote, lastCopy, makeNoteFromClipboard, focusModeOpen, leftShown, rightOpen, left, right, split, editorMode, openRightSidebarTab, lock, lockTarget, findInDocument])

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
    window.addEventListener('filetree:new-entry', reveal)
    return () => window.removeEventListener('filetree:new-entry', reveal)
  }, [openLeftSidebar])

  // Select and scroll to a note's text in the active editor. Accepts a note object
  // (which carries stored from/to) or a plain anchor string. `resolveAnchor` only
  // trusts the stored positions if they still cover the anchor text.
  const jumpToText = useCallback((noteOrAnchor) => {
    const currentEditor = activeEditor || editor
    if (!currentEditor) return

    const note = typeof noteOrAnchor === 'object' && noteOrAnchor !== null
      ? noteOrAnchor
      : null
    const text = typeof noteOrAnchor === 'string' ? noteOrAnchor : note?.anchor
    if (!text) return

    const range = resolveAnchor(currentEditor, {
      from: Number.isFinite(note?.from) ? note.from : -1,
      to: Number.isFinite(note?.to) ? note.to : -1,
      text,
    })

    // Null means the text is gone. Doing nothing is the right answer: the note has
    // lost what it was about, and a guessed position is worse than no movement.
    if (!range) return

    currentEditor
      .chain()
      .focus()
      .setTextSelection({
        from: range.from,
        to: range.to > range.from ? range.to : range.from,
      })
      .scrollIntoView()
      .run()
  }, [activeEditor, editor])

  // Open a search result: jump immediately if its doc is already open,
  // otherwise switch documents and queue the jump for after the editor loads.
  const openSearchTarget = useCallback((target) => {
    if (!target) return

    const docName = target.docName || activeDoc || currentDoc
    if (!docName) return

    const normalizedTarget = {
      ...target,
      docName,
    }

    // A canvas hit has no document position to jump to — it names a node. Ask for
    // the reveal and switch documents if needed; the canvas claims the request
    // whether it is already mounted or about to be (see canvasEvents).
    if (isCanvasDoc(docName)) {
      if (docName !== activeDoc && docName !== currentDoc) {
        setActiveDoc(docName)
        setCurrentDoc(docName)
      }
      if (normalizedTarget.nodeId) {
        requestCanvasReveal(docName, normalizedTarget.nodeId)
      }
      return
    }

    // A map hit names an item (pin, route, label…) the same way.
    if (isMapDoc(docName)) {
      if (docName !== activeDoc && docName !== currentDoc) {
        setActiveDoc(docName)
        setCurrentDoc(docName)
      }
      if (normalizedTarget.nodeId) {
        requestMapReveal(docName, normalizedTarget.nodeId)
      }
      return
    }

    if (docName === activeDoc || docName === currentDoc) {
      if (normalizedTarget.skipJump) return
      jumpToText(
        normalizedTarget.note || {
          anchor: normalizedTarget.anchor,
          from: normalizedTarget.from,
          to: normalizedTarget.to,
        }
      )
      return
    }

    setActiveDoc(docName)
    setCurrentDoc(docName)
    if (!normalizedTarget.skipJump) {
      setPendingSearchTarget(normalizedTarget)
    }
  }, [activeDoc, currentDoc, jumpToText, setActiveDoc, setCurrentDoc])

  // The right sidebar's state and edits, for a shell that draws the sidebar itself.
  // Here, after openSearchTarget, because a hook argument is read during render.
  // Print Layout, Print… and Export, for whichever document is active.
  const printOptions = useCallback((scope) => {
    const projectName = props.projectName
    const docPath = activeDoc || currentDoc
    return {
      projectName,
      docPath,
      liveEditors: [
        { path: currentDoc, editor },
        { path: props.secondaryDoc, editor: props.secondaryEditor },
      ],
      // Printed alone, a document takes its book's setup when it has none — the book
      // the Finishing tabs show, under the project's scope.
      book: scope === 'document' ? getBookForDoc(projectName, docPath) : getBookSettings(projectName, bookFolderFor(docPath, scope)),
    }
  }, [activeDoc, currentDoc, editor, props.projectName, props.secondaryDoc, props.secondaryEditor])
  const printLayout = usePrintLayoutController({
    projectName: props.projectName,
    activeDoc: activeDoc || currentDoc,
    currentDoc,
    secondaryDoc: props.secondaryDoc,
    editor,
    secondaryEditor: props.secondaryEditor,
    // What a print or an export was made from is kept in the typeset history.
    onPrint: ({ scope, bound, options }) => {
      runPrintJob({ ...printOptions(scope), scope, bound, options })
        .then((done) => { if (done !== false && !options?.report) milestone(bound ? 'Printed for binding' : 'Printed') })
        .catch((error) => console.error('[print] failed:', error))
    },
    onExport: ({ format, scope, bound, options, path }) => {
      runExport({ ...printOptions(scope), format, scope, bound, options, path })
        .then((written) => { if (written) milestone(`Exported ${EXPORT_NAMES[format] || format}`) })
        .catch((error) => console.error('[export] failed:', error))
    },
    onExportAllEditions: () => {
      const scope = getPrintScope(props.projectName) === 'project' ? 'project' : 'folder'
      runExportAllEditions({ ...printOptions(scope), scope })
        .then((done) => { if (done?.written?.length) milestone(`Exported ${done.written.length} files for every edition`) })
        .catch((error) => console.error('[export] every edition failed:', error))
    },
    // A page of the book's own — a dedication — opened from the Book navigator.
    onOpenDoc: (path) => {
      setActiveDoc(path)
      setCurrentDoc(path)
    },
    onMeasure: ({ scope }) => {
      const { projectName, docPath } = printOptions(scope)
      measurePrint({ ...printOptions(scope), scope })
        .then((measured) => { if (measured) setMeasurement(projectName, scope, docPath, measured) })
        .catch((error) => console.error('[measure] failed:', error))
    },
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
    window.addEventListener('inkblot:import-script', onImport)
    return () => window.removeEventListener('inkblot:import-script', onImport)
  }, [activeDoc, currentDoc, importOpen, importProject, importRefresh])

  // File ▸ Page Setup….
  const [pageSetupOpen, setPageSetupOpen] = useState(false)
  useEffect(() => {
    const open = () => setPageSetupOpen(true)
    window.addEventListener('inkblot:page-setup', open)
    return () => window.removeEventListener('inkblot:page-setup', open)
  }, [])

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

  // Complete a queued search jump once the target document's editor is mounted
  // (retries briefly while the editor initializes).
  useEffect(() => {
    if (!pendingSearchTarget || pendingSearchTarget.docName !== currentDoc) return

    let cancelled = false
    let attempts = 0

    const tryJump = () => {
      if (cancelled) return
      const target = pendingSearchTargetRef.current
      if (!target || target.docName !== currentDoc) return

      if (!editor) {
        if (attempts < 8) {
          attempts += 1
          window.setTimeout(tryJump, 80)
        }
        return
      }

      jumpToText(
        target.note || {
          anchor: target.anchor,
          from: target.from,
          to: target.to,
        }
      )
      setPendingSearchTarget(null)
    }

    const timeoutId = window.setTimeout(tryJump, 100)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [currentDoc, editor, jumpToText, pendingSearchTarget])

  // Global "open-note" event: jump to the note's text and reveal it in the notes panel.
  useEffect(() => {
    const handler = e => {
      const noteId = typeof e.detail === 'string' ? e.detail : e.detail?.id
      const source = typeof e.detail === 'object' && e.detail !== null ? e.detail.source : null
      const note = (notesByDoc?.[currentDoc] || []).find(item => item.id === noteId)

      if (note && source !== 'editor-dot') {
        jumpToText(note)
      }

      openRightSidebarTab('notes')
      setTimeout(() => {
        const el = document.getElementById(`note-${noteId}`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 50)
    }

    window.addEventListener('open-note', handler)
    return () => window.removeEventListener('open-note', handler)
  }, [currentDoc, jumpToText, notesByDoc, openRightSidebarTab])

  const sidebarResizing = left.resizing || right.resizing

  // A canvas never draws its own toolbar: while no card is being edited it publishes
  // its state (NATIVE_CANVAS_TOOLBAR) and the canvas toolbar is drawn from that.
  const canvasToolbarTarget = comparing
    ? null
    : (activeIsCanvas && !toolbarEditor ? NATIVE_CANVAS_TOOLBAR : null)

  // The page's clearance at the top (`--app-titlebar-height`, which documents scroll
  // under): taller when the toolbar shows its labels.
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

  // The card's top-left holds only its pin button: the traffic lights go with the left
  // sidebar and never sit over the card.
  const cardLeftChrome = CARD_TOGGLE_WIDTH

  return (
    <CanvasToolbarSlotContext.Provider value={canvasToolbarTarget}>
    <CompareToolbarSlotContext.Provider value={comparing ? compareToolbarSlot : null}>
    <div
      className={`editor-page-wrapper${isFullscreenChrome ? ' is-fullscreen' : ''}${focusModeOpen ? ' is-focus-mode' : ''}${sidebarResizing ? ' is-sidebar-resizing' : ''}`}
      style={pageToolbarStyle}
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
          className={`document-card${left.pinned ? ' has-left-dock' : ''}${right.pinned ? ' has-right-dock' : ''}${left.gliding ? ' is-left-gliding' : ''}${right.gliding ? ' is-right-gliding' : ''}`}
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
            <div className="app-titlebar-toolbar">
              {comparing ? (
                <div className="canvas-toolbar-slot" ref={setCompareToolbarSlot} />
              ) : toolbarContext ? (
                <ToolbarHost
                  key={toolbarContext}
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
            focusModeOpen={focusModeOpen}
            onExitFocusMode={() => setFocusModeOpen(false)}
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

        {bubbles.open ? (
          <BubbleEditor
            key={bubbles.open.session.id}
            session={bubbles.open.session}
            onClose={bubbles.close}
          />
        ) : null}

        <NoteHoverPreview
          notesByDoc={props.notesByDoc}
          setNotesForDoc={props.setNotesForDoc}
          projectName={props.projectName}
        />


      </div>
    </div>
    </CompareToolbarSlotContext.Provider>
    </CanvasToolbarSlotContext.Provider>
  )
}
