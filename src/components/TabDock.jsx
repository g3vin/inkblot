/**
 * TabDock.jsx — the floating tab bar at the bottom of the workspace.
 *
 * Collapsed, it is a row of dots (one per open tab, in the manner of Apple's
 * Weather page indicator); hovered, it expands into named pills. A document
 * that is actually on screen always shows its name, split or not: its dot is
 * filled when it is in the primary pane and ringed when it is in the secondary.
 *
 * Splitting lives in the right-click menu (see useEditorContextMenu), not in
 * buttons here — the dock stays a row of dots.
 *
 * The leading + opens a draft tab — a tab with no document yet, which renders
 * DraftTabPane in the pane until the user picks what it should become.
 */
import { useEffect, useRef, useState } from 'react'
import SFIcon from './SFIcon'
import { getDocDisplayName, isCanvasDoc } from '../lib/docKind'
import { TAB_DOCK_DROP_DOC_EVENT, TREE_DRAG_END_EVENT, TREE_DRAG_START_EVENT } from '../lib/tabDockEvents'
import './TabDock.css'

export default function TabDock({
  style,
  tabs = [],
  activeTabId,
  currentDoc,
  secondaryDoc,
  splitView,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onDropDoc,
}) {
  const dockRef = useRef(null)
  const [hovered, setHovered] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const isSplit = splitView === 'editor' && Boolean(secondaryDoc)

  // A document dragged out of the file tree opens the dock, so the user has
  // something to aim at, and lights it up once the pointer is over it.
  useEffect(() => {
    const onDragStart = (event) => {
      if (event.detail?.type !== 'file') return
      setDragActive(true)
    }
    const onDragEnd = () => {
      setDragActive(false)
      setDragOver(false)
    }

    window.addEventListener(TREE_DRAG_START_EVENT, onDragStart)
    window.addEventListener(TREE_DRAG_END_EVENT, onDragEnd)
    return () => {
      window.removeEventListener(TREE_DRAG_START_EVENT, onDragStart)
      window.removeEventListener(TREE_DRAG_END_EVENT, onDragEnd)
    }
  }, [])

  useEffect(() => {
    if (!dragActive) return undefined

    const onMove = (event) => {
      const rect = dockRef.current?.getBoundingClientRect()
      if (!rect) return
      setDragOver(
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      )
    }

    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [dragActive])

  // The tree hit-tests the dock on mouseup and hands the document over here.
  useEffect(() => {
    const dock = dockRef.current
    if (!dock) return undefined

    const onDrop = (event) => {
      const path = event.detail?.path
      if (path) onDropDoc?.(path)
    }

    dock.addEventListener(TAB_DOCK_DROP_DOC_EVENT, onDrop)
    return () => dock.removeEventListener(TAB_DOCK_DROP_DOC_EVENT, onDrop)
  }, [onDropDoc])

  const expanded = hovered || dragOver

  return (
    <div
      ref={dockRef}
      style={style}
      className={[
        'tab-dock',
        expanded ? 'is-expanded' : '',
        dragActive ? 'is-drag-armed' : '',
        dragOver ? 'is-drag-over' : '',
      ].filter(Boolean).join(' ')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role="tablist"
      aria-label="Open documents"
    >
      <div className="tab-dock-rail">
        {tabs.length === 0 ? (
          <span className="tab-dock-hint">Drag a file here to open it in a tab</span>
        ) : (
          tabs.map((tab) => {
            const isDraft = !tab.docPath
            const inPrimary = Boolean(tab.docPath) && tab.docPath === currentDoc
            const inSecondary = isSplit && tab.docPath === secondaryDoc
            const isActive = isDraft ? tab.id === activeTabId : inPrimary
            // A document on screen — in either pane — keeps its name showing
            // without the dock being hovered. Everything else stays a dot.
            const isOpen = inPrimary || inSecondary || (isDraft && isActive)
            const label = isDraft ? 'New Tab' : getDocDisplayName(tab.docPath)

            return (
              <div
                key={tab.id}
                className={[
                  'tab-dot',
                  isActive ? 'is-active' : '',
                  inSecondary ? 'is-secondary' : '',
                  isDraft ? 'is-draft' : '',
                  isOpen ? 'is-open' : '',
                  tab.ephemeral ? 'is-ephemeral' : '',
                ].filter(Boolean).join(' ')}
                data-tab-id={tab.id}
                data-tab-doc={tab.docPath || ''}
              >
                <button
                  type="button"
                  className="tab-dot-button"
                  role="tab"
                  aria-selected={isActive}
                  title={tab.docPath || 'New tab'}
                  onClick={() => onSelectTab?.(tab.id)}
                  onAuxClick={(event) => {
                    if (event.button === 1) onCloseTab?.(tab.id)
                  }}
                >
                  <span className="tab-dot-mark">
                    <SFIcon
                      name={isDraft ? 'plus' : isCanvasDoc(tab.docPath) ? 'canvas' : 'doc.text'}
                      size={13}
                    />
                  </span>
                  <span className="tab-dot-label">{label}</span>
                </button>

                <button
                  type="button"
                  className="tab-dot-close"
                  title="Close tab"
                  aria-label={`Close ${label}`}
                  onClick={() => onCloseTab?.(tab.id)}
                >
                  <SFIcon name="xmark" size={11} strokeWidth={1.6} />
                </button>
              </div>
            )
          })
        )}
      </div>

      <button
        type="button"
        className="tab-dock-new"
        onClick={onNewTab}
        title="New tab"
        aria-label="New tab"
      >
        <SFIcon name="plus" size={14} strokeWidth={1.6} />
      </button>
    </div>
  )
}
