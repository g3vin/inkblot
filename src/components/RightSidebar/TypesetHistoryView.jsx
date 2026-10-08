/**
 * TypesetHistoryView — the History tab in Typeset: the book's typeset versions, apart
 * from its text's (TypesetHistoryView.swift).
 *
 * A version is kept a while after the typesetting changes, when the writer saves one,
 * and whenever the book is printed or exported — so the interior sent to the printer
 * can always be had again. Each says what changed since the one before. A version can
 * be previewed as pages, compared beside the current ones, or restored: restoring puts
 * its typesetting back onto the text as it is now, and never changes a word.
 *
 * Drawn from `typesetHistoryChanged`; every action is a command useTypesetHistory
 * answers.
 */
import { useState } from 'react'
import { shellBridge, useLatestBridgeState } from '../../bridge'
import { EditionAction, TypesetVersionKind } from '../../types'
import { Button } from '../../ui'
import { popUpNativeMenu } from '../../ui/useNativeMenu'
import Icon from '../../ui/Icon.jsx'
import './TypesetHistory.css'
import { byDay } from '../../lib/historyDays'

const ICONS = {
  [TypesetVersionKind.Auto]: 'clock',
  [TypesetVersionKind.Named]: 'bookmark',
  [TypesetVersionKind.Export]: 'print',
  [TypesetVersionKind.Restore]: 'undo',
}

const time = (iso) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

const NO_HISTORY = { folder: '', rows: [] }
const send = (type, payload) => shellBridge.send(type, payload)

export default function TypesetHistoryView() {
  const history = useLatestBridgeState('typesetHistoryChanged', NO_HISTORY) || NO_HISTORY
  const rows = history.rows ?? []
  const [naming, setNaming] = useState(null)

  const ask = (message) => window.confirm?.(message) ?? true

  const menu = (event, row) => popUpNativeMenu(event, [
    { text: 'Name…', action: () => setNaming({ id: row.id, name: row.name ?? '' }) },
    { text: 'Duplicate as Edition', action: () => send('editEditions', { action: EditionAction.FromTypesetVersion, id: row.id, name: row.name }) },
    { separator: true },
    { text: 'Delete…', action: () => { if (ask('Delete this typeset version?')) send('deleteTypesetVersion', { id: row.id }) } },
  ])

  const restore = (row) => {
    if (ask('Restore this typeset? The book’s typesetting goes back to this version. The text is not changed, and the typeset it replaces is kept first.')) {
      send('restoreTypesetVersion', { id: row.id })
    }
  }

  const commitName = () => {
    if (!naming) return
    if (naming.id) send('renameTypesetVersion', { id: naming.id, name: naming.name.trim() })
    else send('saveTypesetVersion', { name: naming.name.trim() || 'Saved' })
    setNaming(null)
  }

  return (
    <div className="typeset-history">
      <div className="typeset-history-top">
        {naming ? (
          <form className="typeset-history-naming" onSubmit={(event) => { event.preventDefault(); commitName() }}>
            <input
              autoFocus
              value={naming.name}
              placeholder={naming.id ? 'Name' : 'Sent to the printer'}
              aria-label="Name"
              onChange={(event) => setNaming({ ...naming, name: event.target.value })}
              onKeyDown={(event) => { if (event.key === 'Escape') setNaming(null) }}
            />
            <Button type="submit" variant="tinted">{naming.id ? 'Rename' : 'Save'}</Button>
          </form>
        ) : (
          <Button variant="tinted" className="typeset-history-save" onClick={() => setNaming({ id: null, name: '' })} title="Keep the book’s typesetting as it is now, under a name">
            <Icon name="add" /> Save Typeset Version…
          </Button>
        )}
        {history.previewing ? (
          <div className="typeset-history-previewing">
            <span>{history.comparing ? 'Comparing in the pages' : 'Previewing in the pages'}</span>
            <Button onClick={() => { const row = rows.find((r) => r.id === history.previewing); if (row) restore(row) }}>Restore</Button>
            <Button onClick={() => send('previewTypesetVersion', {})}>Done</Button>
          </div>
        ) : null}
        {history.note ? <p className="typeset-history-note">{history.note}</p> : null}
      </div>

      {rows.length ? (
        <div className="sidebar-list history-list">
          {byDay(rows).map((day) => (
            <section key={day.label} className="history-day">
              <div className="history-day-label">{day.label}</div>
              {day.rows.map((row) => {
                const previewing = history.previewing === row.id
                return (
                  <article key={row.id} className={`typeset-history-row${previewing ? ' is-previewing' : ''}`} data-kind={row.kind}>
                    <header>
                      <Icon name={ICONS[row.kind] ?? 'clock'} />
                      <span className={`typeset-history-title${row.name ? ' is-named' : ''}`}>{row.name ?? time(row.timestamp)}</span>
                      {row.name ? <span className="typeset-history-time">{time(row.timestamp)}</span> : null}
                    </header>
                    {row.summary.slice(0, 4).map((line, index) => <p key={index} className="typeset-history-summary">{line}</p>)}
                    {row.summary.length > 4 ? <p className="typeset-history-more">and {row.summary.length - 4} more</p> : null}
                    <div className="typeset-history-actions">
                      <button type="button" disabled={previewing} onClick={() => send('previewTypesetVersion', { id: row.id })}>{previewing ? 'Previewing' : 'Preview'}</button>
                      <button type="button" onClick={() => send('previewTypesetVersion', { id: row.id, compare: true })}>Compare</button>
                      <button type="button" onClick={() => restore(row)}>Restore…</button>
                      <span className="typeset-history-spacer" />
                      <button type="button" aria-label="More" onClick={(event) => menu(event, row)}><Icon name="more" /></button>
                    </div>
                  </article>
                )
              })}
            </section>
          ))}
        </div>
      ) : (
        <div className="inspector-placeholder">
          <Icon name="type-style" size={20} />
          <strong>No Typeset Versions Yet</strong>
          <span>A version is kept as you typeset the book, and each time it is printed or exported.</span>
        </div>
      )}
      <p className="typeset-history-footer">
        {rows.length ? `${rows.length} typeset ${rows.length === 1 ? 'version' : 'versions'} of this book` : ''}
      </p>
    </div>
  )
}
