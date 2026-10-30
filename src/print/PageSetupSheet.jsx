/**
 * PageSetupSheet.jsx — File ▸ Page Setup….
 *
 * It edits the same two things the Typeset tab does, through the same functions: the
 * document's page setup on its doc node, and its book's settings in preferences.
 *
 * Choices apply at once, so the pages behind the sheet reflow as they change; each
 * is one undo step in the document.
 */
import { useEffect, useMemo, useState } from 'react'

import { getPreference, setPreference } from '../lib/preferences'
import { Button, Dialog, FormRow, Input, Section, Segmented, SelectMenu, Toggle } from '../ui'
import { applyFormat, FORMAT_PRESETS, formatOf, writingFormatOf } from './formats'
import { SIGNATURE_GUIDANCE } from './imposition'
import { normalizePageSetup, resolvePageSetup, suggestedInsideMarginMm } from './pageSetup'
import { fromMm, PAGE_SIZE_GROUP_LABELS, PAGE_SIZE_PRESETS, matchPageSizePreset, toMm } from './pageSizes'
import { bookFolderForScope, getBookSettings, getPrintScope, setBookSettings, setPrintScope, usePrintLayoutStore } from './printLayoutStore'
import { BOOK_TYPOGRAPHY } from './typography'
import { useDocPageSetup } from './useDocPageSetup'
import { usePrintJobStatus } from './usePrintJobStatus'
import './PageSetupSheet.css'
import { EXPORT_EVENT, PRINT_EVENT } from '../lib/appEvents'

const UNIT_KEY = 'inkblot-page-units'
const defaultUnit = () => {
  const stored = getPreference(UNIT_KEY)
  if (stored) return stored
  return (navigator.language || '').endsWith('-US') ? 'in' : 'mm'
}

const round = (v, unit) => {
  const places = unit === 'in' ? 3 : unit === 'pt' ? 1 : 2
  return Math.round(v * 10 ** places) / 10 ** places
}

const blurOnEnter = (event) => { if (event.key === 'Enter') event.currentTarget.blur() }

/** A text or number field that commits when it loses focus (or on Enter). */
function Commit({ value, onCommit, ...rest }) {
  return (
    <Input
      key={String(value)}
      size="sm"
      defaultValue={value}
      onBlur={(event) => { if (event.target.value !== String(value)) onCommit(event.target.value) }}
      onKeyDown={blurOnEnter}
      {...rest}
    />
  )
}

function Length({ label, mm, unit, onChange }) {
  return (
    <FormRow label={label}>
      <Commit
        type="number"
        step="any"
        min="0"
        aria-label={label}
        className="pss-number"
        value={round(fromMm(mm, unit), unit)}
        onCommit={(raw) => {
          const value = Number.parseFloat(raw)
          if (Number.isFinite(value)) onChange(toMm(value, unit))
        }}
      />
      <span className="pss-unit ib-meta">{unit}</span>
    </FormRow>
  )
}

function Running({ label, value, onChange }) {
  return (
    <FormRow label={label} stacked>
      <div className="pss-running">
        {['left', 'center', 'right'].map((key) => (
          <Commit
            key={key}
            value={value[key]}
            aria-label={`${label}, ${key}`}
            placeholder={key[0].toUpperCase() + key.slice(1)}
            onCommit={(next) => onChange({ ...value, [key]: next })}
          />
        ))}
      </div>
    </FormRow>
  )
}

function Switch({ label, checked, onChange }) {
  return (
    <FormRow label={label}>
      <Toggle label={label} checked={checked} onChange={onChange} />
    </FormRow>
  )
}

const UNITS = [
  { value: 'in', label: 'Inches' },
  { value: 'mm', label: 'Millimetres' },
  { value: 'cm', label: 'Centimetres' },
  { value: 'pt', label: 'Points' },
]

const EXPORTS = [
  { value: 'pdf', label: 'PDF' },
  { value: 'epub', label: 'EPUB' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'html', label: 'HTML' },
]

export default function PageSetupSheet({ editor, projectName, docPath, pageCount = 0, onClose }) {
  usePrintLayoutStore()
  const own = useDocPageSetup(editor)
  const [unit, setUnit] = useState(defaultUnit)
  // Which setup the sheet edits: the document's own, or the one its whole book prints in.
  const [target, setTarget] = useState('document')
  const scope = getPrintScope(projectName)
  const folder = bookFolderForScope(projectName, docPath)
  const book = getBookSettings(projectName, folder)
  const bookSetupJson = book.pageSetup ? JSON.stringify(book.pageSetup) : ''
  const setup = useMemo(() => {
    const bookSetup = bookSetupJson ? JSON.parse(bookSetupJson) : null
    return target === 'book'
      ? normalizePageSetup(bookSetup || own)
      : resolvePageSetup({ docSetup: own, bookSetup }).setup
  }, [own, bookSetupJson, target])
  const { formatId, modified } = formatOf(setup)
  const job = usePrintJobStatus()

  useEffect(() => {
    setPreference(UNIT_KEY, unit)
  }, [unit])

  const applyBook = (patch) => setBookSettings(projectName, folder, { ...book, ...patch })
  const replace = (next) => {
    if (target === 'book') applyBook({ pageSetup: normalizePageSetup(next) })
    else editor?.chain().setPageSetup(next).run()
  }
  const apply = (patch) => replace({ ...setup, ...patch })
  const applyMargins = (patch) => apply({ margins: { ...setup.margins, ...patch } })
  const applyBinding = (patch) => applyBook({ binding: { ...book.binding, ...patch } })

  const sizeOptions = useMemo(() => {
    const out = new Map()
    for (const preset of PAGE_SIZE_PRESETS) {
      if (!out.has(preset.group)) out.set(preset.group, [])
      out.get(preset.group).push({ value: preset.id, label: preset.label })
    }
    return [
      ...[...out.entries()].map(([group, options]) => ({ label: PAGE_SIZE_GROUP_LABELS[group], options })),
      { value: 'custom', label: 'Custom' },
    ]
  }, [])

  const formatOptions = useMemo(() => [
    ...[...new Set(FORMAT_PRESETS.map((f) => f.group))].map((group) => ({
      label: group,
      options: FORMAT_PRESETS.filter((f) => f.group === group).map((f) => ({
        value: f.id,
        label: `${f.label}${f.id === formatId && modified ? ' (modified)' : ''}`,
      })),
    })),
    ...(formatId ? [] : [{ value: 'custom', label: 'Custom' }]),
  ], [formatId, modified])

  const setSize = (widthMm, heightMm) => {
    const match = matchPageSizePreset(widthMm, heightMm)
    apply({ widthMm, heightMm, presetId: match?.id || 'custom' })
  }
  const inside = setup.margins.insideMm + setup.margins.gutterMm
  const suggested = suggestedInsideMarginMm(Math.max(1, pageCount))
  const versoDiffers = Boolean(setup.versoHeader || setup.versoFooter)
  const exportOptions = book.binding.binding !== 'none' && scope !== 'document'
    ? [...EXPORTS, { value: 'pdf:bound', label: 'PDF for binding' }]
    : EXPORTS
  const typography = setup.typography
  const applyType = (patch) => apply({ typography: { ...typography, ...patch } })

  return (
    <Dialog
      eyebrow="Typeset"
      title="Page setup"
      onClose={onClose}
      size="medium"
      className="pss-sheet"
      footer={(
        <>
          <SelectMenu label="Units" value={unit} onChange={setUnit} options={UNITS} />
          <span className="ib-dialog-footer-spacer" />
          <Button variant="filled" onClick={onClose}>Done</Button>
        </>
      )}
    >
      <div className="pss-actions">
        <Segmented
          label="Print"
          value={scope}
          onChange={(value) => setPrintScope(projectName, value)}
          stretch
          options={[
            { value: 'document', label: 'This document' },
            { value: 'folder', label: 'Book' },
            { value: 'project', label: 'Whole project' },
          ]}
        />
        <div className="pss-action-row">
          <Button variant="tinted" onClick={() => window.dispatchEvent(new CustomEvent(PRINT_EVENT, { detail: { scope } }))}>Print…</Button>
          <SelectMenu
            label="Export"
            value=""
            onChange={(value) => {
              const [format, bound] = value.split(':')
              if (format) window.dispatchEvent(new CustomEvent(EXPORT_EVENT, { detail: { format, scope, bound: bound === 'bound' } }))
            }}
            options={[{ value: '', label: 'Export…', disabled: true }, ...exportOptions]}
          />
        </div>
        {job ? <p className={`pss-job ib-hint is-${job.phase}`} role="status">{job.text}</p> : null}
      </div>

      <Section id="page-setup.format" title="Format">
        <Segmented
          label="Edit"
          value={target}
          onChange={setTarget}
          stretch
          options={[{ value: 'document', label: 'This document' }, { value: 'book', label: 'Whole book' }]}
        />
        {target === 'book' ? <p className="ib-hint">Editing the setup every chapter of the book prints in.</p> : null}
        <FormRow label="Format">
          <SelectMenu
            label="Format"
            value={formatId || 'custom'}
            options={formatOptions}
            onChange={(value) => {
              const next = applyFormat(value)
              if (next) replace(next)
              // A script's format makes the document a script.
              const writing = writingFormatOf(value)
              if (writing && next) editor?.commands.setWritingFormat(writing)
            }}
          />
        </FormRow>
        {target === 'document' && book.pageSetup ? (
          <p className="ib-hint">This book prints every chapter in its own setup, so what is set here shows on screen and when this document is printed alone.</p>
        ) : null}
      </Section>

      <Section id="page-setup.page" title="Page">
        <FormRow label="Size">
          <SelectMenu
            label="Size"
            value={setup.presetId}
            options={sizeOptions}
            onChange={(value) => {
              const preset = PAGE_SIZE_PRESETS.find((p) => p.id === value)
              if (preset) apply({ presetId: preset.id, widthMm: preset.widthMm, heightMm: preset.heightMm })
            }}
          />
        </FormRow>
        <Length label="Width" mm={setup.widthMm} unit={unit} onChange={(v) => setSize(v, setup.heightMm)} />
        <Length label="Height" mm={setup.heightMm} unit={unit} onChange={(v) => setSize(setup.widthMm, v)} />
        <FormRow label="Orientation">
          <Segmented
            label="Orientation"
            value={setup.orientation}
            onChange={(orientation) => apply({ orientation })}
            options={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]}
          />
        </FormRow>
      </Section>

      <Section id="page-setup.margins" title="Margins">
        <Length label="Top" mm={setup.margins.topMm} unit={unit} onChange={(v) => applyMargins({ topMm: v })} />
        <Length label="Bottom" mm={setup.margins.bottomMm} unit={unit} onChange={(v) => applyMargins({ bottomMm: v })} />
        <Length label={setup.mirrorMargins ? 'Inside' : 'Left'} mm={setup.margins.insideMm} unit={unit} onChange={(v) => applyMargins({ insideMm: v })} />
        <Length label={setup.mirrorMargins ? 'Outside' : 'Right'} mm={setup.margins.outsideMm} unit={unit} onChange={(v) => applyMargins({ outsideMm: v })} />
        <Length label="Gutter" mm={setup.margins.gutterMm} unit={unit} onChange={(v) => applyMargins({ gutterMm: v })} />
        <Switch label="Mirror margins" checked={setup.mirrorMargins} onChange={(mirrorMargins) => apply({ mirrorMargins })} />
        {pageCount > 0 && inside + 0.05 < suggested ? (
          <p className="pss-warn ib-hint">
            For {pageCount} pages, binders suggest at least {round(fromMm(suggested, unit), unit)} {unit} inside.{' '}
            <Button variant="plain" onClick={() => applyMargins({ gutterMm: Math.max(0, suggested - setup.margins.insideMm) })}>Use it</Button>
          </p>
        ) : null}
      </Section>

      <Section id="page-setup.columns" title="Columns">
        <FormRow label="Columns">
          <SelectMenu
            label="Columns"
            value={String(setup.columns)}
            onChange={(value) => apply({ columns: Number(value) })}
            options={[1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))}
          />
        </FormRow>
        {setup.columns > 1 ? <Length label="Gap" mm={setup.columnGapMm} unit={unit} onChange={(v) => apply({ columnGapMm: v })} /> : null}
        {setup.columns > 1 ? <p className="ib-hint">Pages are edited as a single running column; Print, PDF and binding set the columns side by side.</p> : null}
      </Section>

      <Section id="page-setup.typography" title="Typography">
        <Switch
          label="Set type for print"
          checked={Boolean(typography)}
          onChange={(on) => apply({ typography: on ? { ...BOOK_TYPOGRAPHY } : undefined })}
        />
        {typography ? (
          <>
            <FormRow label="Font">
              <Commit aria-label="Font" value={typography.fontFamily} onCommit={(fontFamily) => applyType({ fontFamily })} />
            </FormRow>
            <FormRow label="Size">
              <Commit
                type="number"
                min="5"
                max="72"
                step="0.5"
                aria-label="Size"
                className="pss-number"
                value={typography.fontSizePt}
                onCommit={(raw) => applyType({ fontSizePt: Number(raw) || typography.fontSizePt })}
              />
              <span className="pss-unit ib-meta">pt</span>
            </FormRow>
            <FormRow label="Spacing">
              <SelectMenu
                label="Spacing"
                value={typography.lineSpacing}
                onChange={(lineSpacing) => applyType({ lineSpacing })}
                options={[
                  { value: 'single', label: 'Single' },
                  { value: 'oneAndAHalf', label: '1.5 lines' },
                  { value: 'double', label: 'Double' },
                  { value: 'multiple', label: 'Multiple' },
                  { value: 'exact', label: 'Exactly' },
                ]}
              />
            </FormRow>
            <Length label="Indent" mm={typography.firstLineIndentMm} unit={unit} onChange={(v) => applyType({ firstLineIndentMm: v })} />
            <FormRow label="Scene break">
              <Commit aria-label="Scene break" value={typography.sceneBreak} onCommit={(sceneBreak) => applyType({ sceneBreak })} />
            </FormRow>
            <FormRow label="Alignment">
              <Segmented
                label="Alignment"
                value={typography.alignment}
                onChange={(alignment) => applyType({ alignment })}
                options={[{ value: 'left', label: 'Ragged right' }, { value: 'justify', label: 'Justified' }]}
              />
            </FormRow>
            <p className="ib-hint">Type for print shows in Print Layout and on paper; the editor keeps your writing font.</p>
          </>
        ) : null}
        <Switch
          label="Add a title page when printing"
          checked={Boolean(setup.titlePage)}
          onChange={(on) => apply({ titlePage: on ? { style: 'book', showContact: false, showWordCount: false } : undefined })}
        />
      </Section>

      <Section id="page-setup.running" title="Header and footer">
        <Running label={versoDiffers ? 'Header, right' : 'Header'} value={setup.header} onChange={(header) => apply({ header })} />
        <Running label={versoDiffers ? 'Footer, right' : 'Footer'} value={setup.footer} onChange={(footer) => apply({ footer })} />
        <Switch
          label="Different on left-hand pages"
          checked={versoDiffers}
          onChange={(on) => apply(on
            ? { versoHeader: { ...setup.header }, versoFooter: { ...setup.footer } }
            : { versoHeader: undefined, versoFooter: undefined })}
        />
        {versoDiffers ? (
          <>
            <Running label="Header, left" value={setup.versoHeader || setup.header} onChange={(versoHeader) => apply({ versoHeader })} />
            <Running label="Footer, left" value={setup.versoFooter || setup.footer} onChange={(versoFooter) => apply({ versoFooter })} />
          </>
        ) : null}
        <Switch label="None on a chapter's first page" checked={setup.differentFirstPage} onChange={(differentFirstPage) => apply({ differentFirstPage })} />
        <FormRow label="Numbers">
          <SelectMenu
            label="Numbers"
            value={setup.pageNumberFormat}
            onChange={(pageNumberFormat) => apply({ pageNumberFormat })}
            options={[
              { value: 'arabic', label: '1, 2, 3' },
              { value: 'lowerRoman', label: 'i, ii, iii' },
              { value: 'upperRoman', label: 'I, II, III' },
            ]}
          />
        </FormRow>
        <FormRow label="Start at">
          <Commit
            type="number"
            min="0"
            aria-label="Start at"
            className="pss-number"
            value={setup.pageNumberStart}
            onCommit={(raw) => apply({ pageNumberStart: Number(raw) || 0 })}
          />
        </FormRow>
        <p className="ib-hint">Use {'{page}'}, {'{pages}'}, {'{title}'}, {'{chapter}'} and {'{author}'}. The chapter is the most recent Heading 1.</p>
      </Section>

      <Section id="page-setup.flow" title="Text flow">
        <FormRow label="Widows and orphans">
          <SelectMenu
            label="Widows and orphans"
            value={String(setup.widowOrphanLines)}
            onChange={(value) => apply({ widowOrphanLines: Number(value) })}
            options={[
              { value: '1', label: 'Off' },
              { value: '2', label: 'At least 2 lines' },
              { value: '3', label: 'At least 3 lines' },
            ]}
          />
        </FormRow>
        <p className="ib-hint">Keeps a paragraph from leaving a single line alone at the top or bottom of a page.</p>
        <Switch label="Chapters open on a right-hand page" checked={setup.chapterStartsOnRecto} onChange={(chapterStartsOnRecto) => apply({ chapterStartsOnRecto })} />
      </Section>

      <Section id="page-setup.book" title="Book">
        <FormRow label="Title"><Commit aria-label="Title" value={book.title} onCommit={(title) => applyBook({ title })} /></FormRow>
        <FormRow label="Author"><Commit aria-label="Author" value={book.author} onCommit={(author) => applyBook({ author })} /></FormRow>
        <FormRow label="Language"><Commit aria-label="Language" value={book.language} onCommit={(language) => applyBook({ language })} /></FormRow>
        <p className="ib-hint">{scope === 'project' ? 'The book is the whole project' : 'A book is this document\u2019s folder'}, its documents in file-tree order.</p>
      </Section>

      <Section id="page-setup.binding" title="Binding">
        <Switch
          label="Print for hand binding"
          checked={book.binding.binding !== 'none'}
          onChange={(on) => applyBinding({ binding: on ? 'signatures' : 'none' })}
        />
        {book.binding.binding !== 'none' ? (
          <FormRow label="Binding">
            <SelectMenu
              label="Binding"
              value={book.binding.binding}
              onChange={(binding) => applyBinding({ binding })}
              options={[
                { value: 'signatures', label: 'Sewn signatures' },
                { value: 'saddle', label: 'Saddle stitch (booklet)' },
                { value: 'perfect', label: 'Perfect bound' },
              ]}
            />
          </FormRow>
        ) : null}
        {book.binding.binding === 'signatures' ? (
          <>
            <FormRow label="Signature">
              <SelectMenu
                label="Signature"
                value={String(book.binding.sheetsPerSignature)}
                onChange={(value) => applyBinding({ sheetsPerSignature: Number(value) })}
                options={[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: String(n), label: `${n} sheet${n > 1 ? 's' : ''} · ${n * 4} pages` }))}
              />
            </FormRow>
            <ul className="pss-advice ib-hint">
              {SIGNATURE_GUIDANCE.map((g) => <li key={g.sheets} className={g.sheets === book.binding.sheetsPerSignature ? 'is-on' : ''}>{g.label}</li>)}
            </ul>
          </>
        ) : null}
        {book.binding.binding !== 'none' ? (
          <>
            <FormRow label="Sheet">
              <SelectMenu
                label="Sheet"
                value={book.binding.sheetPresetId}
                onChange={(sheetPresetId) => applyBinding({ sheetPresetId })}
                options={['letter', 'a4', 'legal', 'tabloid', 'a3'].map((id) => ({ value: id, label: PAGE_SIZE_PRESETS.find((p) => p.id === id)?.label }))}
              />
            </FormRow>
            <FormRow label="Pages">
              <SelectMenu
                label="Pages"
                value={book.binding.sheetFit}
                onChange={(sheetFit) => applyBinding({ sheetFit })}
                options={[{ value: 'actualSize', label: 'Actual size' }, { value: 'fit', label: 'Scale to fit' }]}
              />
            </FormRow>
            <FormRow label="Duplex">
              <SelectMenu
                label="Duplex"
                value={book.binding.duplex}
                onChange={(duplex) => applyBinding({ duplex })}
                options={[{ value: 'automatic', label: 'Printer does both sides' }, { value: 'manual', label: 'Manual: fronts, then backs' }]}
              />
            </FormRow>
            <FormRow label="Paper">
              <Commit
                type="number"
                step="0.01"
                min="0"
                aria-label="Paper thickness"
                className="pss-number"
                value={book.binding.paperThicknessMm}
                onCommit={(raw) => applyBinding({ paperThicknessMm: Number(raw) || 0 })}
              />
              <span className="pss-unit ib-meta">mm</span>
            </FormRow>
            <Switch label="Crop and fold marks" checked={book.binding.cropMarks} onChange={(cropMarks) => applyBinding({ cropMarks })} />
            <Switch label="Print a folding guide" checked={book.binding.includeGuide} onChange={(includeGuide) => applyBinding({ includeGuide })} />
          </>
        ) : null}
      </Section>
    </Dialog>
  )
}
