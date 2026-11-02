/**
 * HistoryPanel.jsx — the History tab of the right sidebar.
 *
 * The full version-control surface for a document (text, canvas or map):
 *   - a condensed timeline: day sections, then bursts of edits grouped by time
 *     and editing session (color-coded dot), expandable to individual checkpoints
 *   - named versions ("First Draft", "Final Submission") with a filter to show
 *     only them
 *   - per-version actions: Restore (with an automatic safety checkpoint first),
 *     Make a copy (materialize the version as a new document), Compare (opens
 *     the side-by-side diff/merge view in the editor area), Rename, Delete
 *   - Snapshot now, for deliberately pinning the current state between autosaves
 *
 * Storage and the diff engine live in lib/FileSystem.js and lib/versionHistory.js;
 * this file is only the timeline UI. Compare is VersionComparePane, which lives in
 * the editor area rather than here — the diff needs the room, and the timeline stays
 * beside it so you can swap versions while reading one.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getVersions } from '../../lib/FileSystem'
import { isCanvasDoc, isMapDoc, isTextDoc } from '../../lib/docKind'
import { mapText, summarizeMapChange } from '../../lib/map/mapModel'
import {
  describeCanvasDiff,
  diffCanvases,
  diffWords,
  formatFullTimestamp,
  formatTime,
  groupVersions,
  htmlToText,
  sessionColor,
  versionWords,
  wordDelta,
} from '../../lib/versionHistory'
import {
  copyVersionAsDocument,
  deleteVersion,
  renameVersion,
  restoreVersion,
  snapshotVersion,
} from '../../lib/versionActions'
import Icon from '../../ui/Icon.jsx'
import Section from '../../ui/Section.jsx'
import Segmented from '../../ui/Segmented'
import IconButton from '../../ui/IconButton.jsx'
import { EmptyState } from '../../ui/Surfaces.jsx'
import { SkeletonRows } from '../../ui/Reveal.jsx'
import { staggerStyle, useReveal } from '../../ui/revealState.js'
import { PanelActions } from '../../ui/PanelActions.jsx'
import './HistoryPanel.css'
import { VERSIONS_CHANGED } from '../../lib/appEvents'

/** ±word-count badge. Hidden when the change was a wash. */
function DeltaBadge({ added, removed }) {
  if (!added && !removed) return null
  return (
    <span className="history-delta">
      {added ? <span className="history-delta-added">+{added}</span> : null}
      {removed ? <span className="history-delta-removed">−{removed}</span> : null}
    </span>
  )
}

/** Short inline word-diff snippet: a little context, then what changed. */
function ChangeSnippet({ ops }) {
  const parts = []
  const firstChange = ops.findIndex((op) => op.type !== 'equal')

  if (firstChange === -1) {
    const text = ops[0]?.tokens.slice(0, 12).join(' ') || ''
    return <span className="history-preview-text">{text}</span>
  }

  let budget = 24
  if (firstChange > 0) {
    const context = ops[firstChange - 1].tokens.slice(-3)
    parts.push(<span key="pre" className="history-preview-context">{context.join(' ')} </span>)
  }

  for (let i = firstChange; i < ops.length && budget > 0; i++) {
    const op = ops[i]
    const tokens = op.tokens.slice(0, budget)

    if (op.type === 'removed') {
      parts.push(<del key={i} className="history-preview-removed">{tokens.join(' ')} </del>)
      budget -= tokens.length
    } else if (op.type === 'added') {
      parts.push(<span key={i} className="history-preview-added">{tokens.join(' ')} </span>)
      budget -= tokens.length
    } else {
      // Equal run between changes: keep it if short, otherwise stop the snippet.
      if (op.tokens.length > 6) break
      parts.push(<span key={i} className="history-preview-context">{tokens.join(' ')} </span>)
      budget -= tokens.length
    }
  }

  return <>{parts}</>
}

export default function HistoryPanel({
  versions,
  editor,
  setVersions,
  projectName,
  docName,
  query = '',
  refreshFiles,
  onOpenDocInTab,
  onOpenCompare,
}) {
  const isCanvas = isCanvasDoc(docName)
  const isMap = isMapDoc(docName)
  // A canvas or map: no editor to snapshot from, word counts from names.
  const isStructured = !isTextDoc(docName)
  const [localVersions, setLocalVersions] = useState(Array.isArray(versions) ? versions : [])
  const [namedOnly, setNamedOnly] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState(() => new Set())
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [busy, setBusy] = useState(false)
  const renameInputRef = useRef(null)

  const displayedVersions = useMemo(
    () => (localVersions.length ? localVersions : (Array.isArray(versions) ? versions : [])),
    [localVersions, versions]
  )

  // Which document the panel has read versions for itself. `versions` from above,
  // when present, counts as read: the pane that opened the document passed them on.
  const [readFor, setReadFor] = useState(null)
  const refresh = useCallback(async () => {
    if (!projectName || !docName) return
    try {
      const nextVersions = await getVersions(projectName, docName)
      setLocalVersions(nextVersions || [])
      setVersions?.(docName, nextVersions || [])
    } catch {
      // ignore
    } finally {
      setReadFor(docName)
    }
  }, [projectName, docName, setVersions])

  const versionsRef = useRef(versions)
  useEffect(() => { versionsRef.current = versions }, [versions])
  useEffect(() => {
    setLocalVersions([])
    setExpandedGroups(new Set())
    setRenamingId(null)
    setConfirmDeleteId(null)
    // The open document's versions arrive with it; reading the file again for them
    // would parse its whole history a second time.
    if (!Array.isArray(versionsRef.current)) void refresh()
  }, [refresh])

  const versionsReady = Array.isArray(versions) || readFor === docName
  const listReveal = useReveal(versionsReady)

  useEffect(() => {
    const handler = (event) => {
      const detail = event?.detail || {}
      if (detail.projectName !== projectName || detail.docName !== docName) return
      void refresh()
    }

    window.addEventListener(VERSIONS_CHANGED, handler)
    return () => window.removeEventListener(VERSIONS_CHANGED, handler)
  }, [projectName, docName, refresh])

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus()
  }, [renamingId])

  /* ---------------- derived: filtering and grouping ---------------- */

  const normalizedQuery = query.trim().toLowerCase()
  const filteredVersions = useMemo(() => {
    let list = displayedVersions
    if (namedOnly) list = list.filter((entry) => entry.name)
    if (!normalizedQuery) return list
    return list.filter((entry) =>
      `${entry.name || ''} ${entry.timestamp || ''} ${entry.map ? mapText(entry.map) : htmlToText(entry.contentHtml || '')}`
        .toLowerCase()
        .includes(normalizedQuery)
    )
  }, [displayedVersions, namedOnly, normalizedQuery])

  const sections = useMemo(() => groupVersions(filteredVersions), [filteredVersions])

  // entry.id → the entry stored just before it (in the FULL list, so previews
  // stay truthful when a filter hides the real predecessor).
  const previousOf = useMemo(() => {
    const map = new Map()
    for (let i = 0; i < displayedVersions.length; i++) {
      map.set(String(displayedVersions[i].id), displayedVersions[i + 1] || null)
    }
    return map
  }, [displayedVersions])

  const entryText = useCallback(
    (entry) => (entry ? htmlToText(entry.contentHtml || '') : ''),
    []
  )

  /* ---------------- actions ---------------- */

  const snapshotNow = useCallback(async () => {
    if (busy || !projectName || !docName) return
    setBusy(true)
    try {
      const stored = await snapshotVersion({ projectName, docName, editor })
      await refresh()
      // A deliberate snapshot is usually about to be named — drop straight into
      // the rename field rather than making the user hunt for the row.
      if (stored) {
        setRenamingId(String(stored.id))
        setRenameValue(stored.name || '')
      }
    } finally {
      setBusy(false)
    }
  }, [busy, docName, editor, projectName, refresh])

  const handleRestore = useCallback(async (version) => {
    if (busy || !projectName || !docName) return
    setBusy(true)
    try {
      await restoreVersion({ projectName, docName, editor, version })
      await refresh()
    } finally {
      setBusy(false)
    }
  }, [busy, docName, editor, projectName, refresh])

  const handleMakeCopy = useCallback(async (version) => {
    if (busy || !projectName || !docName) return
    setBusy(true)
    try {
      const newPath = await copyVersionAsDocument({ projectName, docName, version })
      if (newPath) {
        await refreshFiles?.()
        onOpenDocInTab?.(newPath)
      }
    } finally {
      setBusy(false)
    }
  }, [busy, docName, onOpenDocInTab, projectName, refreshFiles])

  const commitRename = useCallback(async () => {
    const id = renamingId
    setRenamingId(null)
    if (!id) return
    await renameVersion({ projectName, docName, versionId: id, name: renameValue })
    await refresh()
  }, [docName, projectName, refresh, renameValue, renamingId])

  const handleDelete = useCallback(async (version) => {
    if (confirmDeleteId !== String(version.id)) {
      setConfirmDeleteId(String(version.id))
      return
    }
    setConfirmDeleteId(null)
    await deleteVersion({ projectName, docName, versionId: version.id })
    await refresh()
  }, [confirmDeleteId, docName, projectName, refresh])

  /* ---------------- row rendering ---------------- */

  const renderPreview = (entry) => {
    const prev = previousOf.get(String(entry.id))

    if (isMap) {
      return <span className="history-preview-text">{summarizeMapChange(prev?.map, entry.map)}</span>
    }

    if (isCanvas) {
      const cards = entry.canvas?.nodes?.length ?? 0
      if (!prev?.canvas) {
        return <span className="history-preview-text">{`Snapshot · ${cards} card${cards === 1 ? '' : 's'}`}</span>
      }
      return (
        <span className="history-preview-text">
          {describeCanvasDiff(diffCanvases(prev.canvas, entry.canvas))}
        </span>
      )
    }

    const ops = diffWords(entryText(prev), entryText(entry))
    return <ChangeSnippet ops={ops} />
  }

  const entryDelta = (entry) => {
    const prev = previousOf.get(String(entry.id))
    if (isStructured) {
      const diff = versionWords(entry) - (prev ? versionWords(prev) : 0)
      return { added: Math.max(diff, 0), removed: Math.max(-diff, 0) }
    }
    return wordDelta(entryText(prev), entryText(entry))
  }

  const renderVersionRow = (entry, { inGroup = false } = {}) => {
    const id = String(entry.id)
    const named = Boolean(entry.name)
    const renaming = renamingId === id
    const delta = entryDelta(entry)

    const confirming = confirmDeleteId === id
    const act = (action) => (event) => {
      event.stopPropagation()
      action()
    }

    return (
      <Section
        key={id}
        className={`history-version${named ? ' is-named' : ''}${inGroup ? ' in-group' : ''}`}
        title={(
          <span className="history-version-title">
            <span
              className="history-session-dot"
              style={{ background: sessionColor(entry.sessionId) }}
              title={`Editing session · ${formatFullTimestamp(entry.timestamp)}`}
            />
            <span className="history-timestamp" title={formatFullTimestamp(entry.timestamp)}>
              {formatTime(entry.timestamp)}
            </span>
            {named ? <span className="history-version-name">{entry.name}</span> : null}
            <DeltaBadge added={delta.added} removed={delta.removed} />
          </span>
        )}
        accessory={(
          <>
            <IconButton icon="clock" label="Restore this version" size="circle" disabled={busy} onClick={act(() => void handleRestore(entry))} />
            <IconButton icon="compare" label="Compare / merge" size="circle" onClick={act(() => onOpenCompare?.(docName, id, 'current'))} />
            <IconButton icon="copy" label="Make a copy as a new document" size="circle" disabled={busy} onClick={act(() => void handleMakeCopy(entry))} />
            <IconButton
              icon="delete"
              label={confirming ? 'Click again to delete' : 'Delete this version'}
              size="circle"
              variant={confirming ? 'destructive' : 'plain'}
              disabled={busy}
              onClick={act(() => void handleDelete(entry))}
            />
          </>
        )}
      >
        {renaming ? (
          <input
            ref={renameInputRef}
            className="history-name-input"
            value={renameValue}
            placeholder="Name this version (e.g. First Draft)"
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void commitRename()
              if (event.key === 'Escape') setRenamingId(null)
            }}
            onBlur={() => void commitRename()}
          />
        ) : (
          <button
            className={`history-name${named ? '' : ' is-placeholder'}`}
            title={named ? 'Rename this version' : 'Name this version'}
            onClick={() => {
              setRenamingId(id)
              setRenameValue(entry.name || '')
            }}
          >
            {named ? entry.name : 'Name this version…'}
          </button>
        )}

        <div className="history-preview">{renderPreview(entry)}</div>
      </Section>
    )
  }

  const renderGroup = (group) => {
    if (group.entries.length === 1) return renderVersionRow(group.entries[0])

    const expanded = expandedGroups.has(group.key)
    const newest = group.entries[0]
    const oldest = group.entries[group.entries.length - 1]
    const prevBeforeGroup = previousOf.get(String(oldest.id))
    const groupDelta = isStructured
      ? (() => {
          const diff = versionWords(newest) - (prevBeforeGroup ? versionWords(prevBeforeGroup) : 0)
          return { added: Math.max(diff, 0), removed: Math.max(-diff, 0) }
        })()
      : wordDelta(entryText(prevBeforeGroup), entryText(newest))

    return (
      <div key={group.key} className={`history-group${expanded ? ' is-expanded' : ''}`}>
        <button
          className="history-group-row"
          onClick={() => {
            setExpandedGroups((current) => {
              const next = new Set(current)
              if (next.has(group.key)) next.delete(group.key)
              else next.add(group.key)
              return next
            })
          }}
          title={expanded ? 'Collapse this editing burst' : 'Show every checkpoint in this burst'}
        >
          <span className={`history-group-chevron${expanded ? ' is-open' : ''}`}>
            <Icon name="chevron-down" />
          </span>
          <span
            className="history-session-dot"
            style={{ background: sessionColor(newest.sessionId) }}
            title="Editing session"
          />
          <span className="history-timestamp">
            {formatTime(oldest.timestamp)} – {formatTime(newest.timestamp)}
          </span>
          <span className="history-group-count">{group.entries.length} edits</span>
          <DeltaBadge added={groupDelta.added} removed={groupDelta.removed} />
        </button>
        {expanded ? (
          <div className="history-group-entries">
            {group.entries.map((entry) => renderVersionRow(entry, { inGroup: true }))}
          </div>
        ) : null}
      </div>
    )
  }

  /* ---------------- panel ---------------- */

  const emptyMessage = displayedVersions.length === 0
    ? { title: 'No versions yet.', hint: `Checkpoints appear as you ${isCanvas ? 'work on the canvas' : isMap ? 'work on the map' : 'write'}.` }
    : (namedOnly
        ? { title: 'No named versions yet.', hint: 'Name a version from its row to keep it here.' }
        : { title: 'No matching versions.' })

  return (
    <div className="sidebar-panel history-panel" data-help="history.panel">
      <PanelActions>
        <IconButton
          icon="add"
          label="Save a version now"
          size="capsule"
          onClick={() => void snapshotNow()}
          disabled={busy || (!isStructured && !editor)}
        />
      </PanelActions>
      <div className="history-toolbar">
        <Segmented
          value={namedOnly ? 'named' : 'all'}
          onChange={(value) => setNamedOnly(value === 'named')}
          label="Which versions"
          stretch
          options={[{ value: 'all', label: 'All versions' }, { value: 'named', label: 'Named' }]}
        />
      </div>

      {!versionsReady || listReveal.phase === 'hidden' ? (
        <div className="ib-skeleton-host history-skeleton" data-visible={listReveal.skeleton ? 'true' : 'false'} aria-busy="true">
          <SkeletonRows count={5} />
        </div>
      ) : sections.length === 0 ? (
        <EmptyState compact={displayedVersions.length > 0} icon={displayedVersions.length === 0 ? 'history' : undefined} title={emptyMessage.title} hint={emptyMessage.hint} />
      ) : (
        <div className="sidebar-list history-list ib-stagger" data-reveal={listReveal.phase}>
          {sections.map((section, index) => (
            <div key={section.dayKey} className="history-day" style={staggerStyle(index)}>
              <div className="history-day-label">{section.dayLabel}</div>
              {section.groups.map((group) => renderGroup(group))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
