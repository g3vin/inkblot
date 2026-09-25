/**
 * PageSetupSheet.jsx — Page Setup, drawn by the page, for the shell that does not
 * draw its own.
 *
 * The Swift shell shows page setup natively, in the inspector's Page tab (it owns
 * `pageSetup`; see host.ts). The Tauri app has no inspector, so it gets this sheet,
 * which edits the same two things through the same functions: the document's page
 * setup on its doc node, and its book's settings in preferences.
 *
 * Choices apply at once, so the pages behind the sheet reflow as they change; each
 * is one undo step in the document.
 */
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import { getPreference, setPreference } from '../lib/preferences'
import { applyFormat, FORMAT_PRESETS, formatOf } from './formats'
import { SIGNATURE_GUIDANCE } from './imposition'
import { normalizePageSetup, resolvePageSetup, suggestedInsideMarginMm } from './pageSetup'
import { fromMm, PAGE_SIZE_GROUP_LABELS, PAGE_SIZE_PRESETS, matchPageSizePreset, toMm } from './pageSizes'
import { bookFolderForScope, getBookSettings, getPrintScope, setBookSettings, setPrintScope, usePrintLayoutStore } from './printLayoutStore'
import { BOOK_TYPOGRAPHY } from './typography'
import { useDocPageSetup } from './useDocPageSetup'
import { usePrintJobStatus } from './usePrintJobStatus'
import './PageSetupSheet.css'

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

function Length({ label, mm, unit, onChange }) {
  return (
    <label className="pss-field">
      <span>{label}</span>
      <input
        type="number"
        step="any"
        min="0"
        key={`${unit}:${mm}`}
        defaultValue={round(fromMm(mm, unit), unit)}
        onBlur={(event) => {
          const value = Number.parseFloat(event.target.value)
          if (Number.isFinite(value)) onChange(toMm(value, unit))
        }}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
      />
      <em>{unit}</em>
    </label>
  )
}

function Running({ label, value, onChange }) {
  const commit = (key) => (event) => {
    if (event.target.value !== value[key]) onChange({ ...value, [key]: event.target.value })
  }
  return (
    <div className="pss-running">
      <span>{label}</span>
      {['left', 'center', 'right'].map((key) => (
        <input
          key={`${key}:${value[key]}`}
          defaultValue={value[key]}
          placeholder={key[0].toUpperCase() + key.slice(1)}
          onBlur={commit(key)}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
        />
      ))}
    </div>
  )
}

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

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const applyBook = (patch) => setBookSettings(projectName, folder, { ...book, ...patch })
  const replace = (next) => {
    if (target === 'book') applyBook({ pageSetup: normalizePageSetup(next) })
    else editor?.chain().setPageSetup(next).run()
  }
  const apply = (patch) => replace({ ...setup, ...patch })
  const applyMargins = (patch) => apply({ margins: { ...setup.margins, ...patch } })
  const applyBinding = (patch) => applyBook({ binding: { ...book.binding, ...patch } })

  const groups = useMemo(() => {
    const out = new Map()
    for (const preset of PAGE_SIZE_PRESETS) {
      if (!out.has(preset.group)) out.set(preset.group, [])
      out.get(preset.group).push(preset)
    }
    return [...out.entries()]
  }, [])

  const setSize = (widthMm, heightMm) => {
    const match = matchPageSizePreset(widthMm, heightMm)
    apply({ widthMm, heightMm, presetId: match?.id || 'custom' })
  }
  const inside = setup.margins.insideMm + setup.margins.gutterMm
  const suggested = suggestedInsideMarginMm(Math.max(1, pageCount))
  const versoDiffers = Boolean(setup.versoHeader || setup.versoFooter)

  return createPortal(
    <div className="pss-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.() }}>
      <div className="pss-sheet" role="dialog" aria-label="Page Setup">
        <header>
          <h2>Page Setup</h2>
          <select value={unit} onChange={(event) => setUnit(event.target.value)} aria-label="Units">
            <option value="in">Inches</option>
            <option value="mm">Millimeters</option>
            <option value="cm">Centimeters</option>
            <option value="pt">Points</option>
          </select>
          <button type="button" onClick={onClose}>Done</button>
        </header>

        <div className="pss-actions">
          <div className="pss-segmented" role="radiogroup" aria-label="Print">
            {[['document', 'This Document'], ['folder', 'Book'], ['project', 'Whole Project']].map(([value, label]) => (
              <button key={value} type="button" className={scope === value ? 'is-on' : ''} onClick={() => setPrintScope(projectName, value)}>
                {label}
              </button>
            ))}
          </div>
          <button type="button" className="pss-primary" onClick={() => window.dispatchEvent(new CustomEvent('inkblot:print', { detail: { scope } }))}>Print…</button>
          <select
            value=""
            aria-label="Export"
            onChange={(event) => {
              const [format, bound] = event.target.value.split(':')
              if (format) window.dispatchEvent(new CustomEvent('inkblot:export', { detail: { format, scope, bound: bound === 'bound' } }))
            }}
          >
            <option value="" hidden>Export…</option>
            <option value="pdf">PDF</option>
            <option value="epub">EPUB</option>
            <option value="markdown">Markdown</option>
            <option value="html">HTML</option>
            {book.binding.binding !== 'none' && scope !== 'document' ? <option value="pdf:bound">PDF for Binding</option> : null}
          </select>
          {job ? <span className={`pss-job is-${job.phase}`} role="status">{job.text}</span> : null}
        </div>

        <div className="pss-body">
          <section>
            <h3>Format</h3>
            <div className="pss-segmented" role="radiogroup" aria-label="Edit">
              <button type="button" className={target === 'document' ? 'is-on' : ''} onClick={() => setTarget('document')}>This Document</button>
              <button type="button" className={target === 'book' ? 'is-on' : ''} onClick={() => setTarget('book')}>Whole Book</button>
            </div>
            {target === 'book' ? <p className="pss-note">Editing the setup every chapter of the book prints in.</p> : null}
            <label className="pss-field wide">
              <span>Format</span>
              <select
                value={formatId || 'custom'}
                onChange={(event) => {
                  const next = applyFormat(event.target.value)
                  if (next) replace(next)
                }}
              >
                {[...new Set(FORMAT_PRESETS.map((f) => f.group))].map((group) => (
                  <optgroup key={group} label={group}>
                    {FORMAT_PRESETS.filter((f) => f.group === group).map((f) => (
                      <option key={f.id} value={f.id}>{f.label}{f.id === formatId && modified ? ' (modified)' : ''}</option>
                    ))}
                  </optgroup>
                ))}
                {formatId ? null : <option value="custom">Custom</option>}
              </select>
            </label>
            {target === 'document' && book.pageSetup ? (
              <p className="pss-note">This book prints every chapter in its own setup, so what is set here shows on screen and when this document is printed alone.</p>
            ) : null}
          </section>

          <section>
            <h3>Page</h3>
            <label className="pss-field wide">
              <span>Size</span>
              <select
                value={setup.presetId}
                onChange={(event) => {
                  const preset = PAGE_SIZE_PRESETS.find((p) => p.id === event.target.value)
                  if (preset) apply({ presetId: preset.id, widthMm: preset.widthMm, heightMm: preset.heightMm })
                }}
              >
                {groups.map(([group, presets]) => (
                  <optgroup key={group} label={PAGE_SIZE_GROUP_LABELS[group]}>
                    {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </optgroup>
                ))}
                <option value="custom">Custom</option>
              </select>
            </label>
            <div className="pss-row">
              <Length label="Width" mm={setup.widthMm} unit={unit} onChange={(v) => setSize(v, setup.heightMm)} />
              <Length label="Height" mm={setup.heightMm} unit={unit} onChange={(v) => setSize(setup.widthMm, v)} />
            </div>
            <div className="pss-segmented" role="radiogroup" aria-label="Orientation">
              {['portrait', 'landscape'].map((o) => (
                <button key={o} type="button" className={setup.orientation === o ? 'is-on' : ''} onClick={() => apply({ orientation: o })}>
                  {o === 'portrait' ? 'Portrait' : 'Landscape'}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3>Margins</h3>
            <div className="pss-row">
              <Length label="Top" mm={setup.margins.topMm} unit={unit} onChange={(v) => applyMargins({ topMm: v })} />
              <Length label="Bottom" mm={setup.margins.bottomMm} unit={unit} onChange={(v) => applyMargins({ bottomMm: v })} />
            </div>
            <div className="pss-row">
              <Length label={setup.mirrorMargins ? 'Inside' : 'Left'} mm={setup.margins.insideMm} unit={unit} onChange={(v) => applyMargins({ insideMm: v })} />
              <Length label={setup.mirrorMargins ? 'Outside' : 'Right'} mm={setup.margins.outsideMm} unit={unit} onChange={(v) => applyMargins({ outsideMm: v })} />
            </div>
            <div className="pss-row">
              <Length label="Gutter" mm={setup.margins.gutterMm} unit={unit} onChange={(v) => applyMargins({ gutterMm: v })} />
              <label className="pss-check">
                <input type="checkbox" checked={setup.mirrorMargins} onChange={(event) => apply({ mirrorMargins: event.target.checked })} />
                Mirror margins
              </label>
            </div>
            {pageCount > 0 && inside + 0.05 < suggested ? (
              <p className="pss-warn">
                For {pageCount} pages, binders suggest at least {round(fromMm(suggested, unit), unit)} {unit} inside.{' '}
                <button type="button" className="pss-link" onClick={() => applyMargins({ gutterMm: Math.max(0, suggested - setup.margins.insideMm) })}>Use it</button>
              </p>
            ) : null}
          </section>

          <section>
            <h3>Columns</h3>
            <div className="pss-row">
              <label className="pss-field">
                <span>Columns</span>
                <select value={setup.columns} onChange={(event) => apply({ columns: Number(event.target.value) })}>
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                </select>
              </label>
              {setup.columns > 1 ? <Length label="Gap" mm={setup.columnGapMm} unit={unit} onChange={(v) => apply({ columnGapMm: v })} /> : null}
            </div>
            {setup.columns > 1 ? <p className="pss-note">Pages are edited as a single running column; Print, PDF and binding set the columns side by side.</p> : null}
          </section>

          <section>
            <h3>Typography</h3>
            <label className="pss-check">
              <input
                type="checkbox"
                checked={Boolean(setup.typography)}
                onChange={(event) => apply({ typography: event.target.checked ? { ...BOOK_TYPOGRAPHY } : undefined })}
              />
              Set type for print
            </label>
            {setup.typography ? (() => {
              const t = setup.typography
              const applyType = (patch) => apply({ typography: { ...t, ...patch } })
              return (
                <>
                  <label className="pss-field wide">
                    <span>Font</span>
                    <input key={`f:${t.fontFamily}`} defaultValue={t.fontFamily} onBlur={(event) => applyType({ fontFamily: event.target.value })} />
                  </label>
                  <div className="pss-row">
                    <label className="pss-field">
                      <span>Size</span>
                      <input type="number" min="5" max="72" step="0.5" key={`s:${t.fontSizePt}`} defaultValue={t.fontSizePt} onBlur={(event) => applyType({ fontSizePt: Number(event.target.value) || t.fontSizePt })} />
                      <em>pt</em>
                    </label>
                    <label className="pss-field">
                      <span>Spacing</span>
                      <select value={t.lineSpacing} onChange={(event) => applyType({ lineSpacing: event.target.value })}>
                        <option value="single">Single</option>
                        <option value="oneAndAHalf">1.5 lines</option>
                        <option value="double">Double</option>
                        <option value="multiple">Multiple</option>
                        <option value="exact">Exactly</option>
                      </select>
                    </label>
                  </div>
                  <div className="pss-row">
                    <Length label="Indent" mm={t.firstLineIndentMm} unit={unit} onChange={(v) => applyType({ firstLineIndentMm: v })} />
                    <label className="pss-field">
                      <span>Scene break</span>
                      <input key={`b:${t.sceneBreak}`} defaultValue={t.sceneBreak} onBlur={(event) => applyType({ sceneBreak: event.target.value })} />
                    </label>
                  </div>
                  <div className="pss-segmented" role="radiogroup" aria-label="Alignment">
                    {[['left', 'Ragged Right'], ['justify', 'Justified']].map(([value, label]) => (
                      <button key={value} type="button" className={t.alignment === value ? 'is-on' : ''} onClick={() => applyType({ alignment: value })}>{label}</button>
                    ))}
                  </div>
                  <p className="pss-note">Type for print shows in Print Layout and on paper; the editor keeps your writing font.</p>
                </>
              )
            })() : null}
            <label className="pss-check">
              <input
                type="checkbox"
                checked={Boolean(setup.titlePage)}
                onChange={(event) => apply({ titlePage: event.target.checked ? { style: 'book', showContact: false, showWordCount: false } : undefined })}
              />
              Add a title page when printing
            </label>
          </section>

          <section>
            <h3>Header &amp; Footer</h3>
            <Running label={versoDiffers ? 'Header, right' : 'Header'} value={setup.header} onChange={(header) => apply({ header })} />
            <Running label={versoDiffers ? 'Footer, right' : 'Footer'} value={setup.footer} onChange={(footer) => apply({ footer })} />
            <label className="pss-check">
              <input
                type="checkbox"
                checked={versoDiffers}
                onChange={(event) => apply(event.target.checked
                  ? { versoHeader: { ...setup.header }, versoFooter: { ...setup.footer } }
                  : { versoHeader: undefined, versoFooter: undefined })}
              />
              Different on left-hand pages
            </label>
            {versoDiffers ? (
              <>
                <Running label="Header, left" value={setup.versoHeader || setup.header} onChange={(versoHeader) => apply({ versoHeader })} />
                <Running label="Footer, left" value={setup.versoFooter || setup.footer} onChange={(versoFooter) => apply({ versoFooter })} />
              </>
            ) : null}
            <label className="pss-check">
              <input type="checkbox" checked={setup.differentFirstPage} onChange={(event) => apply({ differentFirstPage: event.target.checked })} />
              None on a chapter&apos;s first page
            </label>
            <div className="pss-row">
              <label className="pss-field">
                <span>Numbers</span>
                <select value={setup.pageNumberFormat} onChange={(event) => apply({ pageNumberFormat: event.target.value })}>
                  <option value="arabic">1, 2, 3</option>
                  <option value="lowerRoman">i, ii, iii</option>
                  <option value="upperRoman">I, II, III</option>
                </select>
              </label>
              <label className="pss-field">
                <span>Start at</span>
                <input type="number" min="0" key={setup.pageNumberStart} defaultValue={setup.pageNumberStart} onBlur={(event) => apply({ pageNumberStart: Number(event.target.value) || 0 })} />
              </label>
            </div>
            <p className="pss-note">Use {'{page}'}, {'{pages}'}, {'{title}'}, {'{chapter}'} and {'{author}'}. The chapter is the most recent Heading 1.</p>
          </section>

          <section>
            <h3>Text flow</h3>
            <label className="pss-field wide">
              <span>Widow &amp; orphan control</span>
              <select value={setup.widowOrphanLines} onChange={(event) => apply({ widowOrphanLines: Number(event.target.value) })}>
                <option value={1}>Off</option>
                <option value={2}>At least 2 lines</option>
                <option value={3}>At least 3 lines</option>
              </select>
            </label>
            <label className="pss-check">
              <input type="checkbox" checked={setup.chapterStartsOnRecto} onChange={(event) => apply({ chapterStartsOnRecto: event.target.checked })} />
              Chapters open on a right-hand page
            </label>
          </section>

          <section>
            <h3>Book</h3>
            <label className="pss-field wide"><span>Title</span><input key={`t:${book.title}`} defaultValue={book.title} onBlur={(event) => applyBook({ title: event.target.value })} /></label>
            <label className="pss-field wide"><span>Author</span><input key={`a:${book.author}`} defaultValue={book.author} onBlur={(event) => applyBook({ author: event.target.value })} /></label>
            <label className="pss-field wide"><span>Language</span><input key={`l:${book.language}`} defaultValue={book.language} onBlur={(event) => applyBook({ language: event.target.value })} /></label>
            <p className="pss-note">{scope === 'project' ? 'The book is the whole project' : 'A book is this document\u2019s folder'}, its documents in file-tree order.</p>
          </section>

          <section>
            <h3>Binding</h3>
            <label className="pss-check">
              <input
                type="checkbox"
                checked={book.binding.binding !== 'none'}
                onChange={(event) => applyBinding({ binding: event.target.checked ? 'signatures' : 'none' })}
              />
              Print for hand binding
            </label>
            {book.binding.binding !== 'none' ? (
              <label className="pss-field wide">
                <span>Binding</span>
                <select value={book.binding.binding} onChange={(event) => applyBinding({ binding: event.target.value })}>
                  <option value="signatures">Sewn signatures</option>
                  <option value="saddle">Saddle stitch (booklet)</option>
                  <option value="perfect">Perfect bound</option>
                </select>
              </label>
            ) : null}
            {book.binding.binding === 'signatures' ? (
              <>
                <label className="pss-field wide">
                  <span>Signature</span>
                  <select value={book.binding.sheetsPerSignature} onChange={(event) => applyBinding({ sheetsPerSignature: Number(event.target.value) })}>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n} sheet{n > 1 ? 's' : ''} · {n * 4} pages</option>)}
                  </select>
                </label>
                <ul className="pss-advice">
                  {SIGNATURE_GUIDANCE.map((g) => <li key={g.sheets} className={g.sheets === book.binding.sheetsPerSignature ? 'is-on' : ''}>{g.label}</li>)}
                </ul>
              </>
            ) : null}
            {book.binding.binding !== 'none' ? (
              <>
                <div className="pss-row">
                  <label className="pss-field">
                    <span>Sheet</span>
                    <select value={book.binding.sheetPresetId} onChange={(event) => applyBinding({ sheetPresetId: event.target.value })}>
                      {['letter', 'a4', 'legal', 'tabloid', 'a3'].map((id) => <option key={id} value={id}>{PAGE_SIZE_PRESETS.find((p) => p.id === id)?.label}</option>)}
                    </select>
                  </label>
                  <label className="pss-field">
                    <span>Pages</span>
                    <select value={book.binding.sheetFit} onChange={(event) => applyBinding({ sheetFit: event.target.value })}>
                      <option value="actualSize">Actual size</option>
                      <option value="fit">Scale to fit</option>
                    </select>
                  </label>
                </div>
                <div className="pss-row">
                  <label className="pss-field">
                    <span>Duplex</span>
                    <select value={book.binding.duplex} onChange={(event) => applyBinding({ duplex: event.target.value })}>
                      <option value="automatic">Printer does both sides</option>
                      <option value="manual">Manual: fronts, then backs</option>
                    </select>
                  </label>
                  <label className="pss-field">
                    <span>Paper</span>
                    <input type="number" step="0.01" min="0" key={`p:${book.binding.paperThicknessMm}`} defaultValue={book.binding.paperThicknessMm} onBlur={(event) => applyBinding({ paperThicknessMm: Number(event.target.value) || 0 })} />
                    <em>mm</em>
                  </label>
                </div>
                <label className="pss-check"><input type="checkbox" checked={book.binding.cropMarks} onChange={(event) => applyBinding({ cropMarks: event.target.checked })} /> Crop and fold marks</label>
                <label className="pss-check"><input type="checkbox" checked={book.binding.includeGuide} onChange={(event) => applyBinding({ includeGuide: event.target.checked })} /> Print a folding guide</label>
              </>
            ) : null}
          </section>
        </div>

      </div>
    </div>,
    document.body
  )
}
