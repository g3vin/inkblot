/**
 * BookNavigator — the left sidebar in Typeset mode: the book's contents, in the
 * book's own order (BookNavigator.swift).
 *
 * The cover, then front matter, the chapters (in their parts) and the back matter,
 * as the book prints them. Dragging a row reorders the book — never the file tree.
 * Each row can be hidden, which leaves it out of the Typeset pages, print, export
 * and the continuous document. Selecting a row opens it.
 *
 * Rows can be chosen together, as in the file tree (⌘-click, ⇧-click, ⌘A;
 * lib/treeSelection.js): then they are hidden or shown, dragged, gathered under a
 * new part or removed at once, each as one command naming them all (`ids`).
 *
 * Everything is the page's: the rows are `pageLayoutState.bookItems`, and every
 * change goes back as a command.
 *
 * Its + (front matter, back matter, a part) is drawn at the left sidebar's foot
 * (`footerSlot`), in the place the file tree's is while Files shows, beside the
 * project search.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { shellBridge, useLatestBridgeState } from '../../bridge'
import { Button, Dialog, IconButton, Inlay, InlaySlot, usePointerReorder } from '../../ui'
import { popUpMenu } from '../../ui/useNativeMenu.js'
import Icon from '../../ui/Icon.jsx'
import { SECTION_TITLES, addMenu, gatherTarget, moveTarget, rowMenu, selectionMenu } from './bookMenu.js'
import { useCommands } from '../../lib/commands'
import { clickRow, pruneSelection } from '../../lib/treeSelection'

const NO_SELECTION = { selection: new Set(), anchor: null }
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

/** What removing these rows costs: matter pages go with their documents. */
function removalNote(rows) {
  const pages = rows.filter((row) => row.kind === 'matter').length
  if (!pages) return rows.length === 1 ? 'You can add it again from the + menu.' : 'You can add them again from the + menu.'
  if (rows.length === 1) return 'Its page is deleted with it. This can’t be undone.'
  return `${pages === rows.length ? 'Their pages are' : `${pages} of their pages are`} deleted with them. This can’t be undone.`
}

export default function BookNavigator({ hasProject, onShowFiles, footerSlot }) {
  const state = useLatestBridgeState('pageLayoutState', null)
  const listRef = useRef(null)
  const [renaming, setRenaming] = useState(null)
  const [title, setTitle] = useState('')
  // The rows being removed, once the writer has been asked.
  const [removing, setRemoving] = useState(null)
  const rows = useMemo(() => state?.bookItems ?? [], [state?.bookItems])
  const ids = useMemo(() => rows.map((row) => row.id), [rows])
  const showingCover = state?.cover?.showing === true
  const selectedId = showingCover ? 'cover' : state?.selectedBookItem

  // The rows chosen together, and the anchor a ⇧-click runs from. One row is only the
  // open one; several are marked as chosen, the open one among them or not.
  const [picked, setPicked] = useState(NO_SELECTION)
  const { selection } = picked
  const multi = selection.size > 1
  const kept = pruneSelection(selection, ids)
  if (kept !== selection) setPicked({ selection: kept, anchor: kept.has(picked.anchor) ? picked.anchor : null })
  const [followedId, setFollowedId] = useState(null)
  if (followedId !== selectedId) {
    setFollowedId(selectedId)
    if (!multi) setPicked(selectedId ? { selection: new Set([selectedId]), anchor: selectedId } : NO_SELECTION)
  }
  const selectedRows = useMemo(() => rows.filter((row) => selection.has(row.id)), [rows, selection])
  const block = (id) => (multi && selection.has(id) ? selectedRows.map((row) => row.id) : null)

  const { dragging, insertIndex, onPointerDown } = usePointerReorder({
    listRef,
    itemSelector: '[data-reorder-id]',
    axis: 'y',
    onDrop: ({ id, index, inside }) => {
      if (!inside || index == null) return
      // A row out of a selection carries the selection, in the book's order.
      const carried = block(id)
      const before = moveTarget(ids, carried ?? id, index)
      if (before === id) return
      send('moveBookItem', { id, ...(before ? { before } : {}), ...(carried ? { ids: carried } : {}) })
    },
  })

  const selectAll = useCallback(() => setPicked({ selection: new Set(ids), anchor: ids[0] ?? null }), [ids])
  const clearSelection = useCallback(
    () => setPicked(selectedId ? { selection: new Set([selectedId]), anchor: selectedId } : NO_SELECTION),
    [selectedId],
  )
  const setSelectionHidden = useCallback((hidden) => {
    const chosen = selectedRows.map((row) => row.id)
    if (chosen.length) send('setBookItemHidden', { id: chosen[0], ids: chosen, hidden })
  }, [selectedRows])
  // The chapters gathered where the first of them is, a part divider before them.
  const groupIntoPart = useCallback((group) => {
    const chosen = group.map((row) => row.id)
    const before = gatherTarget(ids, chosen)
    send('moveBookItem', { id: chosen[0], ids: chosen, ...(before ? { before } : {}) })
    send('addBookItem', { part: true, before: chosen[0], title: 'Part', back: false })
  }, [ids])

  useCommands(() => [
    { id: 'book.select-all', title: 'Select all in the Book', section: 'Typeset', icon: 'group', keywords: ['choose', 'multiple'], when: () => hasProject && ids.length > 0, run: selectAll },
    { id: 'book.hide-selected', title: `Hide ${selection.size} selected from the Book`, section: 'Typeset', icon: 'hide', when: () => multi, run: () => setSelectionHidden(true) },
    { id: 'book.show-selected', title: `Show ${selection.size} selected in the Book`, section: 'Typeset', icon: 'show', when: () => multi && selectedRows.some((row) => row.hidden), run: () => setSelectionHidden(false) },
  ], [hasProject, ids.length, multi, selectAll, selectedRows, selection.size, setSelectionHidden])

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

  const open = (id) => { if (id !== selectedId) send('openBookItem', { id }) }
  const choose = (event, id) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      setPicked((current) => clickRow(current, id, ids, { toggle: event.metaKey || event.ctrlKey, range: event.shiftKey }))
      return
    }
    setPicked((current) => clickRow(current, id, ids))
    open(id)
  }
  // ⌘A chooses every row, Escape lets a selection go: on the list, not in a dialog.
  const onListKeyDown = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      selectAll()
    } else if (event.key === 'Escape' && multi) {
      event.preventDefault()
      clearSelection()
    }
  }
  const actions = {
    onRename: (row) => { setTitle(row.title); setRenaming(row) },
    onRemove: (row) => setRemoving([row]),
    onWrite: (row) => { send('openBookItem', { id: row.id }); send('setEditorMode', { mode: 'write' }) },
    onReveal: (row) => { send('openBookItem', { id: row.id }); onShowFiles?.() },
  }
  const sections = ['front', 'body', 'back']
  const footer = (
    <InlaySlot className="file-tree-footer">
      <Inlay round>
        <IconButton
          icon="add"
          label="Add to the book"
          title="Add front matter, back matter or a part"
          size="circle"
          aria-haspopup="menu"
          onClick={(event) => popUpMenu(event, addMenu(rows))}
        />
      </Inlay>
    </InlaySlot>
  )

  return (
    <div className="book-navigator">
      <div ref={listRef} className="book-list" role="listbox" aria-label="The book’s contents" aria-multiselectable="true" onKeyDown={onListKeyDown}>
        <CoverRow cover={state.cover} selected={showingCover} onOpen={() => open('cover')} />
        {sections.map((section) => (
          <div key={section} className="book-section">
            <div className="book-heading">{SECTION_TITLES[section]}</div>
            {rows.filter((row) => row.section === section).map((row) => {
              const index = ids.indexOf(row.id)
              const chosen = selection.has(row.id)
              const carried = Boolean(dragging) && (dragging === row.id || (chosen && block(dragging) !== null))
              return (
                <div
                  key={row.id}
                  role="option"
                  tabIndex={row.id === selectedId ? 0 : -1}
                  aria-selected={chosen}
                  aria-current={row.id === selectedId || undefined}
                  className="book-row"
                  data-reorder-id={row.id}
                  data-current={row.id === selectedId}
                  data-hidden={row.hidden}
                  data-in-part={Boolean(row.part)}
                  data-dragging={carried}
                  data-insert-before={insertIndex === index && dragging && !carried}
                  title={row.path ?? row.title}
                  onPointerDown={(event) => { if (!event.target.closest('.book-row-eye')) onPointerDown(event, row.id) }}
                  onClick={(event) => choose(event, row.id)}
                  onKeyDown={(event) => { if (event.key === 'Enter') open(row.id) }}
                  onContextMenu={(event) => {
                    if (multi && chosen) {
                      popUpMenu(event, selectionMenu(selectedRows, { onGroup: groupIntoPart, onRemove: (group) => setRemoving(group) }))
                      return
                    }
                    // A row outside the selection is chosen alone, and its own menu shows.
                    if (multi) setPicked({ selection: new Set([row.id]), anchor: row.id })
                    popUpMenu(event, rowMenu(row, actions))
                  }}
                >
                  <span className="book-row-leading"><Leading row={row} /></span>
                  <span className="book-row-text">
                    <span className="book-row-title">{row.title}</span>
                    {/* A numbered chapter's label only spells out the number beside it. */}
                    {row.label && row.kind !== 'part' && row.number == null ? <small>{row.label}</small> : null}
                  </span>
                  <button
                    type="button"
                    className="book-row-eye"
                    aria-label={row.hidden ? `Show ${row.title}` : `Hide ${row.title}`}
                    title={row.hidden ? 'Show in the book' : 'Hide from the book: left out of the pages, print, export and the continuous document'}
                    onClick={(event) => { event.stopPropagation(); send('setBookItemHidden', { id: row.id, hidden: !row.hidden }) }}
                  >
                    <Icon name={row.hidden ? 'hide' : 'show'} />
                  </button>
                </div>
              )
            })}
          </div>
        ))}
        {insertIndex === ids.length && dragging ? <span className="book-insert-end" aria-hidden="true" /> : null}
      </div>
      {footerSlot === undefined ? footer : footerSlot ? createPortal(footer, footerSlot) : null}
      {renaming ? (
        <Dialog eyebrow="Book" title="Rename" size="small" onClose={() => setRenaming(null)} footer={(
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
        </Dialog>
      ) : null}
      {removing?.length ? (
        <Dialog
          eyebrow="Book"
          title={removing.length === 1 ? `Remove “${removing[0].title}” from the book?` : `Remove ${removing.length} entries from the book?`}
          size="small"
          onClose={() => setRemoving(null)}
          footer={(
            <>
              <Button onClick={() => setRemoving(null)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={() => {
                  const gone = removing.map((row) => row.id)
                  send('removeBookItem', { id: gone[0], ...(gone.length > 1 ? { ids: gone } : {}) })
                  setRemoving(null)
                }}
              >
                Remove
              </Button>
            </>
          )}
        >
          <p className="book-note">{removalNote(removing)}</p>
        </Dialog>
      ) : null}
    </div>
  )
}
