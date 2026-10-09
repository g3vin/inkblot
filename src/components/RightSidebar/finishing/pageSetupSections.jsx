/**
 * The page-setup sections of the Typeset tab (PageSetupSections.swift,
 * TypographySection.swift): the format, the page and its margins, the header and
 * footer, the type, the title page, and how text flows across pages. Under the Book
 * scope they edit the setup every chapter prints in.
 */
import { useEffect, useRef, useState } from 'react'
import { FormRow, Segmented } from '../../../ui'
import { popUpNativeMenu } from '../../../ui/useNativeMenu'
import Icon from '../../../ui/Icon.jsx'
import FinishingSection from './FinishingSection'
import FontSelect from './FontSelect'
import { Caution, CommitNumber, CommitText, LengthInput, LengthRow, Note, NumberRow, PickerRow, ToggleRow } from './controls'
import { SCENE_BREAKS, choosePath, cssFamily, primaryFamily, runningPreview } from './finishingText'
import { grouped } from './usePageLayout'
import { SECTION } from './sectionIds'
import { describeLength } from './units'

/* ---------------- format ---------------- */

export function FormatSection({ layout }) {
  const { state, setup, catalog, editsBook } = layout
  const formats = catalog?.formats ?? []
  const format = (id) => formats.find((f) => f.id === id)
  const current = editsBook ? format(setup.formatId) : format(state.formatId)
  const modified = !editsBook || state.setupSource === 'book' ? state.formatModified : false
  return (
    <FinishingSection id={SECTION.format} title="Format">
      {editsBook ? <p className="fin-banner"><Icon name="books" /> Editing the setup every chapter of the book prints in.</p> : null}
      <PickerRow
        label="Format"
        value={current?.id ?? 'custom'}
        onChange={(id) => { if (id !== 'custom') layout.applyFormat(id) }}
        options={[
          ...grouped(formats, (f) => f.group).map(([group, items]) => ({ label: group, options: items.map((f) => ({ value: f.id, label: f.label })) })),
          ...(current ? [] : [{ value: 'custom', label: 'Custom' }]),
        ]}
      />
      {current ? (modified ? (
        <FormRow label="Changed from the format"><button type="button" className="reference-link" onClick={() => layout.applyFormat(current.id)}>Reset</button></FormRow>
      ) : <Note>{current.summary}</Note>) : null}
      {!editsBook && state.bookSetupActive ? (
        <>
          <Note>This book prints every chapter in a setup of its own. This one shows on screen and when the document is printed alone.</Note>
          <button type="button" className="fin-button" onClick={() => layout.setScope('folder')}>Edit the book’s setup</button>
        </>
      ) : null}
    </FinishingSection>
  )
}

/* ---------------- page and margins ---------------- */

export function PageSection({ layout }) {
  const { state, setup, catalog, unit } = layout
  const presets = catalog?.presets ?? []
  const landscape = setup.orientation === 'landscape'
  const margins = setup.margins
  const setMargin = (key, mm) => layout.applySetup({ margins: { ...margins, [key]: mm } })
  const setSize = (key, mm) => {
    const next = { ...setup, [key]: mm }
    const match = presets.find((p) => Math.abs(p.widthMm - next.widthMm) < 0.5 && Math.abs(p.heightMm - next.heightMm) < 0.5)
    layout.applySetup({ [key]: mm, presetId: match?.id ?? 'custom' })
  }
  const suggested = state.suggestedInsideMarginMm
  return (
    <FinishingSection id={SECTION.pageSize} title="Page" note="The gutter is added to the inside margin, where the binding takes up paper.">
      <PickerRow
        label="Size"
        value={setup.presetId}
        onChange={(id) => { const p = presets.find((x) => x.id === id); if (p) layout.applySetup({ presetId: p.id, widthMm: p.widthMm, heightMm: p.heightMm }) }}
        options={[...grouped(presets, (p) => p.group).map(([group, items]) => ({ label: group, options: items.map((p) => ({ value: p.id, label: p.label })) })), { value: 'custom', label: 'Custom' }]}
      />
      <LengthRow label="Width" mm={setup.widthMm} unit={unit} onCommit={(mm) => setSize('widthMm', mm)} />
      <LengthRow label="Height" mm={setup.heightMm} unit={unit} onCommit={(mm) => setSize('heightMm', mm)} />
      <FormRow label="Orientation">
        <Segmented value={landscape ? 'landscape' : 'portrait'} onChange={(v) => layout.applySetup({ orientation: v })} label="Orientation" options={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
      </FormRow>
      <div className="fin-margins">
        <span className="fin-label">Margins</span>
        <div className="fin-margin-grid">
          <span />
          <MarginField label="Top" mm={margins.topMm} unit={unit} onCommit={(mm) => setMargin('topMm', mm)} />
          <span />
          <MarginField label={setup.mirrorMargins ? 'Inside' : 'Left'} mm={margins.insideMm} unit={unit} onCommit={(mm) => setMargin('insideMm', mm)} />
          <MarginDiagram setup={setup} />
          <MarginField label={setup.mirrorMargins ? 'Outside' : 'Right'} mm={margins.outsideMm} unit={unit} onCommit={(mm) => setMargin('outsideMm', mm)} />
          <span />
          <MarginField label="Bottom" mm={margins.bottomMm} unit={unit} onCommit={(mm) => setMargin('bottomMm', mm)} />
          <span />
        </div>
      </div>
      <ToggleRow label="Mirror for facing pages" title="Swap the left and right margins on left-hand pages, as a printed book does" checked={setup.mirrorMargins} onChange={(on) => layout.applySetup({ mirrorMargins: on })} />
      <LengthRow label="Gutter" mm={margins.gutterMm} unit={unit} onCommit={(mm) => setMargin('gutterMm', mm)} />
      {state.pageCount > 0 && margins.insideMm + margins.gutterMm + 0.05 < suggested ? (
        <>
          <Caution>For {state.pageCount} pages, binders suggest at least {describeLength(suggested, unit)} on the inside.</Caution>
          <button type="button" className="fin-button" onClick={() => setMargin('gutterMm', Math.max(0, suggested - margins.insideMm))}>Widen the gutter to fit</button>
        </>
      ) : null}
      <FormRow label="Columns">
        <Segmented value={String(setup.columns)} onChange={(v) => layout.applySetup({ columns: Number(v) })} label="Columns" options={['1', '2', '3'].map((v) => ({ value: v, label: v }))} />
      </FormRow>
      {setup.columns > 1 ? (
        <>
          <LengthRow label="Space between" mm={setup.columnGapMm} unit={unit} onCommit={(mm) => layout.applySetup({ columnGapMm: mm })} />
          <Note>You write in one running column; the columns sit side by side when printed or exported as PDF.</Note>
        </>
      ) : null}
    </FinishingSection>
  )
}

function MarginField({ label, mm, unit, onCommit }) {
  return (
    <span className="fin-margin-field">
      <LengthInput mm={mm} unit={unit} onCommit={onCommit} label={`${label} margin`} />
      <small>{label}</small>
    </span>
  )
}

/** The page to scale, its text block, and the gutter shaded where the binding goes. */
function MarginDiagram({ setup }) {
  const w = setup.orientation === 'landscape' ? setup.heightMm : setup.widthMm
  const h = setup.orientation === 'landscape' ? setup.widthMm : setup.heightMm
  if (!(w > 0 && h > 0)) return <span />
  const box = { w: 64, h: 76 }
  const scale = Math.min(box.w / w, box.h / h)
  const page = { x: (box.w - w * scale) / 2, y: (box.h - h * scale) / 2, w: w * scale, h: h * scale }
  const m = setup.margins
  const text = {
    x: page.x + (m.insideMm + m.gutterMm) * scale,
    y: page.y + m.topMm * scale,
    w: Math.max(0, page.w - (m.insideMm + m.gutterMm + m.outsideMm) * scale),
    h: Math.max(0, page.h - (m.topMm + m.bottomMm) * scale),
  }
  const lines = []
  for (let y = text.y + 2; y < text.y + text.h - 1; y += 3.5) lines.push(y)
  return (
    <svg className="fin-margin-diagram" viewBox={`0 0 ${box.w} ${box.h}`} width={box.w} height={box.h} role="img" aria-label="Page margins">
      <rect x={page.x} y={page.y} width={page.w} height={page.h} fill="var(--print-paper)" stroke="currentColor" strokeOpacity="0.5" strokeWidth="0.5" />
      {m.gutterMm > 0 ? <rect x={page.x + m.insideMm * scale} y={page.y} width={m.gutterMm * scale} height={page.h} fill="var(--accent-color)" fillOpacity="0.25" /> : null}
      {lines.map((y) => <rect key={y} x={text.x} y={y} width={text.w} height={1} fill="var(--print-ink-muted)" />)}
    </svg>
  )
}

/* ---------------- header and footer ---------------- */

/**
 * A running head or foot: left, centre and right, a menu to put a token into whichever
 * was typed in last, and a preview of the line as it will print. It keeps its own
 * drafts, so a token put into a field still being typed in joins what was typed.
 */
function RunningTextEditor({ title, value, onCommit, tokens, resolve }) {
  const empty = { left: '', center: '', right: '' }
  const [draft, setDraft] = useState({ ...empty, ...(value || {}) })
  const [slot, setSlot] = useState('center')
  const focused = useRef(false)
  const latest = useRef({ draft, value, onCommit })
  useEffect(() => { latest.current = { draft, value, onCommit } })
  useEffect(() => { if (!focused.current) setDraft({ ...empty, ...(value || {}) }) }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (next = latest.current.draft) => {
    const { value: current, onCommit: apply } = latest.current
    if (JSON.stringify(next) !== JSON.stringify({ ...empty, ...(current || {}) })) apply(next)
  }
  useEffect(() => () => commit(), []) // eslint-disable-line react-hooks/exhaustive-deps

  const field = (key, placeholder) => (
    <input
      className="fin-input"
      value={draft[key]}
      placeholder={placeholder}
      aria-label={`${title}, ${placeholder}`}
      onFocus={() => { focused.current = true; setSlot(key) }}
      onBlur={(event) => {
        // Moving between the three fields is still typing the one line.
        if (event.currentTarget.parentElement.contains(event.relatedTarget)) return
        focused.current = false
        commit()
      }}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
      onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
    />
  )
  const insert = (event) => popUpNativeMenu(event, tokens.map((token) => ({
    text: token.label,
    action: () => {
      const next = { ...latest.current.draft, [slot]: latest.current.draft[slot] + token.token }
      setDraft(next)
      commit(next)
    },
  })))
  const isEmpty = !draft.left && !draft.center && !draft.right
  return (
    <div className="fin-running">
      <div className="fin-running-head">
        <span className="fin-label">{title}</span>
        <button type="button" className="reference-icon-button" aria-label="Insert a token" title="Insert a page number, the title, the chapter or the author" onClick={insert}>
          <Icon name="add" />
        </button>
      </div>
      <div className="fin-running-fields">
        {field('left', 'Left')}
        {field('center', 'Center')}
        {field('right', 'Right')}
      </div>
      {isEmpty ? null : (
        <div className="fin-running-preview" aria-label="Preview">
          <span>{resolve(draft.left)}</span><span>{resolve(draft.center)}</span><span>{resolve(draft.right)}</span>
        </div>
      )}
    </div>
  )
}

export function HeaderFooterSection({ layout }) {
  const { state, setup, catalog, unit } = layout
  const tokens = catalog?.tokens ?? []
  const versoDiffers = Boolean(setup.versoHeader || setup.versoFooter)
  const recto = runningPreview(state, setup)
  const verso = runningPreview(state, setup, true)
  return (
    <FinishingSection id={SECTION.headerFooter} title="Header & footer" note="Insert page numbers, the title, the chapter, the author, the word count or the date with the + menu. The chapter is the most recent Heading 1. Header and footer stay within their margins.">
      <RunningTextEditor title={versoDiffers ? 'Header, right-hand pages' : 'Header'} value={setup.header} tokens={tokens} resolve={recto} onCommit={(header) => layout.applySetup({ header })} />
      <RunningTextEditor title={versoDiffers ? 'Footer, right-hand pages' : 'Footer'} value={setup.footer} tokens={tokens} resolve={recto} onCommit={(footer) => layout.applySetup({ footer })} />
      <ToggleRow
        label="Different on left-hand pages"
        checked={versoDiffers}
        onChange={(on) => layout.applySetup(on ? { versoHeader: setup.header, versoFooter: setup.footer } : { versoHeader: undefined, versoFooter: undefined })}
      />
      {versoDiffers ? (
        <>
          <RunningTextEditor title="Header, left-hand pages" value={setup.versoHeader ?? setup.header} tokens={tokens} resolve={verso} onCommit={(versoHeader) => layout.applySetup({ versoHeader })} />
          <RunningTextEditor title="Footer, left-hand pages" value={setup.versoFooter ?? setup.footer} tokens={tokens} resolve={verso} onCommit={(versoFooter) => layout.applySetup({ versoFooter })} />
        </>
      ) : null}
      <ToggleRow label="None on a chapter’s first page" checked={setup.differentFirstPage} onChange={(on) => layout.applySetup({ differentFirstPage: on })} />
      <LengthRow label="Header from top edge" mm={setup.headerDistanceMm} unit={unit} onCommit={(mm) => layout.applySetup({ headerDistanceMm: Math.min(mm, setup.margins.topMm) })} />
      <LengthRow label="Footer from bottom edge" mm={setup.footerDistanceMm} unit={unit} onCommit={(mm) => layout.applySetup({ footerDistanceMm: Math.min(mm, setup.margins.bottomMm) })} />
      <PickerRow label="Page numbers" value={setup.pageNumberFormat} onChange={(pageNumberFormat) => layout.applySetup({ pageNumberFormat })} options={[{ value: 'arabic', label: '1, 2, 3' }, { value: 'lowerRoman', label: 'i, ii, iii' }, { value: 'upperRoman', label: 'I, II, III' }]} />
      <NumberRow label="First page number" value={setup.pageNumberStart} min={0} max={99999} onCommit={(pageNumberStart) => layout.applySetup({ pageNumberStart })} />
    </FinishingSection>
  )
}

/* ---------------- text flow ---------------- */

export function TextFlowSection({ layout, toolbarTarget, send }) {
  const { setup } = layout
  const insertBreak = (event) => popUpNativeMenu(event, [
    { text: 'Page break', action: () => send('insertBreak', { target: toolbarTarget, kind: 'page' }) },
    { text: 'Column break', action: () => send('insertBreak', { target: toolbarTarget, kind: 'column' }) },
    { text: 'Break to next right-hand page', action: () => send('insertBreak', { target: toolbarTarget, kind: 'recto' }) },
  ])
  return (
    <FinishingSection id={SECTION.textFlow} title="Text flow">
      <PickerRow
        label="Widow & orphan control"
        value={String(setup.widowOrphanLines)}
        onChange={(v) => layout.applySetup({ widowOrphanLines: Number(v) })}
        options={[{ value: '1', label: 'Off' }, ...[2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} Lines` }))]}
      />
      <ToggleRow label="Chapters start on a right-hand page" checked={setup.chapterStartsOnRecto} onChange={(on) => layout.applySetup({ chapterStartsOnRecto: on })} />
      <FormRow label="Insert">
        <button type="button" className="fin-button" disabled={!toolbarTarget} onClick={insertBreak}>Break <Icon name="chevron-down" /></button>
      </FormRow>
    </FinishingSection>
  )
}

/* ---------------- body text ---------------- */

const COMPOSITION = { balance: true, hangingPunctuation: true, hyphenLimitLines: 2, hyphenMinWord: 6, baselineGrid: false }
const FEATURES = { ligatures: true, discretionaryLigatures: false, oldStyleFigures: false, kerning: true, swashes: false }

export function TypographySection({ layout }) {
  const { setup, catalog, unit, state } = layout
  const t = setup.typography
  const projectFonts = state.projectFonts ?? []
  const edit = (patch) => layout.applySetup({ typography: { ...t, ...patch } })
  const editComposition = (patch) => edit({ composition: { ...COMPOSITION, ...(t.composition || {}), ...patch } })
  const editFeatures = (patch) => edit({ features: { ...FEATURES, ...(t.features || {}), ...patch } })
  const comp = { ...COMPOSITION, ...(t?.composition || {}) }
  const feat = { ...FEATURES, ...(t?.features || {}) }
  const [fine, setFine] = useState(false)
  const [open, setOpen] = useState(false)
  const addFont = async () => {
    const path = await choosePath({ title: 'Add a font to the project', extensions: ['ttf', 'otf', 'woff', 'woff2', 'ttc'], name: 'Fonts' })
    if (path) layout.addProjectFont(path)
  }
  const current = projectFonts.find((font) => font.family === primaryFamily(t?.fontFamily))
  return (
    <FinishingSection
      id={SECTION.typography}
      title="Body text"
      note={t ? 'A horizontal rule prints as the scene break. How chapters open — the drop cap, how far down the page — is under Chapter Openings.' : 'Pages print in the editor’s font. Set type for print to choose a font, spacing and scene breaks for the page alone.'}
    >
      <ToggleRow
        label="Set type for print"
        checked={Boolean(t)}
        disabled={!catalog?.defaultTypography && !t}
        onChange={(on) => layout.applySetup({ typography: on ? catalog.defaultTypography : undefined })}
      />
      {t ? (
        <>
          <FormRow label="Font">
            <FontSelect value={t.fontFamily} projectFamilies={projectFonts.map((f) => f.family)} onChange={(name) => edit({ fontFamily: cssFamily(name) })} />
            <button type="button" className="reference-icon-button" aria-label="Add a font file" title="Add a font file to the project, so the book sets and embeds it on any computer" onClick={addFont}><Icon name="add" /></button>
          </FormRow>
          {current && !current.embeddable ? <Caution>{current.family}’s licence does not allow embedding. A printer’s PDF and a store’s EPUB must embed their fonts.</Caution> : null}
          <FormRow label="Size"><span className="fin-length"><CommitNumber value={t.fontSizePt} digits={1} min={5} max={72} label="Size" onCommit={(fontSizePt) => edit({ fontSizePt })} /><span className="fin-unit">pt</span></span></FormRow>
          <PickerRow
            label="Line spacing"
            value={t.lineSpacing}
            onChange={(lineSpacing) => edit({ lineSpacing })}
            options={[{ value: 'single', label: 'Single' }, { value: 'oneAndAHalf', label: '1.5 lines' }, { value: 'double', label: 'Double' }, { value: 'multiple', label: 'Multiple' }, { value: 'exact', label: 'Exactly' }]}
          />
          {t.lineSpacing === 'multiple' || t.lineSpacing === 'exact' ? (
            <FormRow label={t.lineSpacing === 'exact' ? 'Line height' : 'Multiple'}>
              <span className="fin-length"><CommitNumber value={t.lineValue} digits={2} min={0} label="Line value" onCommit={(lineValue) => edit({ lineValue })} /><span className="fin-unit">{t.lineSpacing === 'exact' ? 'pt' : '×'}</span></span>
            </FormRow>
          ) : null}
          <FormRow label="Alignment">
            <Segmented value={t.alignment} onChange={(alignment) => edit({ alignment })} label="Alignment" options={[{ value: 'left', label: 'Left' }, { value: 'justify', label: 'Justified' }]} />
          </FormRow>
          <ToggleRow label="Hyphenate" checked={t.hyphenate} onChange={(hyphenate) => edit({ hyphenate })} />
          <button type="button" className="fin-disclosure" aria-expanded={fine} onClick={() => setFine(!fine)}><Icon name="chevron-down" /> Fine typography</button>
          {fine ? (
            <div className="fin-group">
              <ToggleRow label="Balance each paragraph" title="Set a paragraph’s lines as a whole: even spacing, fewer hyphens, no word alone on the last line" checked={comp.balance} onChange={(balance) => editComposition({ balance })} />
              <ToggleRow label="Hang punctuation" title="Quotation marks and stops sit just outside the text block, so its edges look straight" checked={comp.hangingPunctuation} onChange={(hangingPunctuation) => editComposition({ hangingPunctuation })} />
              {t.hyphenate ? (
                <>
                  <NumberRow label="Hyphens in a Row (0: any)" value={comp.hyphenLimitLines} min={0} max={10} onCommit={(hyphenLimitLines) => editComposition({ hyphenLimitLines })} />
                  <NumberRow label="Hyphenate Words Of (letters)" value={comp.hyphenMinWord} min={3} max={20} onCommit={(hyphenMinWord) => editComposition({ hyphenMinWord })} />
                </>
              ) : null}
              <ToggleRow label="Align to baseline grid" title="Headings, quotations, breaks and pictures take whole lines, so lines stand level across a spread" checked={comp.baselineGrid} onChange={(baselineGrid) => editComposition({ baselineGrid })} />
            </div>
          ) : null}
          <button type="button" className="fin-disclosure" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="chevron-down" /> OpenType</button>
          {open ? (
            <div className="fin-group">
              <ToggleRow label="Ligatures" checked={feat.ligatures} onChange={(ligatures) => editFeatures({ ligatures })} />
              <ToggleRow label="Discretionary ligatures" checked={feat.discretionaryLigatures} onChange={(discretionaryLigatures) => editFeatures({ discretionaryLigatures })} />
              <ToggleRow label="Old-Style figures" checked={feat.oldStyleFigures} onChange={(oldStyleFigures) => editFeatures({ oldStyleFigures })} />
              <ToggleRow label="Kerning" checked={feat.kerning} onChange={(kerning) => editFeatures({ kerning })} />
              <ToggleRow label="Swashes" checked={feat.swashes} onChange={(swashes) => editFeatures({ swashes })} />
            </div>
          ) : null}
          <LengthRow label="First-Line indent" mm={t.firstLineIndentMm} unit={unit} onCommit={(firstLineIndentMm) => edit({ firstLineIndentMm })} />
          <FormRow label="Space after paragraph"><span className="fin-length"><CommitNumber value={t.paragraphSpacingPt} digits={1} min={0} label="Space after paragraph" onCommit={(paragraphSpacingPt) => edit({ paragraphSpacingPt })} /><span className="fin-unit">pt</span></span></FormRow>
          <ToggleRow label="No indent after a heading or break" checked={t.noIndentAfterBreak} onChange={(noIndentAfterBreak) => edit({ noIndentAfterBreak })} />
          <FormRow label="Scene break">
            <CommitText className="fin-centered" value={t.sceneBreak} placeholder="* * *" label="Scene break" onCommit={(sceneBreak) => edit({ sceneBreak })} />
            <button type="button" className="reference-icon-button" aria-label="Common scene breaks" onClick={(event) => popUpNativeMenu(event, SCENE_BREAKS.map((glyph) => ({ text: glyph, action: () => edit({ sceneBreak: glyph }) })))}><Icon name="chevron-down" /></button>
          </FormRow>
        </>
      ) : null}
    </FinishingSection>
  )
}

/* ---------------- the title page ---------------- */

export function TitlePageSection({ layout, onEditAuthor }) {
  const page = layout.setup.titlePage
  const set = (patch) => layout.applySetup({ titlePage: { ...page, ...patch } })
  return (
    <FinishingSection id={SECTION.titlePage} title="Title page" note="The title page prints and exports ahead of the text, unnumbered. Contact details come from your author details.">
      <ToggleRow label="Add a title page" checked={Boolean(page)} onChange={(on) => layout.applySetup({ titlePage: on ? { style: 'manuscript', showContact: true, showWordCount: true } : undefined })} />
      {page ? (
        <>
          <PickerRow
            label="Style"
            value={page.style}
            onChange={(style) => layout.applySetup({ titlePage: { style, showContact: style !== 'book', showWordCount: style === 'manuscript' } })}
            options={[{ value: 'manuscript', label: 'Manuscript' }, { value: 'book', label: 'Book' }, { value: 'screenplay', label: 'Screenplay' }]}
          />
          <ToggleRow label="Contact details" checked={page.showContact} onChange={(showContact) => set({ showContact })} />
          {page.style === 'manuscript' ? <ToggleRow label="Word count" checked={page.showWordCount} onChange={(showWordCount) => set({ showWordCount })} /> : null}
          <FormRow label="Author"><button type="button" className="fin-button" onClick={onEditAuthor}>Edit author details…</button></FormRow>
        </>
      ) : null}
    </FinishingSection>
  )
}
