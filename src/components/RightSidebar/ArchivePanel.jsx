/**
 * ArchivePanel.jsx — a document's archive, opened from the inspector's foot over
 * whichever panel is showing.
 *
 * Everything archived out of the document (`lib/archiveStore.js`), newest first, each
 * with its kind, when it was archived, Restore and Delete. For now the only kind is a
 * bubble session; the list is meant for anything that gets put aside.
 */
import { useCallback, useEffect, useState } from 'react'
import { ARCHIVE_CHANGED_EVENT, getArchive, removeArchivedItem } from '../../lib/archiveStore'
import { formatFullTimestamp } from '../../lib/versionHistory'
import { restoreArchivedItem } from '../../lib/archiveRestore'
import Icon from '../../ui/Icon.jsx'
import { EmptyState } from '../../ui/Surfaces.jsx'
import { SkeletonRows } from '../../ui/Reveal.jsx'
import { staggerStyle, useReveal } from '../../ui/revealState.js'
import './HistoryPanel.css'

const KIND_LABELS = { bubble: 'Bubble' }

/** An archive box, for the button that opens this. */
export function ArchiveIcon({ size = 14 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="5" rx="1.5" />
        <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" />
      </g>
    </svg>
  )
}

export default function ArchivePanel({ projectName, docName, editor, backLabel, onBack }) {
  const [items, setItems] = useState([])
  const [missing, setMissing] = useState(null)
  // Whose archive `items` is, so "Nothing archived" is said only once it is known.
  const [readFor, setReadFor] = useState(null)

  const refresh = useCallback(async () => {
    const next = await getArchive(projectName, docName)
    setItems(next)
    setReadFor(`${projectName}::${docName}`)
  }, [projectName, docName])
  const ready = readFor === `${projectName}::${docName}`
  const listReveal = useReveal(ready, { gated: false })

  useEffect(() => {
    void refresh()
    const onChanged = (event) => {
      const { projectName: project, docName: doc } = event?.detail || {}
      if (project === projectName && doc === docName) void refresh()
    }
    window.addEventListener(ARCHIVE_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(ARCHIVE_CHANGED_EVENT, onChanged)
  }, [projectName, docName, refresh])

  const restore = async (item) => {
    if (editor && restoreArchivedItem(editor, item)) {
      setMissing(null)
      await removeArchivedItem(projectName, docName, item.id)
    } else {
      setMissing(item.id)
    }
  }

  return (
    <div className="history-archive">
      <div className="history-toolbar">
        <button
          type="button"
          className="panel-action-btn panel-action-btn-small"
          onClick={onBack}
          title={`Back to ${backLabel}`}
        >
          <Icon name="chevron-left" />
          {backLabel}
        </button>
        <span className="history-archive-title">Archive</span>
      </div>
      {!ready || listReveal.phase === 'hidden' ? (
        <div className="ib-skeleton-host history-skeleton" data-visible={listReveal.skeleton ? 'true' : 'false'} aria-busy="true">
          <SkeletonRows count={3} />
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon="archive" title="Nothing archived." hint="Things you put away out of this document, like a bubble, are kept here." />
      ) : (
        <div className="sidebar-list history-list ib-stagger" data-reveal={listReveal.phase}>
          {items.map((item, index) => (
            <div key={item.id} className="history-archive-item" style={staggerStyle(index)}>
              <div className="history-archive-meta">
                <span className="history-archive-kind">{KIND_LABELS[item.kind] ?? item.kind}</span>
                <span className="history-timestamp">{formatFullTimestamp(item.archivedAt)}</span>
              </div>
              <div className="history-archive-text">{item.title || 'Untitled'}</div>
              {missing === item.id ? (
                <div className="history-archive-note">The sentence isn’t in the document any more, so it can’t go back.</div>
              ) : null}
              <div className="history-archive-actions">
                <button
                  type="button"
                  className="panel-action-btn panel-action-btn-small"
                  onClick={() => void restore(item)}
                  disabled={!editor}
                  title="Put it back into the document"
                >
                  Restore
                </button>
                <button
                  type="button"
                  className="panel-action-btn panel-action-btn-small panel-icon-btn"
                  onClick={() => void removeArchivedItem(projectName, docName, item.id)}
                  title="Delete it for good"
                  aria-label="Delete"
                >
                  <Icon name="delete" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
