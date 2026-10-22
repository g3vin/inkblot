/**
 * ProjectSearch.jsx — the project's one search, at the left sidebar's foot.
 *
 * A bare search icon on the foot's inner end, beside the +, opens a card upward over
 * the page, as Dia's search opens from its sidebar. There are no scopes to pick: what
 * is found is sorted into categories under small headers — In this document,
 * Documents, Notes — and with nothing typed the card offers the open documents, recent
 * files and recent searches. Pausing on a document that is not open (pointer or arrow
 * keys) shows a preview of it beside the card. ⇧⌘F opens the same card in the middle of the page.
 *
 * Find and replace in the open document is the find bar's (⌘F, FindBar.jsx).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../../ui/Icon.jsx'
import IconButton from '../../ui/IconButton.jsx'
import Button from '../../ui/Button.jsx'
import Kbd from '../../ui/Kbd.jsx'
import { Inlay } from '../../ui/Inlay.jsx'
import { EmptyState } from '../../ui/Surfaces.jsx'
import { listProjectTree, loadDocument } from '../../lib/FileSystem'
import { getDocDisplayName, getDocKind } from '../../lib/docKind'
import { recentDocs } from '../../lib/recentDocs'
import { useCommands } from '../../lib/commands'
import {
  clearRecentSearches,
  collectEditorMatches,
  createMatcher,
  loadRecentSearches,
  rememberRecentSearch,
  requestFind,
  searchEverything,
} from '../../lib/sidebarSearch'
import SearchPreview from './SearchPreview'
import './ProjectSearch.css'

const SEARCH_DEBOUNCE_MS = 180
// In the sidebar the card starts at the search icon's left edge and reaches out over
// the document: the panel's width and this much more.
const CARD_OVERHANG_PX = 32
// Its edges are kept this far from the window's.
const WINDOW_MARGIN_PX = 8
/** Must match .project-search-overlay-card's width — the fly-in scales against it. */
const OVERLAY_WIDTH_PX = 640
const IN_DOCUMENT_ROWS = 5
const RECENT_FILE_ROWS = 5
// How long the pointer rests on a row before its preview shows, so sweeping down the
// list does not flash a preview per row.
const PREVIEW_DELAY_MS = 150
const PREVIEW_WIDTH_PX = 360
const PREVIEW_MAX_HEIGHT_PX = 440
const PREVIEW_GAP_PX = 8

const KIND_ICONS = { text: 'document', canvas: 'canvas', map: 'map', timeline: 'timeline' }

const rowIcon = (row) => {
  if (row.type === 'document') return KIND_ICONS[row.kind] || 'file'
  if (row.type === 'note-match') return 'note'
  if (row.type === 'match') return 'text-cursor'
  if (row.type === 'recent-search') return 'clock'
  return 'search'
}

const docRow = (path) => ({
  id: `file-${path}`,
  type: 'document',
  kind: getDocKind(path),
  docName: path,
  title: getDocDisplayName(path),
  path,
})

/** `text` with what the query matched in it set in <mark>. */
function Marked({ text, matcher }) {
  const value = String(text || '')
  const hits = matcher && !matcher.isEmpty && matcher.valid ? matcher.findAll(value, 4) : []
  if (!hits.length) return value
  const parts = []
  let at = 0
  hits.forEach((hit) => {
    if (hit.index > at) parts.push(value.slice(at, hit.index))
    parts.push(<mark key={hit.index} className="project-search-hit">{hit.text}</mark>)
    at = hit.index + hit.length
  })
  parts.push(value.slice(at))
  return <>{parts}</>
}

export default function ProjectSearch({
  projectName,
  editor,
  secondaryEditor,
  activeEditor,
  currentDoc,
  secondaryDoc,
  activeDoc,
  notesByDoc = {},
  onOpenSearchTarget,
  // Whether the sidebar holding the icon is on screen: the centred card flies out of
  // the icon when it is, and simply appears when it is not.
  onScreen = true,
  onOpenChange,
}) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [overlay, setOverlay] = useState(null)
  const [recentSearches, setRecentSearches] = useState(loadRecentSearches)
  const [found, setFound] = useState({ status: 'idle', documents: [], notes: [] })
  const [selected, setSelected] = useState(0)
  // A preview shows once a row has been pointed at or arrowed to, not while typing.
  const [armed, setArmed] = useState(false)
  const [previewId, setPreviewId] = useState(null)
  const [previewPlace, setPreviewPlace] = useState(null)
  const [cardPlace, setCardPlace] = useState(null)
  const open = expanded || Boolean(overlay)

  const rootRef = useRef(null)
  const cardRef = useRef(null)
  const inputRef = useRef(null)
  const notesByDocRef = useRef(notesByDoc)
  useEffect(() => { notesByDocRef.current = notesByDoc }, [notesByDoc])
  useEffect(() => { onOpenChange?.(open) }, [onOpenChange, open])

  // Searched a moment after the typing stops, not per key.
  const [deferredQuery, setDeferredQuery] = useState(query)
  useEffect(() => {
    if (!query) { setDeferredQuery(''); return undefined }
    const timer = setTimeout(() => setDeferredQuery(query), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])
  const matcher = useMemo(() => createMatcher(deferredQuery), [deferredQuery])

  const changeQuery = (value) => {
    setQuery(value)
    setSelected(0)
    setArmed(false)
  }

  const close = useCallback(() => {
    setExpanded(false)
    setOverlay(null)
    setArmed(false)
  }, [])

  const openOverlay = useCallback(() => {
    const icon = onScreen ? rootRef.current?.querySelector('.project-search-toggle')?.getBoundingClientRect() : null
    // Centred on the document card, between whichever sidebars are docked.
    const card = document.querySelector('.main-layout > .document-card')?.getBoundingClientRect()
    const left = card ? card.left : 0
    const right = card ? card.right : window.innerWidth
    setExpanded(false)
    setOverlay({
      centerX: (left + right) / 2,
      zoneWidth: Math.max(right - left, 320),
      origin: icon && icon.width > 0
        ? { x: icon.left + icon.width / 2, y: icon.top + icon.height / 2, width: icon.width }
        : null,
    })
  }, [onScreen])

  useCommands(() => (projectName ? [{
    id: 'search.project',
    section: 'Search',
    title: overlay ? 'Close project search' : 'Search the project…',
    icon: 'search',
    keys: 'Mod+Shift+F',
    keywords: ['find', 'look up', 'everywhere', 'notes', 'documents'],
    run: overlay ? close : openOverlay,
  }] : []), [close, openOverlay, overlay, projectName])

  // The field lives in the card, so it can only take focus once the card is up — and
  // the sidebar's card is hidden until it has been placed, which a hidden field
  // cannot take focus through. Once per opening, so a resize does not reselect.
  const focusedRef = useRef(null)
  const showing = overlay ? 'overlay' : expanded && cardPlace ? 'sidebar' : null
  useEffect(() => {
    if (focusedRef.current === showing) return
    focusedRef.current = showing
    if (!showing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [showing])

  // A click outside the sidebar's card puts it away. (The centred one has its own
  // catch layer.)
  useEffect(() => {
    if (!expanded) return undefined
    const onPointerDown = (event) => {
      if (rootRef.current?.contains(event.target) || cardRef.current?.contains(event.target)) return
      close()
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [close, expanded])

  // The sidebar's card is drawn on the page, not in the sidebar (which would clip
  // it): above the foot, from the search icon's left edge, out over the document.
  useLayoutEffect(() => {
    if (!expanded) { setCardPlace(null); return undefined }
    const sidebar = rootRef.current?.closest('.sidebar')
    const place = () => {
      const foot = (rootRef.current?.closest('.left-sidebar-footer') || rootRef.current)?.getBoundingClientRect()
      const icon = rootRef.current?.querySelector('.project-search-toggle')?.getBoundingClientRect() || foot
      const panel = sidebar?.getBoundingClientRect() || foot
      if (!foot || !icon || !panel) return
      const left = Math.max(WINDOW_MARGIN_PX, Math.min(icon.left, window.innerWidth - panel.width - CARD_OVERHANG_PX - WINDOW_MARGIN_PX))
      const width = Math.min(panel.width + CARD_OVERHANG_PX, window.innerWidth - left - WINDOW_MARGIN_PX)
      setCardPlace({ left, width, bottom: window.innerHeight - foot.top })
    }
    place()
    const observer = sidebar ? new ResizeObserver(place) : null
    observer?.observe(sidebar)
    window.addEventListener('resize', place)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [expanded])

  /* ---- Results ---- */

  const hereDoc = activeDoc || currentDoc || ''
  const hereSearchable = Boolean(activeEditor) && getDocKind(hereDoc) === 'text'

  // Cheap fingerprint of every note, so the search re-runs when a note's text
  // changes but not on unrelated re-renders.
  const notesRevision = useMemo(() => Object.entries(notesByDoc || {})
    .map(([docName, docNotes]) => {
      const list = Array.isArray(docNotes) ? docNotes : []
      const latest = list.reduce((newest, note) => {
        const stamp = String(note?.updatedAt || note?.createdAt || '')
        return stamp > newest ? stamp : newest
      }, '')
      return `${docName}:${list.length}:${latest}`
    })
    .join('|'), [notesByDoc])

  useEffect(() => {
    if (!open || matcher.isEmpty || !matcher.valid) {
      setFound({ status: 'idle', documents: [], notes: [] })
      return undefined
    }

    let cancelled = false
    setFound((current) => ({ ...current, status: 'loading' }))

    const getLiveDoc = (path) => {
      if (path === currentDoc && editor) return { content: editor.getJSON(), notes: notesByDocRef.current?.[path] || [] }
      if (path === secondaryDoc && secondaryEditor) return { content: secondaryEditor.getJSON(), notes: notesByDocRef.current?.[path] || [] }
      return null
    }

    searchEverything({
      matcher,
      projectName,
      currentDocName: hereSearchable ? hereDoc : '',
      listProjectTree,
      loadDocument,
      getLiveDoc,
      isCancelled: () => cancelled,
    }).then((results) => {
      if (!cancelled) setFound({ status: 'ready', ...results })
    }).catch(() => {
      if (!cancelled) setFound({ status: 'ready', documents: [], notes: [] })
    })

    return () => { cancelled = true }
  }, [currentDoc, editor, hereDoc, hereSearchable, matcher, notesRevision, open, projectName, secondaryDoc, secondaryEditor])

  const sections = useMemo(() => {
    if (!open) return []
    if (matcher.isEmpty) {
      const openDocs = [...new Set([currentDoc, secondaryDoc].filter(Boolean))]
      const recents = recentDocs(projectName).filter((path) => !openDocs.includes(path)).slice(0, RECENT_FILE_ROWS)
      return [
        { id: 'open', title: 'Open', rows: openDocs.map(docRow) },
        { id: 'recent-files', title: 'Recent files', rows: recents.map(docRow) },
        {
          id: 'recent-searches',
          title: 'Recent searches',
          rows: recentSearches.map((entry) => ({ id: `recent-${entry}`, type: 'recent-search', title: entry })),
        },
      ].filter((section) => section.rows.length)
    }

    const here = hereSearchable ? collectEditorMatches(activeEditor, matcher, hereDoc) : []
    const hereRows = here.slice(0, IN_DOCUMENT_ROWS).map((match) => ({ ...match, type: 'match', title: match.preview }))
    if (here.length > IN_DOCUMENT_ROWS) {
      hereRows.push({ id: 'find-all', type: 'find-all', title: 'Find all in this document' })
    }
    return [
      { id: 'here', title: 'In this document', rows: hereRows },
      { id: 'documents', title: 'Documents', rows: found.documents },
      { id: 'notes', title: 'Notes', rows: found.notes },
    ].filter((section) => section.rows.length)
  }, [activeEditor, currentDoc, found, hereDoc, hereSearchable, matcher, open, projectName, recentSearches, secondaryDoc])

  const rows = useMemo(() => sections.flatMap((section) => section.rows), [sections])
  const selectedIndex = rows.length ? Math.min(selected, rows.length - 1) : -1
  const selectedRow = rows[selectedIndex] || null

  // Keep the selected row in view as the arrow keys move it.
  useEffect(() => {
    if (selectedIndex < 0) return
    cardRef.current?.querySelector(`[data-row-index="${selectedIndex}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedIndex])

  /* ---- Preview ---- */

  // Not for a document that is open: it is already on screen.
  const previewable = (row) => row?.type === 'document' && row.docName !== currentDoc && row.docName !== secondaryDoc
  const previewTargetId = armed && previewable(selectedRow) ? selectedRow.id : null
  useEffect(() => {
    const timer = setTimeout(() => setPreviewId(previewTargetId), previewTargetId ? PREVIEW_DELAY_MS : 0)
    return () => clearTimeout(timer)
  }, [previewTargetId])
  const previewRow = previewId ? rows.find((row) => row.id === previewId) || null : null

  // Beside the card, level with its row, kept inside the window; on the card's other
  // side when there is no room to its right.
  useLayoutEffect(() => {
    if (!previewRow) { setPreviewPlace(null); return }
    const card = cardRef.current?.getBoundingClientRect()
    const row = cardRef.current?.querySelector(`[data-row-id="${CSS.escape(previewRow.id)}"]`)?.getBoundingClientRect()
    if (!card || !row) { setPreviewPlace(null); return }
    const height = Math.min(PREVIEW_MAX_HEIGHT_PX, window.innerHeight - WINDOW_MARGIN_PX * 2)
    let left = card.right + PREVIEW_GAP_PX
    if (left + PREVIEW_WIDTH_PX > window.innerWidth - WINDOW_MARGIN_PX) {
      left = card.left - PREVIEW_GAP_PX - PREVIEW_WIDTH_PX
      if (left < WINDOW_MARGIN_PX) { setPreviewPlace(null); return }
    }
    const top = Math.min(Math.max(WINDOW_MARGIN_PX, row.top - PREVIEW_GAP_PX), window.innerHeight - height - WINDOW_MARGIN_PX)
    setPreviewPlace({ left, top, width: PREVIEW_WIDTH_PX, height })
  }, [previewRow, cardPlace, overlay])

  /* ---- Actions ---- */

  const openRow = (row) => {
    if (!row) return
    if (row.type === 'recent-search') {
      changeQuery(row.title)
      inputRef.current?.focus()
      return
    }

    if (query.trim()) setRecentSearches(rememberRecentSearch(query))
    close()

    if (row.type === 'find-all') {
      requestFind(query)
      return
    }

    if (row.type === 'match') {
      activeEditor?.chain().focus().setTextSelection({ from: row.from, to: row.to }).scrollIntoView().run()
      return
    }

    onOpenSearchTarget?.({
      docName: row.docName,
      from: row.from,
      to: row.to,
      anchor: row.note?.anchor || row.matchText || row.title,
      note: row.note,
      // A canvas or map hit is an item, not a document position: it is revealed.
      nodeId: row.nodeId,
      // A document found by name (or opened from Recent) opens where it was left.
      skipJump: row.from == null && !row.nodeId && !row.note,
    })
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      // Handled here, so a hovering sidebar does not go too (usePeekDismiss).
      event.preventDefault()
      close()
      inputRef.current?.blur()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!rows.length) return
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setSelected((selectedIndex + step + rows.length) % rows.length)
      setArmed(true)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      openRow(selectedRow)
    }
  }

  /* ---- Render ---- */

  const loading = !matcher.isEmpty && found.status === 'loading'
  const nothingFound = !matcher.isEmpty && !loading && found.status === 'ready' && rows.length === 0

  const card = (
    <div
      ref={cardRef}
      className="project-search-card"
      role="dialog"
      aria-label="Search the project"
      onKeyDown={handleKeyDown}
    >
      <label className="project-search-field">
        <Icon name="search" size={20} className="project-search-field-icon" />
        <input
          ref={inputRef}
          className="project-search-input"
          type="text"
          placeholder="Search"
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          role="combobox"
          aria-expanded={rows.length > 0}
          aria-controls="project-search-results"
          aria-autocomplete="list"
          aria-activedescendant={selectedRow ? `project-search-row-${selectedIndex}` : undefined}
        />
        {query ? (
          <IconButton
            icon="close"
            label="Clear search"
            size="capsule"
            className="project-search-clear"
            onClick={() => { changeQuery(''); inputRef.current?.focus() }}
          />
        ) : <Kbd>⇧⌘F</Kbd>}
      </label>

      {sections.length || loading || nothingFound ? (
        <div className="project-search-body" id="project-search-results" role="listbox" aria-label="Results">
          {sections.map((section) => (
            <div key={section.id} className="project-search-section" role="group" aria-labelledby={`project-search-section-${section.id}`}>
              <div className="project-search-section-title">
                <span className="ib-eyebrow" id={`project-search-section-${section.id}`}>{section.title}</span>
                {section.id === 'recent-searches' ? (
                  <Button className="project-search-section-action" onClick={() => setRecentSearches(clearRecentSearches())}>
                    Clear
                  </Button>
                ) : null}
              </div>
              {section.rows.map((row) => {
                const index = rows.indexOf(row)
                return (
                  <button
                    key={row.id}
                    id={`project-search-row-${index}`}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === selectedIndex}
                    data-row-index={index}
                    data-row-id={row.id}
                    className={`project-search-row${index === selectedIndex ? ' is-selected' : ''}`}
                    onMouseMove={() => {
                      if (index !== selectedIndex) setSelected(index)
                      if (!armed) setArmed(true)
                    }}
                    onClick={() => openRow(row)}
                  >
                    <Icon name={rowIcon(row)} size={20} className="project-search-row-icon" />
                    <span className="project-search-row-text">
                      <span className="project-search-row-title"><Marked text={row.title} matcher={matcher} /></span>
                      {row.type !== 'match' && row.preview && row.preview !== row.path ? (
                        <span className="project-search-row-preview"><Marked text={row.preview} matcher={matcher} /></span>
                      ) : null}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
          {loading && !rows.length ? <div className="project-search-status ib-meta">Searching…</div> : null}
          {nothingFound ? <EmptyState compact title="No matches." /> : null}
        </div>
      ) : null}
    </div>
  )

  const preview = previewRow && previewPlace ? createPortal(
    <SearchPreview
      key={`${previewRow.id}|${deferredQuery}`}
      projectName={projectName}
      row={previewRow}
      matcher={matcher}
      place={previewPlace}
    />,
    document.body,
  ) : null

  const overlayNode = overlay ? createPortal(
    <div
      className="project-search-overlay"
      onPointerDown={(event) => { if (event.target === event.currentTarget) close() }}
    >
      <div
        className={`project-search-overlay-card${overlay.origin ? ' is-flying' : ''}`}
        style={{
          '--search-center-x': `${overlay.centerX}px`,
          '--search-zone-width': `${overlay.zoneWidth}px`,
          ...(overlay.origin ? {
            // The fly-in lands on the zone's centre, so it starts offset from that.
            '--search-fly-dx': `${overlay.origin.x - overlay.centerX}px`,
            '--search-fly-dy': `${overlay.origin.y - window.innerHeight / 2}px`,
            '--search-fly-scale': overlay.origin.width / OVERLAY_WIDTH_PX,
          } : null),
        }}
      >
        {card}
      </div>
    </div>,
    document.body,
  ) : null

  if (!projectName) return null

  const label = expanded ? 'Hide search' : 'Search'
  return (
    <div ref={rootRef} className={`project-search${expanded ? ' is-expanded' : ''}`}>
      {expanded ? createPortal(
        <div className="project-search-popup" style={cardPlace || { visibility: 'hidden' }}>
          {card}
        </div>,
        document.body,
      ) : null}
      {overlayNode}
      {preview}
      <Inlay round>
        <IconButton
          icon="search"
          size="circle"
          label={label}
          title={expanded ? label : `${label} (⇧⌘F)`}
          className="project-search-toggle"
          aria-expanded={expanded}
          aria-haspopup="dialog"
          onClick={() => {
            if (expanded) { close(); return }
            setOverlay(null)
            setExpanded(true)
          }}
        />
      </Inlay>
    </div>
  )
}
