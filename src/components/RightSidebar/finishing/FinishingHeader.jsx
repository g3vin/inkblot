/**
 * FinishingHeader — the top of the Typeset and Print & Export tabs: what is being
 * worked on, Print and Export, and where the last job got to
 * (FinishingActionHeader.swift).
 *
 * Print and Export are on Print & Export only; Typeset shows what is being worked on
 * and where the last job got to. The scope it sets — this document, or its book — is
 * also what Typeset edits.
 */
import { useRef, useState } from 'react'
import { Button, Popover, Segmented, Sheet } from '../../../ui'
import { popUpNativeMenu } from '../../../ui/useNativeMenu'
import { exportMenuItems } from '../../toolbar/items/exportMenu'
import { describeJob } from '../../../print/usePrintJobStatus'
import Icon from '../../../ui/Icon.jsx'
import { isDefaultPrint, printSummary } from './usePageLayout'
import { UNITS } from './units'
import { SECTION_IDS } from './sectionIds'
import { writeSectionState } from '../../../ui/sectionState'

const running = (job) => ['preparing', 'laying', 'writing'].includes(job?.phase)

export default function FinishingHeader({ layout, showsActions = true }) {
  const { state, scope } = layout
  const [goingTo, setGoingTo] = useState(false)
  const [goTo, setGoTo] = useState(1)
  const [author, setAuthor] = useState(false)
  const [options, setOptions] = useState(false)
  const optionsRef = useRef(null)
  const pageRef = useRef(null)
  const bindable = scope !== 'document' && layout.bindingEnabled

  const optionsMenu = (event) => popUpNativeMenu(event, [
    { text: 'Units', items: Object.entries(UNITS).map(([id, unit]) => ({ text: unit.label, checked: layout.unit === id, action: () => layout.setUnit(id) })) },
    { text: 'Author Details…', action: () => setAuthor(true) },
    { separator: true },
    { text: 'Expand All Sections', action: () => { SECTION_IDS.forEach((id) => writeSectionState(id, true)); window.dispatchEvent(new CustomEvent('inkblot:finishing-sections')) } },
    { text: 'Collapse All Sections', action: () => { SECTION_IDS.forEach((id) => writeSectionState(id, false)); window.dispatchEvent(new CustomEvent('inkblot:finishing-sections')) } },
  ])

  const ctx = { layout: state, send: (type, payload) => {
    if (type === 'exportDocument') layout.exportAs(payload.format, payload.scope, payload.bound)
    else if (type === 'exportAgain') layout.exportAgain()
    else if (type === 'exportAllEditions') layout.exportAllEditions()
  } }

  return (
    <div className="fin-header">
      <div className="fin-header-row">
        <Segmented
          value={scope === 'document' ? 'document' : 'book'}
          onChange={(value) => layout.setScope(value === 'document' ? 'document' : (scope === 'project' ? 'project' : 'folder'))}
          label="Work on"
          stretch
          options={[{ value: 'document', label: 'This Document' }, { value: 'book', label: 'Book' }]}
        />
        <button type="button" className="reference-icon-button" aria-label="Options" title="Units and view options" onClick={optionsMenu}>
          <Icon name="more" />
        </button>
      </div>

      {showsActions ? (
        <div className="fin-header-row">
          <Button
            variant="filled"
            className="fin-grow"
            disabled={!layout.hasDocument || running(layout.job)}
            onClick={() => layout.print(scope)}
            onContextMenu={bindable ? (event) => popUpNativeMenu(event, [{ text: 'Print for Binding…', action: () => layout.print(scope, true) }]) : undefined}
          >
            Print…
          </Button>
          <button
            ref={optionsRef}
            type="button"
            className={`reference-icon-button${isDefaultPrint(layout.printOptions) ? '' : ' is-on'}`}
            aria-label="Print Options"
            title="Print options: pages, the current chapter, the selection, a watermark"
            onClick={() => setOptions((open) => !open)}
          >
            <Icon name="filter" />
          </button>
          <Button
            variant="tinted"
            className="fin-grow"
            disabled={!layout.hasDocument || running(layout.job)}
            onClick={(event) => popUpNativeMenu(event, exportMenuItems(ctx, { bindable }))}
          >
            Export <Icon name="chevron-down" />
          </Button>
          <Popover anchorRef={optionsRef} open={options} onClose={() => setOptions(false)} align="end" className="fin-print-options">
            <PrintOptions layout={layout} onPrint={() => { setOptions(false); layout.print(scope) }} />
          </Popover>
        </div>
      ) : null}

      <div className="fin-status">
        {layout.job ? (
          <div className={`fin-job is-${layout.job.phase}`}>
            {running(layout.job) ? <progress value={layout.job.phase === 'laying' && layout.job.total > 1 ? layout.job.done : undefined} max={layout.job.total || undefined} /> : null}
            <span>{describeJob(layout.job)}</span>
            {layout.job.phase === 'done' && layout.job.path ? (
              <button type="button" className="reference-link" onClick={() => import('@tauri-apps/plugin-opener').then(({ revealItemInDir }) => revealItemInDir(layout.job.path)).catch(() => {})}>Show in Finder</button>
            ) : null}
            {layout.job.phase === 'failed' ? <button type="button" className="reference-icon-button" aria-label="Dismiss" onClick={layout.dismissJob}><Icon name="close" /></button> : null}
          </div>
        ) : printSummary(layout.printOptions) ? (
          <div className="fin-job is-options">
            <span>{printSummary(layout.printOptions)}</span>
            <button type="button" className="reference-link" onClick={layout.resetPrintOptions}>Reset</button>
          </div>
        ) : state ? (
          state.scope !== 'document' ? (
            <span>{state.book?.title || 'Book'} · {state.bookChapters?.length ?? 0} chapter{state.bookChapters?.length === 1 ? '' : 's'}</span>
          ) : state.enabled && state.pageCount > 0 ? (
            <>
              <button ref={pageRef} type="button" className="reference-link" onClick={() => { setGoTo(state.currentPage); setGoingTo(true) }}>
                Page {state.currentPage} of {state.pageCount}
              </button>
              <Popover anchorRef={pageRef} open={goingTo} onClose={() => setGoingTo(false)} className="fin-goto">
                <form onSubmit={(event) => { event.preventDefault(); layout.goToPage(Math.min(Math.max(1, Number(goTo) || 1), state.pageCount)); setGoingTo(false) }}>
                  Go to page <input autoFocus type="number" min={1} max={state.pageCount} value={goTo} onChange={(event) => setGoTo(event.target.value)} /> of {state.pageCount}
                  <Button type="submit" variant="filled">Go</Button>
                </form>
              </Popover>
            </>
          ) : state.docPath ? (
            <button type="button" className="reference-link" onClick={() => layout.setMode('typeset')}>Typeset to see the page count</button>
          ) : null
        ) : null}
      </div>

      {author ? <AuthorSheet profile={state?.author} onSave={layout.setAuthor} onClose={() => setAuthor(false)} /> : null}
    </div>
  )
}

function PrintOptions({ layout, onPrint }) {
  const draft = layout.printOptions
  return (
    <div className="fin-print-options-body">
      <label className="fin-field">
        <span>Print</span>
        <select className="ui-select" value={draft.range} onChange={(event) => layout.setPrintOptions({ range: event.target.value })}>
          <option value="all">Everything</option>
          <option value="currentChapter">The Current Chapter</option>
          <option value="selection" disabled={!layout.state?.hasSelection}>The Selection</option>
        </select>
      </label>
      <label className="fin-field">
        <span>Pages</span>
        <input className="fin-input" value={draft.pages} placeholder="All, or e.g. 3–7, 10" onChange={(event) => layout.setPrintOptions({ pages: event.target.value })} />
      </label>
      <label className="fin-field">
        <span>Watermark</span>
        <input className="fin-input" value={draft.watermark} placeholder="e.g. DRAFT, or Copy for {recipient}" onChange={(event) => layout.setPrintOptions({ watermark: event.target.value })} />
      </label>
      {draft.watermark ? (
        <label className="fin-field">
          <span>A Copy Each For</span>
          <textarea className="fin-input" rows={3} value={draft.recipients} onChange={(event) => layout.setPrintOptions({ recipients: event.target.value })} />
          <small className="fin-note">One name a line. Each copy has its reader’s name in place of {'{recipient}'}; as a PDF, each is a file of its own.</small>
        </label>
      ) : null}
      <div className="fin-header-row">
        <Button onClick={layout.resetPrintOptions} disabled={isDefaultPrint(draft)}>Reset</Button>
        <span className="fin-grow" />
        <Button variant="filled" onClick={onPrint}>Print…</Button>
      </div>
    </div>
  )
}

const EMPTY_AUTHOR = { byline: '', legalName: '', address: '', email: '', phone: '', agent: '' }

/** The writer's name and contact details, for title pages and the {author} tokens. */
export function AuthorSheet({ profile, onSave, onClose }) {
  const [draft, setDraft] = useState({ ...EMPTY_AUTHOR, ...(profile || {}) })
  const field = (key, label, placeholder, multiline) => (
    <label className="fin-field">
      <span>{label}</span>
      {multiline
        ? <textarea className="fin-input" rows={2} value={draft[key]} placeholder={placeholder} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
        : <input className="fin-input" value={draft[key]} placeholder={placeholder} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />}
    </label>
  )
  return (
    <Sheet
      title="Author Details"
      width={420}
      onClose={onClose}
      footer={<><span className="ui-sheet-footer-spacer" /><Button onClick={onClose}>Cancel</Button><Button variant="filled" onClick={() => { onSave(draft); onClose() }}>Save</Button></>}
    >
      <div className="fin-form">
        {field('byline', 'Byline', 'The name on the cover')}
        {field('legalName', 'Legal Name', 'If different, for contracts')}
        {field('address', 'Address', 'Street, city, postcode', true)}
        {field('email', 'Email')}
        {field('phone', 'Phone')}
        {field('agent', 'Agent', 'Agent and agency')}
        <p className="fin-note">Printed on manuscript and screenplay title pages. Kept on this computer only.</p>
      </div>
    </Sheet>
  )
}

