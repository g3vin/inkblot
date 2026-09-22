/**
 * EditorLayout.jsx — main workspace layout.
 *
 * Arranges the titlebar/toolbar, left sidebar (file tree), editor canvas,
 * and right sidebar around the state owned by Editor.jsx. Also hosts
 * cross-cutting UI behaviors: the custom window-drag titlebar, fullscreen
 * chrome detection, the right-click context menu, "jump to text" for notes
 * and search results, and the analytic Bubble overlay.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { resolveAnchor } from '../bridge/anchors'
import { documentSurface, useBridgeState } from '../bridge'
import { EditorTarget } from '../types'

/** A stable identity, so useBridgeState's initial value is not a new object each render. */
const EMPTY_ACTIVE_EDITOR = {}
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window'
import { nativeOwns } from '../lib/host'
import { useNativeSidebar } from './useNativeSidebar'
import { useNativeNotePreviews } from './useNativeNotePreviews'
import EditorCanvas from './EditorCanvas'
import LeftSidebar from './LeftSidebar'
import RightSidebar from './RightSidebar/RightSidebar'
import { useResizableSidebar } from '../hooks/useResizableSidebar'
import { useEditorContextMenu } from '../hooks/useEditorContextMenu'
import { isCanvasDoc } from '../lib/docKind'
import { requestCanvasReveal } from '../canvas/canvasEvents'
import { CanvasToolbarSlotContext } from '../canvas/canvasToolbarSlot'
import { CompareToolbarSlotContext } from './compareToolbarSlot'
import Bubble from './Bubble'
import NoteHoverPreview from './NoteHoverPreview'
import TabDock from './TabDock'
import Toolbar from './Toolbar'

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
].join(',')

export default function EditorLayout(props) {
  const left = useResizableSidebar(200, 180, 300, 'left')
  const right = useResizableSidebar(300, 280, 500, 'right')
  const { setSidebarTab } = props
  // Use splitView/secondaryDoc from props (managed at top-level `Editor`) to avoid
  // shadowing state and keep all parts of the UI in sync.
  const [bubbleSentence, setBubbleSentence] = useState(null)
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
  // Under the Swift shell there is no titlebar row: this page's toolbar is the top of
  // the window, and the shell says how much of its left end the traffic lights cover.
  const [nativeTitlebarInset, setNativeTitlebarInset] = useState(0)
  const [nativeTitlebarTrailing, setNativeTitlebarTrailing] = useState(0)
  useEffect(() => {
    if (!nativeWindowChrome) return undefined
    return documentSurface.onCommand('setTitlebarInset', ({ leading, trailing }) => {
      setNativeTitlebarInset(Math.max(0, Number(leading) || 0))
      setNativeTitlebarTrailing(Math.max(0, Number(trailing) || 0))
    })
  }, [nativeWindowChrome])
  const titlebarLeftWidth = nativeFileTree
    ? (nativeWindowChrome ? nativeTitlebarInset : 86)
    : left.collapsed && !left.peeked
      ? 86
      : left.width + LEFT_SIDEBAR_OUTER_CHROME_WIDTH
  const nativeRightSidebar = nativeOwns('rightSidebar')
  const nativeToolbar = nativeOwns('toolbar')
  const nativeNotePreviews = nativeOwns('notePreviews')
  useNativeNotePreviews({ enabled: nativeNotePreviews })
  const titlebarRightWidth = nativeRightSidebar ? nativeTitlebarTrailing : right.collapsed && !right.peeked
    ? 0
    : right.width + RIGHT_SIDEBAR_OUTER_CHROME_WIDTH
  // On a canvas, the only editor the Toolbar may drive is a card's own editor.
  // Falling back to the pane's TipTap editors would point the Toolbar at an idle
  // instance holding no document.
  //
  // Which one that is used to be read off the editor object as `__inkblotCanvasCard`
  // — a property set by the card and read here, across what becomes a process
  // boundary in Phase 5. The election result arrives as a protocol event now, and
  // `canvasCard` is one of the three names it can carry (sharp edge #5). The live
  // editor below is still resolved locally, because the dictation and read-aloud
  // controls inside the Toolbar genuinely need the instance.
  const activeEditorInfo = useBridgeState('activeEditorChanged', EMPTY_ACTIVE_EDITOR)
  const activeIsCanvas = isCanvasDoc(activeDoc || currentDoc)
  // The titlebar element the active canvas portals its toolbar into. A ref
  // callback rather than a ref object, so mounting/unmounting the slot re-renders
  // the consumers that are waiting for it.
  const [canvasToolbarSlot, setCanvasToolbarSlot] = useState(null)
  const [compareToolbarSlot, setCompareToolbarSlot] = useState(null)
  const liveActiveEditor = getLiveEditor(activeEditor)
  const toolbarEditor = activeIsCanvas
    ? (activeEditorInfo.target === EditorTarget.CanvasCard ? liveActiveEditor : null)
    : (liveActiveEditor || getLiveEditor(editor) || getLiveEditor(props.secondaryEditor))

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
    setBubbleSentence,
    onEnterFocusMode: () => setFocusModeOpen(true),
    onOpenDocInTab: props.onOpenDocInTab,
    onOpenDocInSplit: props.onOpenDocInSplit,
    onCloseTab: props.onCloseTab,
    onCloseOtherTabs: props.onCloseOtherTabs,
    onCloseTabsToTheRight: props.onCloseTabsToTheRight,
    onCloseAllTabs: props.onCloseAllTabs,
    onCloseSplit: props.onCloseSplit,
    onKeepTab: props.onKeepTab,
    onSelectTab: props.onSelectTab,
  })

  // Renaming and creating happen in the tree's own inline text box, which is no
  // use if the sidebar is collapsed — and these actions are reachable from the
  // dock and the editor, where it usually is.
  const openLeftSidebar = left.open
  useEffect(() => {
    const reveal = () => openLeftSidebar?.()
    window.addEventListener('filetree:new-entry', reveal)
    return () => window.removeEventListener('filetree:new-entry', reveal)
  }, [openLeftSidebar])

  // Select and scroll to a note's text in the active editor. Accepts a note object
  // (which carries stored from/to) or a plain anchor string.
  //
  // This used to do the anchor-fallback dance by hand, and one of the two places the
  // handoff points at for sharp edge #3. It now goes through `resolveAnchor`, which
  // is the same dance with one difference that matters: it *verifies* that the stored
  // positions still cover the anchor text before trusting them, where this trusted any
  // pair of finite numbers. A note whose positions went stale used to put the caret on
  // whatever had moved into that range.
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
  // toolbar. The page still has a toolbar row to offer in two cases — a canvas's own
  // toolbar, and a version comparison's — and draws the row only then; otherwise it
  // collapses to nothing and the document starts right under the native toolbar.
  const pageToolbarRow = !nativeToolbar || comparing || (activeIsCanvas && !toolbarEditor)

  return (
    <CanvasToolbarSlotContext.Provider value={comparing ? null : canvasToolbarSlot}>
    <CompareToolbarSlotContext.Provider value={comparing ? compareToolbarSlot : null}>
    <div
      className={`editor-page-wrapper${isFullscreenChrome ? ' is-fullscreen' : ''}${focusModeOpen ? ' is-focus-mode' : ''}${sidebarResizing ? ' is-sidebar-resizing' : ''}`}
      style={pageToolbarRow ? undefined : { '--app-titlebar-height': '0px' }}
      onContextMenu={handleContextMenu}
    >
      {pageToolbarRow ? <div
        className="app-titlebar"
        style={{
          '--titlebar-left-width': `${nativeToolbar ? 0 : titlebarLeftWidth}px`,
          '--titlebar-right-width': `${nativeToolbar ? 0 : titlebarRightWidth}px`,
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
          ) : toolbarEditor && !nativeToolbar ? (
            <Toolbar editor={toolbarEditor} />
          ) : activeIsCanvas ? (
            <div className="canvas-toolbar-slot" ref={setCanvasToolbarSlot} />
          ) : (
            <div className="toolbar-placeholder" data-tauri-drag-region />
          )}
        </div>
      </div> : null}

      <div className={`main-layout${activeIsCanvas ? ' is-canvas-underlay' : ''}`}>

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

        {bubbleSentence ? (
          <Bubble
            sentence={bubbleSentence}
            onClose={() => setBubbleSentence(null)}
          />
        ) : null}

        {nativeNotePreviews ? null : <NoteHoverPreview
          notesByDoc={props.notesByDoc}
          setNotesForDoc={props.setNotesForDoc}
          projectName={props.projectName}
        />}

        <TabDock
          // The dock centers on the editor area, not the window: the sidebars are
          // in-flow, so it shifts by half their difference to stay over the page.
          style={{ '--tab-dock-offset': `${(titlebarLeftWidth - titlebarRightWidth) / 2}px` }}
          tabs={props.tabs}
          activeTabId={props.activeTabId}
          currentDoc={props.currentDoc}
          secondaryDoc={props.secondaryDoc}
          splitView={props.splitView}
          onSelectTab={props.onSelectTab}
          onCloseTab={props.onCloseTab}
          onNewTab={props.onNewTab}
          onDropDoc={props.onOpenDocInTab}
        />

      </div>
    </div>
    </CompareToolbarSlotContext.Provider>
    </CanvasToolbarSlotContext.Provider>
  )
}
