/**
 * EditorLayout.jsx — main workspace layout.
 *
 * Arranges the titlebar/toolbar, left sidebar (file tree), editor canvas,
 * and right sidebar around the state owned by Editor.jsx. Also hosts
 * cross-cutting UI behaviors: the custom window-drag titlebar, fullscreen
 * chrome detection, the right-click context menu, "jump to text" for notes
 * and search results, and the Bubble editor.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { resolveAnchor } from '../bridge/anchors'
import { documentSurface, useBridgeEvent, useBridgeState, useLatestBridgeState } from '../bridge'
import { EditorTarget } from '../types'

/** A stable identity, so useBridgeState's initial value is not a new object each render. */
const EMPTY_ACTIVE_EDITOR = {}
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window'
import { nativeOwns } from '../lib/host'
import { useNativeSidebar } from '../hooks/useNativeSidebar'
import { useNativeNotePreviews } from '../hooks/useNativeNotePreviews'
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
const EXPORT_NAMES = { pdf: 'PDF', epub: 'EPUB', docx: 'Word', html: 'HTML', markdown: 'Markdown', plainText: 'Plain Text', fountain: 'Fountain', fdx: 'Final Draft' }
const milestone = (label) => window.dispatchEvent(new CustomEvent(TYPESET_MILESTONE_EVENT, { detail: { label } }))
import LeftSidebar from './LeftSidebar'
import RightSidebar from './RightSidebar/RightSidebar'
import { useResizableSidebar } from '../hooks/useResizableSidebar'
import { useEditorContextMenu } from '../hooks/useEditorContextMenu'
import { isCanvasDoc, isMapDoc, isTextDoc } from '../lib/docKind'
import { requestCanvasReveal } from '../canvas/canvasEvents'
import { requestMapReveal } from '../map/mapEvents'
import { CanvasToolbarSlotContext, NATIVE_CANVAS_TOOLBAR } from '../canvas/canvasToolbarSlot'
import { PanelInsetsContext } from '../map/panelInsets'
import { CompareToolbarSlotContext } from './compareToolbarSlot'
import BubbleEditor from './bubble/BubbleEditor'
import { useBubbleSessions } from '../hooks/useBubbleSessions'
import { useDocumentArchive } from '../hooks/useDocumentArchive'
import { useReferences } from '../hooks/useReferences'
import NoteHoverPreview from './NoteHoverPreview'
import ToolbarHost from './toolbar/ToolbarHost'
import { readDisplayMode, TOOLBAR_LAYOUT_CHANGED } from './toolbar/useToolbarLayout'
import { CUSTOMIZE_INSPECTOR_EVENT, popUpToolbarMenu } from '../hooks/contextMenu/toolbarMenu'
import InspectorLayoutEditor from './RightSidebar/InspectorLayoutEditor'
import { setInspectorOpen } from '../lib/inspectorPresence'

const LEFT_SIDEBAR_OUTER_CHROME_WIDTH = 18
const RIGHT_SIDEBAR_OUTER_CHROME_WIDTH = 22

// The macOS traffic lights sit inside the left sidebar's top-left corner; their
// origin is `trafficLightPosition` in tauri.conf.json. macOS spaces the three
// 12px buttons 20px apart, so the green (fullscreen) one starts 40px in. The
// box is padded a few px so a click near its edge still counts.
const TRAFFIC_LIGHT_ORIGIN = { x: 20, y: 30 }
const TRAFFIC_LIGHT_DIAMETER = 12
const FULLSCREEN_BUTTON_BOX = {
  left: TRAFFIC_LIGHT_ORIGIN.x + 36,
  right: TRAFFIC_LIGHT_ORIGIN.x + 58,
  top: TRAFFIC_LIGHT_ORIGIN.y - 8,
  bottom: TRAFFIC_LIGHT_ORIGIN.y + 20,
}

// Drag strip, as in Apple's own apps: a full-width band centered on the traffic
// lights, reaching from the top of the window to as far below their centers as
// the window top is above them.
const TRAFFIC_LIGHT_CENTER_Y = TRAFFIC_LIGHT_ORIGIN.y + TRAFFIC_LIGHT_DIAMETER / 2
const WINDOW_DRAG_STRIP_HEIGHT = TRAFFIC_LIGHT_CENTER_Y * 2

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
  // Under the Swift shell the file tree and the traffic lights are both outside the
  // page, so nothing on the left needs room made for it.
  const nativeFileTree = nativeOwns('fileTree')
  const nativeWindowChrome = nativeOwns('windowChrome')
  // The shell's sidebars float over this page instead of beside it, so a canvas runs on
  // underneath them. The shell says how much of each side they cover; the toolbar and a
  // document's text keep clear of that.
  //
  // The window toolbar floats over the page the same way, and `top` is its band: the
  // page runs up under it so the toolbar's glass has the document behind it.
  const [nativePanelInsets, setNativePanelInsets] = useState({ leading: 0, trailing: 0, top: 0 })
  useEffect(() => {
    if (!nativeWindowChrome) return undefined
    return documentSurface.onCommand('setPanelInsets', ({ leading, trailing, top }) => {
      setNativePanelInsets({
        leading: Math.max(0, Number(leading) || 0),
        trailing: Math.max(0, Number(trailing) || 0),
        top: Math.max(0, Number(top) || 0),
      })
    })
  }, [nativeWindowChrome])
  const titlebarLeftWidth = nativeFileTree
    ? (nativeWindowChrome ? nativePanelInsets.leading : 86)
    : left.collapsed && !left.peeked
      ? 86
      : left.width + LEFT_SIDEBAR_OUTER_CHROME_WIDTH
  const nativeRightSidebar = nativeOwns('rightSidebar')
  const nativeToolbar = nativeOwns('toolbar')
  // The toolbar's Focus Mode item. The mode stays this page's; the toolbar asks for it
  // and lights its button from what is published back.
  useEffect(() => documentSurface.onCommand('setFocusMode', ({ open }) => setFocusModeOpen(Boolean(open))), [])
  useEffect(() => {
    documentSurface.publishViewOptions({ focusMode: focusModeOpen })
  }, [focusModeOpen])
  const nativeNotePreviews = nativeOwns('notePreviews')
  useNativeNotePreviews({ enabled: nativeNotePreviews })
  const bubbles = useBubbleSessions({ docPath: activeDoc || currentDoc, projectName: props.projectName })
  useDocumentArchive({
    projectName: props.projectName,
    docPath: activeDoc || currentDoc,
    // The editor showing a document, for putting something back into it.
    editorFor: (path) => (path === activeDoc && activeEditor) || (path === currentDoc ? editor : null),
  })
  // Citations format in every open editor; the References panel is the shell's.
  useReferences({
    projectName: props.projectName,
    activeDoc: activeDoc || currentDoc,
    panes: [
      { editor, path: currentDoc },
      { editor: props.secondaryEditor, path: props.secondaryDoc },
    ],
  })
  const titlebarRightWidth = nativeRightSidebar
    ? nativePanelInsets.trailing
    : right.collapsed && !right.peeked
    ? 0
    : right.width + RIGHT_SIDEBAR_OUTER_CHROME_WIDTH
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
  // A canvas or a map pans instead of scrolling, and runs on under the sidebars — when
  // it has the editor to itself. In a split both panes keep the document's column
  // whichever is active, or hovering from one to the other would slide the other one
  // under the sidebars and the toolbar and back.
  const activeUnderlays = !isTextDoc(activeDoc || currentDoc) && props.splitView !== 'editor'
  const [compareToolbarSlot, setCompareToolbarSlot] = useState(null)
  const liveActiveEditor = getLiveEditor(activeEditor)
  const toolbarEditor = activeIsCanvas
    ? (activeEditorInfo.target === EditorTarget.CanvasCard ? liveActiveEditor : null)
    : (liveActiveEditor || getLiveEditor(editor) || getLiveEditor(props.secondaryEditor))

  // Which toolbar is up: a canvas's own while no card is being edited, a map's, the
  // Typeset toolbar for a document in Typeset mode, else the document's.
  const pageLayoutState = useLatestBridgeState('pageLayoutState', null)
  const activeIsMap = isMapDoc(activeDoc || currentDoc)
  const toolbarContext = activeIsCanvas
    ? (toolbarEditor ? 'document' : 'canvas')
    : activeIsMap
      ? 'map'
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
  //
  // Not under a native toolbar: the window's own toolbar is what drags it then, and
  // the top of this page is document.
  useEffect(() => {
    if (nativeToolbar) return undefined
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
  }, [nativeToolbar])

  // Track (and predict) fullscreen state so the layout can restyle its chrome.
  // macOS reports fullscreen late during the animation, so we also treat
  // near-monitor-sized windows and clicks on the green traffic-light button as
  // fullscreen, then re-sync with the real state once things settle.
  //
  // Under a real titlebar none of this applies — and the traffic-light hit box below
  // would land on the toolbar's first buttons, flipping the chrome on ordinary clicks.
  useEffect(() => {
    if (nativeWindowChrome) return undefined
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
      if (event.clientX < FULLSCREEN_BUTTON_BOX.left || event.clientX > FULLSCREEN_BUTTON_BOX.right) return
      if (event.clientY < FULLSCREEN_BUTTON_BOX.top || event.clientY > FULLSCREEN_BUTTON_BOX.bottom) return

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
  }, [nativeWindowChrome])

  useEffect(() => {
    pendingSearchTargetRef.current = pendingSearchTarget
  }, [pendingSearchTarget])

  // Under the Swift shell the sidebar is native, so "show the notes tab" is a request
  // to the shell rather than something this page can do.
  const openRightSidebarTab = useCallback((tab) => {
    setSidebarTab(tab)
    if (nativeRightSidebar) {
      documentSurface.publishShowSidebarTab({ tab })
      return
    }
    openRightSidebar()
  }, [nativeRightSidebar, setSidebarTab, openRightSidebar])

  // A panel the page asks for (a citation ⌥-clicked: References) comes up.
  useBridgeEvent('showSidebarTab', ({ tab }) => { if (!nativeRightSidebar && tab) openRightSidebarTab(tab) })

  // The toolbar's panel items: show a panel, or hide the inspector if it is showing.
  const rightOpen = !right.collapsed || right.peeked
  const togglePanel = useCallback((tab) => {
    if (!nativeRightSidebar && rightOpen && props.sidebarTab === tab) {
      right.collapse()
      return
    }
    openRightSidebarTab(tab)
  }, [nativeRightSidebar, rightOpen, props.sidebarTab, right, openRightSidebarTab])
  useEffect(() => { setInspectorOpen(!nativeRightSidebar && rightOpen) }, [nativeRightSidebar, rightOpen])
  const toolbarPanel = useMemo(
    () => ({ tab: props.sidebarTab, open: rightOpen, toggle: togglePanel }),
    [props.sidebarTab, rightOpen, togglePanel]
  )

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

  // The page's own Page Setup, for a shell that does not draw one (host.ts).
  const [pageSetupOpen, setPageSetupOpen] = useState(false)
  useEffect(() => {
    if (nativeOwns('pageSetup')) return undefined
    const open = () => setPageSetupOpen(true)
    window.addEventListener('inkblot:page-setup', open)
    return () => window.removeEventListener('inkblot:page-setup', open)
  }, [])

  useNativeSidebar({
    enabled: nativeRightSidebar,
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

  // Under the Swift shell the formatting toolbar is native, in the window's own
  // toolbar, and so is a canvas's: it takes the formatting toolbar's place while no
  // card is being edited (NATIVE_CANVAS_TOOLBAR tells the canvas to publish its state
  // rather than render it). The page still draws a toolbar row for a version
  // comparison; otherwise the row collapses to nothing and the document starts right
  // under the native toolbar.
  const pageToolbarRow = !nativeToolbar || comparing
  // A canvas never draws its own toolbar: while no card is being edited it publishes
  // its state (NATIVE_CANVAS_TOOLBAR) and the canvas toolbar is drawn from that.
  const canvasToolbarTarget = comparing
    ? null
    : (activeIsCanvas && !toolbarEditor ? NATIVE_CANVAS_TOOLBAR : null)

  // The page's clearance at the top (`--app-titlebar-height`, which documents scroll
  // under). Under a native toolbar it is the toolbar's band, and a comparison's own row
  // sits below that band (`--native-toolbar-inset` pads the row down).
  const pageToolbarStyle = !nativeToolbar
    ? (toolbarDisplay === 'iconAndLabel' ? { '--app-titlebar-height': '56px' } : undefined)
    : pageToolbarRow
      ? {
          '--native-toolbar-inset': `${nativePanelInsets.top}px`,
          '--app-titlebar-height': `calc(44px + ${nativePanelInsets.top}px)`,
        }
      : { '--app-titlebar-height': `${nativePanelInsets.top}px` }

  return (
    <PanelInsetsContext.Provider value={nativePanelInsets}>
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
      {customizingInspector && !nativeRightSidebar ? (
        <InspectorLayoutEditor onClose={() => setCustomizingInspector(false)} />
      ) : null}
      {pageToolbarRow ? <div
        onContextMenu={comparing ? undefined : popUpToolbarMenu}
        className="app-titlebar"
        style={{
          '--titlebar-left-width': `${titlebarLeftWidth}px`,
          '--titlebar-right-width': `${titlebarRightWidth}px`,
        }}
      >
        {/* One slot, four states, in precedence order: a comparison takes the
            titlebar outright (portaled in by VersionComparePane), else a card being
            edited gets the text Toolbar, else a canvas gets its own toolbar
            (portaled in by the active CanvasSurface), else a plain document gets
            the text Toolbar. */}
        <div className="app-titlebar-toolbar">
          {comparing ? (
            <div className="canvas-toolbar-slot" ref={setCompareToolbarSlot} />
          ) : !nativeToolbar && toolbarContext ? (
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
        </div>
      </div> : null}

      <div
        className={`main-layout${activeUnderlays ? ' is-canvas-underlay' : ''}${nativeToolbar ? ' is-under-native-toolbar' : ''}`}
        style={{
          '--panel-inset-left': `${nativePanelInsets.leading}px`,
          '--panel-inset-right': `${nativePanelInsets.trailing}px`,
        }}
      >

        {nativeFileTree ? null : <LeftSidebar
          {...props}
          width={left.width}
          onResize={left.start}
          resizing={left.resizing}
          collapsed={left.collapsed}
          peeked={left.peeked}
          pinned={left.pinned}
          togglePin={left.togglePin}
          onAutoCollapse={left.collapse}
        />}

        <EditorCanvas
          {...props}
          focusModeOpen={focusModeOpen}
          onExitFocusMode={() => setFocusModeOpen(false)}
        />

        {nativeRightSidebar ? null : <RightSidebar
          width={right.width}
          onResize={right.start}
          resizing={right.resizing}
          collapsed={right.collapsed}
          peeked={right.peeked}
          pinned={right.pinned}
          togglePin={right.togglePin}
          onAutoCollapse={right.collapse}

          sidebarTab={props.sidebarTab}
          setSidebarTab={openRightSidebarTab}

          tiles={props.tiles}
          setTiles={props.setTiles}
          notes={props.notes}
          setNotes={props.setNotes}
          notesByDoc={props.notesByDoc}

          editor={props.editor}
          activeEditor={props.activeEditor}
          secondaryEditor={props.secondaryEditor}
          currentDoc={props.currentDoc}
          secondaryDoc={props.secondaryDoc}

          versions={props.versions}
          setVersions={props.setVersions}
          onOpenCompare={props.openCompare}
          clipboardHistory={props.clipboardHistory}
          clearClipboardHistory={props.clearClipboardHistory}
          onDropToClipboard={props.onDropToClipboard}
          activeDoc={props.activeDoc}
          projectName={props.projectName}

          jumpToText={jumpToText}
          onOpenSearchTarget={openSearchTarget}

          refreshFiles={props.refreshFiles}
          onOpenDocInTab={props.onOpenDocInTab}
        />}

        {bubbles.open ? (
          <BubbleEditor
            key={bubbles.open.session.id}
            session={bubbles.open.session}
            onClose={bubbles.close}
          />
        ) : null}

        {nativeNotePreviews ? null : <NoteHoverPreview
          notesByDoc={props.notesByDoc}
          setNotesForDoc={props.setNotesForDoc}
          projectName={props.projectName}
        />}


      </div>
    </div>
    </CompareToolbarSlotContext.Provider>
    </CanvasToolbarSlotContext.Provider>
    </PanelInsetsContext.Provider>
  )
}
