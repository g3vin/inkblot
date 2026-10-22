/**
 * FinishingHeader — the top of the Typeset and Print & Export tabs
 * (FinishingActionHeader.swift), on the panel anatomy (DESIGN.md §6):
 *
 *   - in the header row: what is being worked on (this document, or its book) and ⋯
 *     (units, author details, print options, sections open or shut);
 *   - Print & Export only: Print and Export, side by side;
 *   - one quiet line for where the last job got to, or the page count.
 *
 * The scope it sets is also what Typeset edits.
 */
import { useRef, useState } from 'react'
import { Button, Field, Input, MenuItem, MenuLabel, MenuSeparator, MoreMenu, PanelActions, Popover, ScopeMenu, SelectMenu, Sheet, TextArea } from '../../../ui'
import { popUpNativeMenu } from '../../../ui/useNativeMenu'
import { exportMenuItems } from '../../toolbar/items/exportMenu'
import { describeJob } from '../../../print/usePrintJobStatus'
import Icon from '../../../ui/Icon.jsx'
import IconButton from '../../../ui/IconButton.jsx'
import { isDefaultPrint, printSummary } from './usePageLayout'
import { UNITS } from './units'
import { SECTION_IDS } from './sectionIds'
import { writeSectionState } from '../../../ui/sectionState'

const running = (job) => ['preparing', 'laying', 'writing'].includes(job?.phase)

const SCOPES = [{ value: 'document', label: 'This document' }, { value: 'book', label: 'Book' }]

const setAllSections = (open) => {
  SECTION_IDS.forEach((id) => writeSectionState(id, open))
  window.dispatchEvent(new CustomEvent('inkblot:finishing-sections'))
}

export default function FinishingHeader({ layout, showsActions = true }) {
  const { state, scope } = layout
  const [goingTo, setGoingTo] = useState(false)
  const [goTo, setGoTo] = useState(1)
  const [author, setAuthor] = useState(false)
  const [options, setOptions] = useState(false)
  const printRef = useRef(null)
  const pageRef = useRef(null)
  const bindable = scope !== 'document' && layout.bindingEnabled

  const ctx = { layout: state, send: (type, payload) => {
    if (type === 'exportDocument') layout.exportAs(payload.format, payload.scope, payload.bound)
    else if (type === 'exportAgain') layout.exportAgain()
    else if (type === 'exportAllEditions') layout.exportAllEditions()
  } }

  const book = state?.scope !== 'document' ? `${state?.book?.title || 'Book'} · ${state?.bookChapters?.length ?? 0} chapter${state?.bookChapters?.length === 1 ? '' : 's'}` : undefined

  return (
    <div className="fin-header">
      <PanelActions>
        <ScopeMenu
          label="Work on"
          value={scope === 'document' ? 'document' : 'book'}
          onChange={(value) => layout.setScope(value === 'document' ? 'document' : (scope === 'project' ? 'project' : 'folder'))}
          options={SCOPES.map((option) => ({ ...option, hint: option.value === 'book' ? book : undefined }))}
        />
        <MoreMenu label={showsActions ? 'More print and export options' : 'More typeset options'}>
          {showsActions ? (
            <>
              <MenuItem icon="sliders" onSelect={() => setOptions(true)}>Print options…</MenuItem>
              <MenuSeparator />
            </>
          ) : null}
          <MenuLabel>Units</MenuLabel>
          {Object.entries(UNITS).map(([id, unit]) => (
            <MenuItem key={id} checked={layout.unit === id} onSelect={() => layout.setUnit(id)}>{unit.label}</MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem icon="characters" onSelect={() => setAuthor(true)}>Author details…</MenuItem>
          <MenuItem onSelect={() => setAllSections(true)}>Expand all sections</MenuItem>
          <MenuItem onSelect={() => setAllSections(false)}>Collapse all sections</MenuItem>
        </MoreMenu>
      </PanelActions>

      {showsActions ? (
        <div className="fin-actions">
          <Button
            ref={printRef}
            variant="filled"
            className="fin-grow"
            disabled={!layout.hasDocument || running(layout.job)}
            onClick={() => layout.print(scope)}
          >
            Print…
          </Button>
          <Button
            variant="tinted"
            className="fin-grow"
            disabled={!layout.hasDocument || running(layout.job)}
            onClick={(event) => popUpNativeMenu(event, exportMenuItems(ctx, { bindable }))}
          >
            Export <Icon name="chevron-down" />
          </Button>
          <Popover anchorRef={printRef} open={options} onClose={() => setOptions(false)} align="start" className="fin-print-options">
            <PrintOptions layout={layout} onPrint={() => { setOptions(false); layout.print(scope) }} />
          </Popover>
        </div>
      ) : null}

      <FinishingStatus layout={layout} state={state} pageRef={pageRef} goingTo={goingTo} setGoingTo={setGoingTo} goTo={goTo} setGoTo={setGoTo} />

      {author ? <AuthorSheet profile={state?.author} onSave={layout.setAuthor} onClose={() => setAuthor(false)} /> : null}
    </div>
  )
}

/** Where the last job got to, the print options in force, or the page count: one quiet line. */
function FinishingStatus({ layout, state, pageRef, goingTo, setGoingTo, goTo, setGoTo }) {
  if (layout.job) {
    return (
      <div className={`fin-status ib-meta fin-job is-${layout.job.phase}`} role="status">
        {running(layout.job) ? <progress value={layout.job.phase === 'laying' && layout.job.total > 1 ? layout.job.done : undefined} max={layout.job.total || undefined} /> : null}
        <span>{describeJob(layout.job)}</span>
        {layout.job.phase === 'done' && layout.job.path ? (
          <Button size="capsule" onClick={() => import('@tauri-apps/plugin-opener').then(({ revealItemInDir }) => revealItemInDir(layout.job.path)).catch(() => {})}>Show in Finder</Button>
        ) : null}
        {layout.job.phase === 'failed' ? <IconButton icon="close" label="Dismiss" size="capsule" onClick={layout.dismissJob} /> : null}
      </div>
    )
  }
  if (printSummary(layout.printOptions)) {
    return (
      <div className="fin-status ib-meta fin-job is-options">
        <span>{printSummary(layout.printOptions)}</span>
        <Button size="capsule" onClick={layout.resetPrintOptions}>Reset</Button>
      </div>
    )
  }
  if (!state || state.scope !== 'document') return null
  if (state.enabled && state.pageCount > 0) {
    return (
      <div className="fin-status ib-meta">
        <button ref={pageRef} type="button" className="fin-status-link" onClick={() => { setGoTo(state.currentPage); setGoingTo(true) }}>
          Page {state.currentPage} of {state.pageCount}
        </button>
        <Popover anchorRef={pageRef} open={goingTo} onClose={() => setGoingTo(false)} className="fin-goto">
          <form onSubmit={(event) => { event.preventDefault(); layout.goToPage(Math.min(Math.max(1, Number(goTo) || 1), state.pageCount)); setGoingTo(false) }}>
            Go to page <Input size="sm" autoFocus type="number" min={1} max={state.pageCount} value={goTo} onChange={(event) => setGoTo(event.target.value)} /> of {state.pageCount}
            <Button type="submit" variant="filled">Go</Button>
          </form>
        </Popover>
      </div>
    )
  }
  return state.docPath ? (
    <div className="fin-status ib-meta">
      <button type="button" className="fin-status-link" onClick={() => layout.setMode('typeset')}>Typeset to see the page count</button>
    </div>
  ) : null
}

const RANGES = [{ value: 'all', label: 'Everything' }, { value: 'currentChapter', label: 'The current chapter' }]

function PrintOptions({ layout, onPrint }) {
  const draft = layout.printOptions
  const ranges = [...RANGES, { value: 'selection', label: 'The selection', disabled: !layout.state?.hasSelection }]
  return (
    <div className="fin-print-options-body">
      <Field label="Print">
        <SelectMenu label="Print" value={draft.range} onChange={(range) => layout.setPrintOptions({ range })} options={ranges} />
      </Field>
      <Field label="Pages">
        <Input size="sm" value={draft.pages} placeholder="All, or e.g. 3–7, 10" onChange={(event) => layout.setPrintOptions({ pages: event.target.value })} />
      </Field>
      <Field label="Watermark">
        <Input size="sm" value={draft.watermark} placeholder="e.g. DRAFT, or Copy for {recipient}" onChange={(event) => layout.setPrintOptions({ watermark: event.target.value })} />
      </Field>
      {draft.watermark ? (
        <Field label="A copy for each of" hint="One name a line. Each copy has its reader’s name in place of {recipient}.">
          <TextArea rows={3} value={draft.recipients} onChange={(event) => layout.setPrintOptions({ recipients: event.target.value })} />
        </Field>
      ) : null}
      <div className="fin-actions">
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
    <Field label={label}>
      {multiline
        ? <TextArea rows={2} value={draft[key]} placeholder={placeholder} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
        : <Input value={draft[key]} placeholder={placeholder} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />}
    </Field>
  )
  return (
    <Sheet
      title="Author details"
      width={420}
      onClose={onClose}
      footer={<><span className="ui-sheet-footer-spacer" /><Button onClick={onClose}>Cancel</Button><Button variant="filled" onClick={() => { onSave(draft); onClose() }}>Save</Button></>}
    >
      <div className="fin-form">
        {field('byline', 'Byline', 'The name on the cover')}
        {field('legalName', 'Legal name', 'If different, for contracts')}
        {field('address', 'Address', 'Street, city, postcode', true)}
        {field('email', 'Email')}
        {field('phone', 'Phone')}
        {field('agent', 'Agent', 'Agent and agency')}
        <p className="fin-note">Printed on manuscript and screenplay title pages. Kept on this computer only.</p>
      </div>
    </Sheet>
  )
}

