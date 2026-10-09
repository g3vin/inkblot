/**
 * BookNavigator — the left sidebar in Typeset mode: the book's contents, in the
 * book's own order (BookNavigator.swift).
 *
 * The cover, then front matter, the chapters (in their parts) and the back matter,
 * as the book prints them. Dragging a row reorders the book — never the file tree.
 * Each row can be hidden, which leaves it out of the Typeset pages, print, export
 * and the continuous document. Selecting a row opens it.
 *
 * Everything is the page's: the rows are `pageLayoutState.bookItems`, and every
 * change goes back as a command.
 *
 * Its + (front matter, back matter, a part) and its filter are drawn at the left
 * sidebar's foot (`footerSlot`), in the place the file tree's are while Files shows.
 */
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { shellBridge, useLatestBridgeState } from '../../bridge'
import { Button, IconButton, Sheet, usePointerReorder } from '../../ui'
import { popUpNativeMenu } from '../../ui/useNativeMenu.js'
import Icon from '../../ui/Icon.jsx'
import { SECTION_TITLES, addMenu, moveTarget, rowMenu } from './bookMenu.js'
import TreeFilterBar from '../tree/TreeFilterBar'
import { EMPTY_FILTER } from '../../lib/treeFilter'
import './BookNavigator.css'

const send = (type, payload) => shellBridge.send(type, payload)

function Leading({ row }) {
  if (row.kind === 'chapter') {
    return row.number != null ? <span className="book-row-number">{row.number}</span> : <Icon name="document" />
  }
  if (row.kind === 'part') return <span className="book-row-part">{row.label ? row.label.replace('Part ', '') : '§'}</span>
  if (row.kind === 'matter') return <Icon name={row.legacy ? 'align-left' : 'file-text'} />
  return <Icon name="settings" />
}

function CoverRow({ cover, selected, onOpen }) {
  const active = cover?.sets?.find((set) => set.id === cover.active)
  const needsLook = cover?.checks?.some((check) => check.severity === 'warning' || check.severity === 'error')
  return (
    <button type="button" className="book-row book-cover-row" aria-selected={selected} onClick={onOpen}>
      <span className="book-row-leading"><Icon name="book" /></span>
      <span className="book-row-text">
        <span>Cover</span>
        {cover?.sets?.length > 1 && active ? <small>{active.name} · {cover.sets.length} versions</small>
          : needsLook ? <small className="book-row-warn">Needs a look</small> : null}
      </span>
    </button>
  )
}

export default function BookNavigator({ hasProject, onShowFiles, footerSlot }) {
  const state = useLatestBridgeState('pageLayoutState', null)
  const listRef = useRef(null)
  const [renaming, setRenaming] = useState(null)
  const [title, setTitle] = useState('')
  const [removing, setRemoving] = useState(null)
  const [query, setQuery] = useState('')
  const rows = state?.bookItems ?? []
  const ids = rows.map((row) => row.id)
  const { dragging, insertIndex, onPointerDown } = usePointerReorder({
    listRef,
    itemSelector: '[data-reorder-id]',
    axis: 'y',
    onDrop: ({ id, index, inside }) => {
      if (!inside || index == null) return
      const before = moveTarget(ids, id, index)
      if (before === id) return
      send('moveBookItem', { id, ...(before ? { before } : {}) })
    },
  })

  if (!state || !hasProject) {
    return (
      <div className="book-empty">
        <Icon name="book" size={20} />
        <strong>No project open</strong>
        <span>Choose a project in the window.</span>
      </div>
    )
  }
  if (!rows.length) {
    return (
      <div className="book-empty">
        <Icon name="book" size={20} />
        <strong>No chapters yet</strong>
        <span>A book is a folder’s documents. Open one of them to typeset its book.</span>
      </div>
    )
  }

  const showingCover = state.cover?.showing === true
  const selectedId = showingCover ? 'cover' : state.selectedBookItem
  const open = (id) => { if (id !== selectedId) send('openBookItem', { id }) }
  const actions = {
    onRename: (row) => { setTitle(row.title); setRenaming(row) },
    onRemove: (row) => setRemoving(row),
    onWrite: (row) => { send('openBookItem', { id: row.id }); send('setEditorMode', { mode: 'write' }) },
    onReveal: (row) => { send('openBookItem', { id: row.id }); onShowFiles?.() },
  }
  const sections = ['front', 'body', 'back']
  // The filter narrows the rows by title. Reordering a list with rows missing could
  // only guess where a drop lands, so dragging waits until it is cleared.
  const needle = query.trim().toLowerCase()
  const shows = (text) => !needle || String(text ?? '').toLowerCase().includes(needle)
  const shownRows = rows.filter((row) => shows(row.title) || shows(row.label))
  const footer = (
    <div className="file-tree-footer">
      <IconButton
        icon="add"
        label="Add to the book"
        title="Add front matter, back matter or a part"
        size="circle"
        className="floating-capsule"
        aria-haspopup="menu"
        onClick={(event) => popUpNativeMenu(event, addMenu(rows))}
      />
      <TreeFilterBar
        filter={{ ...EMPTY_FILTER, text: query }}
        onChange={(next) => setQuery(next.text)}
        filesOnly={false}
        placeholder={`Filter ${state.book?.title || 'the book'}`}
      />
    </div>
  )

  return (
    <div className="book-navigator">
      <div ref={listRef} className="book-list" role="listbox" aria-label="The book’s contents">
        {shows('Cover') ? <CoverRow cover={state.cover} selected={showingCover} onOpen={() => open('cover')} /> : null}
        {sections.filter((section) => !needle || shownRows.some((row) => row.section === section)).map((section) => (
          <div key={section} className="book-section">
            <div className="book-heading">{SECTION_TITLES[section]}</div>
            {shownRows.filter((row) => row.section === section).map((row) => {
              const index = ids.indexOf(row.id)
              return (
                <div
                  key={row.id}
                  role="option"
                  tabIndex={row.id === selectedId ? 0 : -1}
                  aria-selected={row.id === selectedId}
                  className="book-row"
                  data-reorder-id={row.id}
                  data-hidden={row.hidden}
                  data-in-part={Boolean(row.part)}
                  data-dragging={dragging === row.id}
                  data-insert-before={insertIndex === index && dragging && dragging !== row.id}
                  title={row.path ?? row.title}
                  onPointerDown={(event) => { if (!needle && !event.target.closest('.book-row-eye')) onPointerDown(event, row.id) }}
                  onClick={() => open(row.id)}
                  onKeyDown={(event) => { if (event.key === 'Enter') open(row.id) }}
                  onContextMenu={(event) => popUpNativeMenu(event, rowMenu(row, actions))}
                >
                  <span className="book-row-leading"><Leading row={row} /></span>
                  <span className="book-row-text">
                    <span className="book-row-title">{row.title}</span>
                    {row.label && row.kind !== 'part' ? <small>{row.label}</small> : null}
                  </span>
                  <button
                    type="button"
                    className="book-row-eye"
                    aria-label={row.hidden ? `Show ${row.title}` : `Hide ${row.title}`}
                    title={row.hidden ? 'Show in the book' : 'Hide from the book: left out of the pages, print, export and the continuous document'}
                    onClick={(event) => { event.stopPropagation(); send('setBookItemHidden', { id: row.id, hidden: !row.hidden }) }}
                  >
                    <Icon name={row.hidden ? 'hide' : 'focus'} />
                  </button>
                </div>
              )
            })}
          </div>
        ))}
        {insertIndex === ids.length && dragging ? <span className="book-insert-end" aria-hidden="true" /> : null}
        {needle && !shownRows.length && !shows('Cover') ? <div className="book-empty">No matching chapters</div> : null}
      </div>
      {footerSlot === undefined ? footer : footerSlot ? createPortal(footer, footerSlot) : null}
      {renaming ? (
        <Sheet title="Rename" width={340} onClose={() => setRenaming(null)} footer={(
          <>
            <Button onClick={() => setRenaming(null)}>Cancel</Button>
            <Button variant="filled" onClick={() => { send('editBookItem', { id: renaming.id, title }); setRenaming(null) }}>Rename</Button>
          </>
        )}>
          <input
            className="book-rename"
            aria-label="Title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { send('editBookItem', { id: renaming.id, title }); setRenaming(null) } }}
          />
        </Sheet>
      ) : null}
      {removing ? (
        <Sheet title={`Remove “${removing.title}” from the book?`} width={380} onClose={() => setRemoving(null)} footer={(
          <>
            <Button onClick={() => setRemoving(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { send('removeBookItem', { id: removing.id }); setRemoving(null) }}>Remove</Button>
          </>
        )}>
          <p className="book-note">{removing.kind === 'matter' ? 'Its page is deleted with it. This can’t be undone.' : 'You can add it again from the + menu.'}</p>
        </Sheet>
      ) : null}
    </div>
  )
}
