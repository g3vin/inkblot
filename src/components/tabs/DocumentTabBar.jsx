/**
 * DocumentTabBar — the open documents, as tabs over the page column: Xcode's editor
 * tabs (DocumentTabBar.swift). One floating capsule, the selected tab lit, centred
 * over the column with a round + beside it; when the tabs no longer fit, the row
 * scrolls and keeps the selected one in sight.
 *
 * The tabs are the page's (`useTabs`, published as `tabsChanged`); this keeps no
 * list of its own and changes them only by command, so it never shows a state the
 * page does not have. Click a tab to show it; the ✕ that appears on hover closes it.
 * Drag a tab to reorder, or a document from the file tree onto the bar to open it in
 * a tab. A tab holding a split names both its documents, the first pane's first.
 * A locked document (docLocks.ts) wears a lock, and its menu locks and unlocks it.
 *
 * ⌘T opens a new tab, ⌘W closes the one showing, ⌘1–⌘9 pick one, and ⌃Tab / ⌃⇧Tab
 * go round them.
 */
import { useEffect, useRef } from 'react'
import { shellBridge, useLatestBridgeState } from '../../bridge'
import { FloatingCapsule, IconButton, usePointerReorder } from '../../ui'
import { moveTo } from '../../ui/usePointerReorder.js'
import { popUpNativeMenu } from '../../ui/useNativeMenu.js'
import Icon from '../../ui/Icon.jsx'
import { lockReason, toggleDocumentLock, useLocks } from '../../lib/docLocks'
import { adjacentTab, needsTabBar, tabIcon, tabName, tabTitle, useShowsTabBar } from './tabBarState.js'
import './DocumentTabBar.css'

const send = (type, payload) => shellBridge.send(type, payload)
const NO_TABS = { tabs: [] }

function tabMenu(tab, tabs, activeDoc, locks) {
  const canSplit = Boolean(tab.docPath && tab.docPath !== activeDoc)
  const index = tabs.findIndex((t) => t.id === tab.id)
  const lock = lockReason(tab.docPath, locks)
  return [
    { text: 'Open in split right', enabled: canSplit, action: () => send('openInSplit', { docPath: tab.docPath, orientation: 'columns' }) },
    { text: 'Open in split below', enabled: canSplit, action: () => send('openInSplit', { docPath: tab.docPath, orientation: 'rows' }) },
    { text: 'Move to new window', enabled: Boolean(tab.docPath), action: () => {
      send('openDocInWindow', { docPath: tab.docPath })
      send('closeTab', { tabId: tab.id })
    } },
    { separator: true },
    lock?.by === 'folder'
      ? { text: `Locked with “${lock.folder.split('/').pop()}”`, enabled: false }
      : { text: lock ? 'Unlock document' : 'Lock document', enabled: Boolean(tab.docPath), action: () => toggleDocumentLock(tab.docPath) },
    { separator: true },
    { text: 'Close tab', action: () => send('closeTab', { tabId: tab.id }) },
    { text: 'Close other tabs', enabled: tabs.length > 1, action: () => tabs.forEach((t) => t.id !== tab.id && send('closeTab', { tabId: t.id })) },
    { text: 'Close tabs to the right', enabled: index < tabs.length - 1, action: () => tabs.slice(index + 1).forEach((t) => send('closeTab', { tabId: t.id })) },
  ]
}

export default function DocumentTabBar({ activeDoc }) {
  const state = useLatestBridgeState('tabsChanged', NO_TABS)
  const shown = useShowsTabBar()
  const locks = useLocks()
  const listRef = useRef(null)
  const tabs = state?.tabs ?? []
  const activeTabId = state?.activeTabId
  const ids = tabs.map((tab) => tab.id)
  const { dragging, ghost, insertIndex, onPointerDown } = usePointerReorder({
    listRef,
    itemSelector: '[data-reorder-id]',
    axis: 'x',
    onDrop: ({ id, index, inside }) => {
      if (!inside || index == null) return
      const order = moveTo(ids, id, index)
      if (order.join() !== ids.join()) send('setTabOrder', { tabIds: order })
    },
  })

  // The selected tab stays in sight.
  useEffect(() => {
    if (!activeTabId) return
    listRef.current?.querySelector(`[data-reorder-id="${CSS.escape(activeTabId)}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [activeTabId, tabs.length])


  if (!shown || !needsTabBar(tabs)) return null
  const dragged = dragging ? tabs.find((tab) => tab.id === dragging) : null
  return (
    <div className="document-tab-bar" role="presentation">
      <FloatingCapsule className="document-tabs" role="tablist" aria-label="Open documents">
        <div ref={listRef} className="document-tabs-row">
          {tabs.map((tab, index) => {
            const selected = tab.id === activeTabId
            const title = tabTitle(tab, tabs)
            const second = tab.split && tab.secondaryDoc ? tabName(tab.secondaryDoc) : null
            return (
              <div
                key={tab.id}
                role="tab"
                tabIndex={selected ? 0 : -1}
                aria-selected={selected}
                aria-label={second ? `${title} ${tab.split === 'rows' ? 'above' : 'beside'} ${second}` : title}
                title={tab.docPath ?? 'A new tab'}
                className="document-tab"
                data-reorder-id={tab.id}
                data-selected={selected}
                data-dragging={dragging === tab.id}
                data-insert-before={insertIndex === index && dragging !== tab.id}
                onPointerDown={(event) => { if (!event.target.closest('.document-tab-close')) onPointerDown(event, tab.id) }}
                onClick={() => { if (!selected) send('selectTab', { tabId: tab.id }) }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                    const next = adjacentTab(tabs, tab.id, event.key === 'ArrowRight' ? 1 : -1)
                    if (next) send('selectTab', { tabId: next.id })
                  }
                  if (event.key === 'Delete' || event.key === 'Backspace') send('closeTab', { tabId: tab.id })
                }}
                onContextMenu={(event) => popUpNativeMenu(event, tabMenu(tab, tabs, activeDoc, locks))}
              >
                <button
                  type="button"
                  className="document-tab-close"
                  aria-label={`Close ${title}`}
                  title="Close tab"
                  tabIndex={-1}
                  onClick={(event) => { event.stopPropagation(); send('closeTab', { tabId: tab.id }) }}
                >
                  <Icon name="close" />
                </button>
                <Icon name={tabIcon(tab.docPath)} />
                <span className="document-tab-name">{title}</span>
                {lockReason(tab.docPath, locks) ? <Icon name="lock" className="document-tab-lock" label="Locked" /> : null}
                {second ? (
                  <>
                    <span className="document-tab-divider" aria-hidden="true">|</span>
                    <Icon name={tabIcon(tab.secondaryDoc)} />
                    <span className="document-tab-name">{second}</span>
                    {lockReason(tab.secondaryDoc, locks) ? <Icon name="lock" className="document-tab-lock" label="Locked" /> : null}
                  </>
                ) : null}
              </div>
            )
          })}
          {insertIndex === tabs.length ? <span className="document-tab-insert" aria-hidden="true" /> : null}
        </div>
      </FloatingCapsule>
      <IconButton icon="add" label="New tab" title="Open a new tab (⌘T)" size="circle" className="floating-capsule document-tab-new" onClick={() => send('newTab', {})} />
      {dragged && ghost ? (
        <FloatingCapsule className="document-tab-ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden="true">
          <Icon name={tabIcon(dragged.docPath)} />{tabTitle(dragged, tabs)}
        </FloatingCapsule>
      ) : null}
    </div>
  )
}
