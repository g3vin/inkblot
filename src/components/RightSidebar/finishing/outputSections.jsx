/**
 * The Print & Export tab's sections: a script's production tools, the book checked against a
 * print-on-demand service, its covers, and printing sheets to bind by hand.
 */
import { useEffect, useRef, useState } from 'react'
import { FormRow, Popover, Button } from '../../../ui'
import { popUpNativeMenu } from '../../../ui/useNativeMenu'
import Icon from '../../../ui/Icon.jsx'
import FinishingSection from './FinishingSection'
import { Caution, LengthRow, Note, PickerRow, ToggleRow } from './controls'
import { choosePath, fileUrl, readingTime } from './finishingText'
import { SECTION } from './sectionIds'
import { describeLength } from './units'

/* ---------------- script production ---------------- */

export function ScriptProductionSection({ layout, script }) {
  const [sides, setSides] = useState(false)
  const sidesRef = useRef(null)
  const report = (kind) => ({
    text: kind[0].toUpperCase() + kind.slice(1),
    items: [
      { text: 'Print…', action: () => layout.scriptReport(kind, 'print') },
      { text: 'Save as spreadsheet (CSV)…', action: () => layout.scriptReport(kind, 'csv') },
    ],
  })
  const scenes = script.scenes.length === 1 ? '1 scene' : `${script.scenes.length} scenes`
  const cast = script.characters.length === 1 ? '1 speaking part' : `${script.characters.length} speaking parts`
  return (
    <FinishingSection id={SECTION.script} title="Script production" note={`${scenes}, ${cast}.`}>
      <PickerRow label="Scene numbers" value={script.sceneNumbers} onChange={layout.setSceneNumbers} options={[{ value: 'off', label: 'None' }, { value: 'on', label: 'Numbered' }, { value: 'locked', label: 'Locked' }]} />
      {script.sceneNumbers === 'locked' ? <Caution>A scene added now takes a letter — 12A between 12 and 13 — so pages already sent out keep their numbers.</Caution> : null}
      <PickerRow
        label="Highlight"
        value={layout.printOptions.highlightCharacter}
        onChange={(highlightCharacter) => layout.setPrintOptions({ highlightCharacter })}
        options={[{ value: '', label: 'No one' }, ...script.characters.map((name) => ({ value: name, label: name.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\B\w+/g, (w) => w.toLowerCase()) }))]}
      />
      <FormRow label="Reports">
        <button type="button" className="fin-button" onClick={(event) => popUpNativeMenu(event, [report('characters'), report('scenes'), report('locations')])}>Report <Icon name="chevron-down" /></button>
      </FormRow>
      <FormRow label="Sides">
        <button ref={sidesRef} type="button" className="fin-button" disabled={!script.scenes.length} onClick={() => setSides(true)}>Print sides…</button>
        <Popover anchorRef={sidesRef} open={sides} onClose={() => setSides(false)} align="end" className="fin-sides">
          <SidesPicker scenes={script.scenes} onPrint={(chosen) => { setSides(false); layout.printSides(chosen) }} />
        </Popover>
      </FormRow>
    </FinishingSection>
  )
}

function SidesPicker({ scenes, onPrint }) {
  const [chosen, setChosen] = useState(() => new Set())
  const toggle = (index) => setChosen((was) => {
    const next = new Set(was)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    return next
  })
  return (
    <div className="fin-sides-body">
      <strong>Print sides</strong>
      <p className="fin-note">The pages the chosen scenes are on, numbered as in the whole script.</p>
      <ul className="fin-sides-list">
        {scenes.map((scene, index) => (
          <li key={index}>
            <label>
              <input type="checkbox" checked={chosen.has(index)} onChange={() => toggle(index)} />
              <span className="fin-tabular fin-muted">{scene.number ?? index + 1}</span>
              <span className="fin-grow fin-ellipsis">{scene.heading}</span>
              {scene.page > 0 ? <span className="fin-tabular fin-muted">p. {scene.page}</span> : null}
            </label>
          </li>
        ))}
      </ul>
      <div className="fin-header-row">
        <Button onClick={() => setChosen(chosen.size === scenes.length ? new Set() : new Set(scenes.map((_, i) => i)))}>{chosen.size === scenes.length ? 'Choose none' : 'Choose all'}</Button>
        <span className="fin-grow" />
        <Button variant="filled" disabled={!chosen.size} onClick={() => onPrint([...chosen].sort((a, b) => a - b))}>Print…</Button>
      </div>
    </div>
  )
}

/* ---------------- publishing ---------------- */

const SEVERITY_ICONS = { error: 'close', warning: 'warning', note: 'number' }

export function PublishingSection({ layout }) {
  const { state, book, unit } = layout
  const report = state.publishing
  const publishing = { service: 'none', paper: 'cream', ...(book.publishing || {}) }
  const set = (patch) => layout.applyBook({ publishing: { ...publishing, ...patch } })
  const [counting, setCounting] = useState(false)
  useEffect(() => { setCounting(false) }, [report])
  useEffect(() => {
    if (!counting) return undefined
    // Never spin for ever: a count that failed says so in the header.
    const timer = setTimeout(() => setCounting(false), 120000)
    return () => clearTimeout(timer)
  }, [counting])
  const issues = report?.issues ?? []
  return (
    <FinishingSection
      id={SECTION.publishing}
      title="Publishing"
      note={state.scope === 'document' ? 'For this document. Choose Book in the header to check the whole book.' : 'For the whole book, at its page setup. Count the pages after changing the text or the setup.'}
    >
      <PickerRow label="Printed by" value={publishing.service} onChange={(service) => set({ service })} options={[{ value: 'none', label: 'Not chosen' }, { value: 'kdp', label: 'Amazon KDP' }, { value: 'ingramSpark', label: 'IngramSpark' }]} />
      <PickerRow label="Paper" value={publishing.paper} onChange={(paper) => set({ paper })} options={[{ value: 'cream', label: 'Cream' }, { value: 'white', label: 'White' }, { value: 'color', label: 'Colour' }]} />
      <FormRow label="Pages">
        {report?.pageCount > 0 ? <span className="fin-tabular">{report.pageCount}{report.measured ? '' : ' on screen'}</span> : <span className="fin-muted">Not counted</span>}
        {counting ? <span className="fin-spinner" aria-label="Counting" /> : (
          <button type="button" className="fin-button is-small" title="Lay out everything Print covers, as it would print, to count its pages and words" onClick={() => { setCounting(true); layout.measure() }}>
            {report?.measured ? 'Recount' : 'Count'}
          </button>
        )}
      </FormRow>
      {report?.words > 0 ? (
        <>
          <FormRow label="Words"><span className="fin-tabular">{report.words.toLocaleString()}</span></FormRow>
          <FormRow label="Reading time"><span>{readingTime(Math.round(report.readingMinutes))}</span></FormRow>
        </>
      ) : null}
      {report?.pageCount > 0 ? (
        <>
          <FormRow label="Spine"><span className="fin-tabular">{describeLength(report.spineWidthMm, unit)}</span></FormRow>
          <Note>{report.spineText
            ? 'Wide enough for the title on the spine. Check the service’s cover calculator before the cover goes out.'
            : 'Under 80 pages the spine is too thin for text. Check the service’s cover calculator before the cover goes out.'}</Note>
        </>
      ) : null}
      {publishing.service !== 'none' ? (issues.length ? issues.map((issue) => (
        <div key={issue.id} className="fin-preflight" data-severity={issue.severity}>
          <span className="fin-preflight-icon"><Icon name={SEVERITY_ICONS[issue.severity] ?? 'number'} /></span>
          <span className="fin-grow">{issue.message}</span>
          {issue.fixLabel && issue.fixedSetup ? <button type="button" className="fin-button is-small" onClick={() => layout.fixPreflight(issue)}>{issue.fixLabel}</button> : null}
        </div>
      )) : (
        <p className="fin-ok"><Icon name="verified" /> {report?.pageCount > 0 ? 'Ready for the printer.' : 'The setup passes. Count the pages to check the rest.'}</p>
      )) : null}
    </FinishingSection>
  )
}

/* ---------------- the cover ---------------- */

const PARTS = [['front', 'Front', 'frontFile'], ['back', 'Back', 'backFile'], ['spine', 'Spine', 'spineFile'], ['wrap', 'Whole wrap', 'wrapFile']]

export function CoverSection({ layout }) {
  const cover = layout.state.cover
  const active = cover?.sets?.find((set) => set.id === cover.active)
  const [renaming, setRenaming] = useState(null)
  const choose = async (part) => {
    const path = await choosePath({ title: `Choose a picture for the cover’s ${part}` })
    if (path) layout.setCoverImage(part, path)
  }
  const exportScope = layout.scope === 'document' ? 'folder' : layout.scope
  return (
    <FinishingSection id={SECTION.cover} title="Cover" note="One PDF of back, spine and front with ⅛″ bleed, as KDP and IngramSpark take it. The front is also the e-book’s cover.">
      {cover?.sets?.length ? (
        <div className="fin-cover-strip">
          {cover.sets.map((set) => (
            <button
              key={set.id}
              type="button"
              className={`fin-cover-card${set.id === cover.active ? ' is-current' : ''}`}
              title={set.id === cover.active ? 'The cover in use' : 'Use this version'}
              onClick={() => layout.editCovers('activate', { id: set.id })}
              onContextMenu={(event) => popUpNativeMenu(event, [
                { text: 'Rename…', action: () => setRenaming(set.id) },
                { text: 'Duplicate', action: () => layout.editCovers('duplicate', { id: set.id }) },
                { text: 'Delete…', action: () => { if (window.confirm?.(`Delete the cover “${set.name}”? Its pictures stay in the project.`) ?? true) layout.editCovers('delete', { id: set.id }) } },
              ])}
            >
              {set.frontFile || set.wrapFile ? <img src={fileUrl(set.frontFile ?? set.wrapFile)} alt="" /> : <span className="fin-cover-blank"><Icon name="book" /></span>}
              {renaming === set.id ? (
                <input
                  autoFocus
                  className="fin-input"
                  defaultValue={set.name}
                  aria-label="Cover name"
                  onClick={(event) => event.stopPropagation()}
                  onBlur={(event) => { layout.editCovers('rename', { id: set.id, name: event.target.value }); setRenaming(null) }}
                  onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setRenaming(null) }}
                />
              ) : <span className="fin-cover-name">{set.name}</span>}
            </button>
          ))}
        </div>
      ) : null}
      <div className="fin-header-row">
        <button type="button" className="fin-button is-small" onClick={() => layout.editCovers('add')}>New version</button>
        {active ? <button type="button" className="fin-button is-small" onClick={() => layout.editCovers('duplicate', { id: active.id })}>Duplicate</button> : null}
        {active ? <button type="button" className="fin-button is-small" onClick={() => setRenaming(active.id)}>Rename…</button> : null}
      </div>
      {active ? (
        <>
          {PARTS.map(([part, label, key]) => (
            <FormRow key={part} label={label}>
              {active[key] ? <img className="fin-thumb" src={fileUrl(active[key])} alt="" /> : null}
              <button type="button" className="fin-button is-small" onClick={() => choose(part)}>{active[key] ? 'Change…' : 'Choose…'}</button>
              {active[key] ? <button type="button" className="fin-button is-small is-destructive" onClick={() => layout.setCoverImage(part, null)}>Remove</button> : null}
            </FormRow>
          ))}
          <PickerRow label="Fit" value={active.fit} onChange={(fit) => layout.editCovers('setFit', { id: active.id, fit })} options={[{ value: 'fill', label: 'Fill, cropping' }, { value: 'fit', label: 'Fit inside' }, { value: 'stretch', label: 'Stretch' }]} />
        </>
      ) : <button type="button" className="fin-button" onClick={() => choose('front')}>Choose a front…</button>}
      {cover ? (
        <>
          <FormRow label="Full wrap"><span className="fin-tabular fin-muted">{cover.wrapWidthMm.toFixed(1)} × {cover.wrapHeightMm.toFixed(1)} mm</span></FormRow>
          <FormRow label="Spine"><span className="fin-tabular fin-muted">{cover.pageCount > 0 ? `${cover.spineWidthMm.toFixed(1)} mm · ${cover.pageCount} pages` : 'Count the pages'}</span></FormRow>
          {(cover.checks ?? []).map((issue) => (issue.severity === 'note' ? <Note key={issue.id}>{issue.message}</Note> : <Caution key={issue.id}>{issue.message}</Caution>))}
        </>
      ) : null}
      <div className="fin-header-row">
        <button type="button" className="fin-button" onClick={layout.showCover}>Show the cover</button>
        <span className="fin-grow" />
        <button type="button" className="fin-button" disabled={!active} onClick={() => layout.exportAs('coverPdf', exportScope)}>Export cover PDF…</button>
      </div>
    </FinishingSection>
  )
}

/* ---------------- hand binding ---------------- */

export function BindingSection({ layout }) {
  const { state, book, catalog, unit } = layout
  const binding = book.binding
  const set = (patch) => layout.applyBook({ binding: { ...binding, ...patch } })
  const presets = catalog?.presets ?? []
  const scope = state.scope === 'project' ? 'project' : 'folder'
  const on = binding.binding !== 'none'
  const advice = catalog?.signatureAdvice?.find((a) => a.sheets === binding.sheetsPerSignature)
  return (
    <FinishingSection
      id={SECTION.binding}
      title="Hand binding"
      note={on
        ? 'Printed double-sided (flip on the short edge), folded and nested, the sheets read in order. Paper thickness moves inner pages toward the spine to allow for creep.'
        : 'Lays the book’s pages out on sheets to fold, nest and sew or staple — for making a book at home.'}
    >
      <ToggleRow label="Print for hand binding" checked={on} onChange={(yes) => set({ binding: yes ? 'signatures' : 'none' })} />
      {on ? (
        <>
          <PickerRow label="Binding" value={binding.binding} onChange={(value) => set({ binding: value })} options={[{ value: 'signatures', label: 'Sewn signatures' }, { value: 'saddle', label: 'Saddle stitch (booklet)' }, { value: 'perfect', label: 'Perfect bound' }]} />
          {binding.binding === 'signatures' ? (
            <>
              <PickerRow label="Signature" value={String(binding.sheetsPerSignature)} onChange={(v) => set({ sheetsPerSignature: Number(v) })} options={[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: String(n), label: `${n} sheet${n === 1 ? '' : 's'} · ${n * 4} pages` }))} />
              {advice ? <Note>{advice.label}</Note> : null}
            </>
          ) : null}
          <PickerRow label="Sheet" value={binding.sheetPresetId} onChange={(sheetPresetId) => set({ sheetPresetId })} options={['letter', 'a4', 'legal', 'tabloid', 'a3'].map((id) => ({ value: id, label: presets.find((p) => p.id === id)?.label ?? id }))} />
          <PickerRow label="Pages on the sheet" value={binding.sheetFit} onChange={(sheetFit) => set({ sheetFit })} options={[{ value: 'actualSize', label: 'Actual size, with crop marks' }, { value: 'fit', label: 'Scaled to fit' }]} />
          <PickerRow label="Double-Sided" value={binding.duplex} onChange={(duplex) => set({ duplex })} options={[{ value: 'automatic', label: 'Printer does both sides' }, { value: 'manual', label: 'By hand: fronts, then backs' }]} />
          <LengthRow label="Paper thickness" mm={binding.paperThicknessMm} unit={unit} digits={unit === 'in' ? 4 : 2} onCommit={(paperThicknessMm) => set({ paperThicknessMm })} />
          <ToggleRow label="Crop and fold marks" checked={binding.cropMarks} onChange={(cropMarks) => set({ cropMarks })} />
          <ToggleRow label="Add a folding guide" checked={binding.includeGuide} onChange={(includeGuide) => set({ includeGuide })} />
          <div className="fin-header-row">
            <button type="button" className="fin-button" onClick={() => layout.print(scope, true)}>Print for binding…</button>
            <button type="button" className="fin-button" onClick={() => layout.exportAs('pdf', scope, true)}>Export PDF…</button>
          </div>
        </>
      ) : null}
    </FinishingSection>
  )
}
