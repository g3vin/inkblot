/**
 * ArchivePanel.jsx — a document's archive, opened from the History tab.
 *
 * Everything archived out of the document (`lib/archiveStore.js`), newest first, each
 * with its kind, when it was archived, Restore and Delete. For now the only kind is a
 * bubble session; the list is meant for anything that gets put aside.
 */
import { useCallback, useEffect, useState } from 'react'
import { ARCHIVE_CHANGED_EVENT, getArchive, removeArchivedItem } from '../../lib/archiveStore'
import { formatFullTimestamp } from '../../lib/versionHistory'
import { restoreArchivedItem } from '../../lib/archiveRestore'
import SFIcon from '../SFIcon'

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

export default function ArchivePanel({ projectName, docName, editor, onBack }) {
  const [items, setItems] = useState([])
  const [missing, setMissing] = useState(null)

  const refresh = useCallback(async () => {
    setItems(await getArchive(projectName, docName))
  }, [projectName, docName])

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
          title="Back to the document's versions"
        >
          <SFIcon name="chevron.left" size={12} />
          History
        </button>
        <span className="history-archive-title">Archive</span>
      </div>
      {items.length === 0 ? (
        <div className="notes-empty">Nothing archived. Things you archive — like a bubble — are kept here.</div>
      ) : (
        <div className="sidebar-list history-list">
          {items.map((item) => (
            <div key={item.id} className="history-archive-item">
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
                  <SFIcon name="trash" size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
