import { useCallback, useEffect, useRef, useState } from 'react'
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window'
import EditorCanvas from './EditorCanvas'
import LeftSidebar from './LeftSidebar'
import RightSidebar from './RightSidebar/RightSidebar'
import { useResizableSidebar } from './hooks/useResizableSidebar'
import { useEditorContextMenu } from './hooks/useEditorContextMenu'
import Bubble from './Bubble'
import NoteHoverPreview from './NoteHoverPreview'
import Toolbar from './Toolbar'

const LEFT_SIDEBAR_OUTER_CHROME_WIDTH = 18
const RIGHT_SIDEBAR_OUTER_CHROME_WIDTH = 22

const getLiveEditor = (editor) => {
  if (!editor || editor.isDestroyed) return null
  if (!editor.state?.schema?.nodes) return null
  if (!editor.view || editor.view.isDestroyed) return null
  if (!editor.commands || typeof editor.chain !== 'function') return null
  return editor
}

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
  const titlebarLeftWidth = left.collapsed && !left.peeked
    ? 86
    : left.width + LEFT_SIDEBAR_OUTER_CHROME_WIDTH
  const titlebarRightWidth = right.collapsed && !right.peeked
    ? 0
    : right.width + RIGHT_SIDEBAR_OUTER_CHROME_WIDTH
  const toolbarEditor =
    getLiveEditor(activeEditor) ||
    getLiveEditor(editor) ||
    getLiveEditor(props.secondaryEditor)

  const handleTitlebarMouseDown = useCallback((event) => {
    if (event.button !== 0) return
    if (event.target instanceof Element && event.target.closest(WINDOW_DRAG_BLOCKER_SELECTOR)) {
      return
    }

    event.preventDefault()
    getCurrentWindow().startDragging().catch(error => {
      console.warn('Failed to start window drag:', error)
    })
  }, [])

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
      if (event.clientX < 52 || event.clientX > 76) return
      if (event.clientY < 8 || event.clientY > 34) return

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
  })

  const jumpToText = useCallback((noteOrAnchor) => {
    const currentEditor = activeEditor || editor
    if (!currentEditor) return

    const note = typeof noteOrAnchor === 'object' && noteOrAnchor !== null
      ? noteOrAnchor
      : null
    const anchor = typeof noteOrAnchor === 'string'
      ? noteOrAnchor
      : note?.anchor

    if (!anchor) return

    let from = Number.isFinite(note?.from) ? note.from : -1
    let to = Number.isFinite(note?.to) ? note.to : -1

    if (from === -1 || to === -1) {
      let foundPos = -1
      currentEditor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text.includes(anchor)) {
          foundPos = pos + node.text.indexOf(anchor)
          return false
        }
      })

      if (foundPos !== -1) {
        from = foundPos
        to = foundPos + anchor.length
      }
    }

    if (from !== -1) {
      currentEditor
        .chain()
        .focus()
        .setTextSelection({
          from,
          to: to > from ? to : from,
        })
        .scrollIntoView()
        .run()
    }
  }, [activeEditor, editor])

  const openSearchTarget = useCallback((target) => {
    if (!target) return

    const docName = target.docName || activeDoc || currentDoc
    if (!docName) return

    const normalizedTarget = {
      ...target,
      docName,
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

  return (
    <div
      className={`editor-page-wrapper${isFullscreenChrome ? ' is-fullscreen' : ''}${focusModeOpen ? ' is-focus-mode' : ''}`}
      onContextMenu={handleContextMenu}
    >
      <div
        className="app-titlebar"
        onMouseDownCapture={handleTitlebarMouseDown}
        style={{
          '--titlebar-left-width': `${titlebarLeftWidth}px`,
          '--titlebar-right-width': `${titlebarRightWidth}px`,
        }}
      >
        <div className="app-titlebar-spacer app-titlebar-spacer-left" data-tauri-drag-region />
        <div className="app-titlebar-toolbar">
          {toolbarEditor ? (
            <Toolbar editor={toolbarEditor} />
          ) : (
            <div className="toolbar-placeholder" data-tauri-drag-region />
          )}
        </div>
        <div className="app-titlebar-spacer app-titlebar-spacer-right" data-tauri-drag-region />
      </div>

      <div className="main-layout">

        <LeftSidebar
          width={left.width}
          onResize={left.start}
          resizing={left.resizing}
          collapsed={left.collapsed}
          peeked={left.peeked}
          pinned={left.pinned}
          togglePin={left.togglePin}
          onAutoCollapse={left.collapse}
          splitView={props.splitView}
          setSplitView={props.setSplitView}
          setSecondaryDoc={props.setSecondaryDoc}
          currentDoc={props.currentDoc}
          secondaryDoc={props.secondaryDoc}
          activeDoc={props.activeDoc}
          setActiveDoc={props.setActiveDoc}
          registerRefreshFiles={props.registerRefreshFiles}
          projectName={props.projectName}
          setProjectName={props.setProjectName}
          secondaryEditor={props.secondaryEditor}
          {...props}
        />

        <EditorCanvas
          {...props}
          focusModeOpen={focusModeOpen}
          onExitFocusMode={() => setFocusModeOpen(false)}
        />

        <RightSidebar
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
          clipboardHistory={props.clipboardHistory}
          clearClipboardHistory={props.clearClipboardHistory}
          onDropToClipboard={props.onDropToClipboard}
          activeDoc={props.activeDoc}
          projectName={props.projectName}

          jumpToText={jumpToText}
          onOpenSearchTarget={openSearchTarget}
        />

        {bubbleSentence ? (
          <Bubble
            sentence={bubbleSentence}
            onClose={() => setBubbleSentence(null)}
          />
        ) : null}

        <NoteHoverPreview
          notesByDoc={props.notesByDoc}
          setNotesForDoc={props.setNotesForDoc}
        />

      </div>
    </div>
  )
}
