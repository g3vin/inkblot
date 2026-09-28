/**
 * The book's sections of the Typeset tab (ThisPageSection, BookSections,
 * EditionsSection, StyleGallerySection, ProofSection, TextStylesSection,
 * ChapterOpeningsSection and PartsSection in Swift): what is selected in the Book
 * navigator, the book itself, its editions and style, the proof, the named text
 * styles, how chapters and parts open, the notes and the e-book.
 */
import { useState } from 'react'
import { shellBridge } from '../../../bridge'
import { FormRow, Segmented } from '../../../ui'
import { popUpNativeMenu } from '../../../ui/useNativeMenu'
import { DEFAULT_CHAPTER_DESIGN } from '../../../print/chapterDesign'
import { chapterLabel } from '../../../print/bookMatter'
import SFIcon from '../../SFIcon'
import FinishingSection from './FinishingSection'
import FontSelect from './FontSelect'
import { Caution, CommitNumber, CommitText, LengthRow, Note, PickerRow, ToggleRow } from './controls'
import { HEAD_GLYPHS, choosePath, cssFamily, fileUrl, primaryFamily } from './finishingText'
import { SECTION } from './sectionIds'

const send = (type, payload) => shellBridge.send(type, payload)

/* ---------------- this page ---------------- */

const CHAPTER_TYPES = [['chapter', 'Chapter'], ['prologue', 'Prologue'], ['epilogue', 'Epilogue'], ['interlude', 'Interlude'], ['unnumbered', 'Unnumbered']]
const ROW_NOTES = {
  chapter: 'A prologue, an epilogue or an interlude is headed by what it is and not numbered; the chapters after it count on.',
  matter: 'A page of the book’s own. Write it in the page itself — in Typeset or in Write.',
  generated: 'Laid out from the book: its title and author, its chapters.',
  part: 'A divider before the chapters of the part.',
}

export function ThisPageSection({ layout, row }) {
  const { state } = layout
  const page = (patch) => send('editBookItem', { id: row.id, page: { ...row.page, ...patch } })
  const meta = { subtitle: '', epigraph: '', epigraphSource: '', ...(state.chapterMeta || {}) }
  const setMeta = (patch) => layout.setChapterMeta({ ...meta, ...patch })
  return (
    <FinishingSection id={SECTION.thisPage} title={`This Page: ${row.title}`} note={ROW_NOTES[row.kind]}>
      {row.kind === 'chapter' ? (
        <>
          <PickerRow label="Chapter Type" value={row.chapterType ?? 'chapter'} onChange={(chapterType) => send('editBookItem', { id: row.id, chapterType })} options={CHAPTER_TYPES.map(([value, label]) => ({ value, label }))} />
          {row.label ? <FormRow label="Heading"><span className="fin-value">{row.label}</span></FormRow> : null}
          {row.path && row.path === state.docPath ? (
            <>
              <FormRow label="Subtitle" stacked><CommitText value={meta.subtitle} placeholder="In which…" label="Subtitle" onCommit={(subtitle) => setMeta({ subtitle })} /></FormRow>
              <FormRow label="Epigraph" stacked><CommitText multiline value={meta.epigraph} label="Epigraph" onCommit={(epigraph) => setMeta({ epigraph })} /></FormRow>
              {meta.epigraph ? <FormRow label="Epigraph By" stacked><CommitText value={meta.epigraphSource} placeholder="Who said it" label="Epigraph by" onCommit={(epigraphSource) => setMeta({ epigraphSource })} /></FormRow> : null}
              <FormRow label="Picture">
                {state.chapterImageFile ? <img className="fin-thumb" src={fileUrl(state.chapterImageFile)} alt="" /> : null}
                <button type="button" className="fin-button" onClick={async () => { const path = await choosePath({ title: 'Choose a picture for this chapter’s head' }); if (path) layout.setHeadImage('chapter', path) }}>{meta.image ? 'Change…' : 'Choose…'}</button>
                {meta.image ? <button type="button" className="fin-button is-destructive" onClick={() => layout.setHeadImage('chapter', null)}>Remove</button> : null}
              </FormRow>
            </>
          ) : null}
        </>
      ) : (
        <>
          <PickerRow label="Starts On" value={row.page.start} onChange={(start) => page({ start })} options={[{ value: 'any', label: 'The Next Page' }, { value: 'recto', label: 'A Right-Hand Page' }, { value: 'verso', label: 'A Left-Hand Page' }]} />
          <PickerRow label="Sits" value={row.page.position} onChange={(position) => page({ position })} options={[{ value: 'top', label: 'At the Top' }, { value: 'sunk', label: 'Down the Page' }, { value: 'centered', label: 'In the Middle' }, { value: 'bottom', label: 'At the Foot' }]} />
          <ToggleRow label="Running Heads" checked={row.page.runningHeads} onChange={(runningHeads) => page({ runningHeads })} />
          <ToggleRow label="Page Number" checked={row.page.folio} onChange={(folio) => page({ folio })} />
        </>
      )}
      {row.hidden ? (
        <>
          <Caution>Hidden: this is left out of the pages, print and export.</Caution>
          <button type="button" className="fin-button" onClick={() => send('setBookItemHidden', { id: row.id, hidden: false })}>Show in the Book</button>
        </>
      ) : null}
    </FinishingSection>
  )
}

/* ---------------- the book ---------------- */

const folderLabel = (folder) => {
  const name = String(folder || '').split('/').filter(Boolean).pop()
  return name ? `The “${name}” Folder` : 'The Project’s Top Folder'
}

const numbering = (book) => ({ style: 'none', prefix: 'Chapter', includeTitle: true, startAt: 1, showInTree: false, ...(book.chapterNumbering || {}) })

export function BookInfoSection({ layout }) {
  const { state, book } = layout
  const active = state.cover?.sets?.find((set) => set.id === state.cover?.active)
  return (
    <FinishingSection id={SECTION.bookInfo} title="Book" note="The title and author go on the running heads, the EPUB and the PDF. The language is what an e-reader reads it in; the cover is the EPUB’s.">
      <PickerRow label="Contains" value={state.scope === 'project' ? 'project' : 'folder'} onChange={layout.setScope} options={[{ value: 'folder', label: folderLabel(book.folder) }, { value: 'project', label: 'The Whole Project' }]} />
      <FormRow label="Title"><CommitText value={book.title} label="Title" onCommit={(title) => layout.applyBook({ title })} /></FormRow>
      <FormRow label="Author"><CommitText value={book.author} placeholder="Your name" label="Author" onCommit={(author) => layout.applyBook({ author })} /></FormRow>
      <FormRow label="Language"><CommitText value={book.language} placeholder="en-US" label="Language" onCommit={(language) => layout.applyBook({ language })} /></FormRow>
      <ToggleRow label="Read as One Document" title="In Write, the folder’s documents follow one another" checked={book.continuous} onChange={(continuous) => layout.applyBook({ continuous })} />
      <ToggleRow label="Number Documents in the File Tree" title="Each chapter’s number beside its name in the file tree" checked={numbering(book).showInTree} onChange={(showInTree) => layout.applyBook({ chapterNumbering: { ...numbering(book), showInTree } })} />
      <FormRow label="Cover">
        {active?.frontFile ? <img className="fin-cover-thumb" src={fileUrl(active.frontFile)} alt="The cover" /> : null}
        <button type="button" className="fin-button" onClick={layout.showCover}>Show the Cover</button>
      </FormRow>
    </FinishingSection>
  )
}

export function BookSetupSection({ layout }) {
  const { state, catalog } = layout
  const format = catalog?.formats?.find((f) => f.id === state.book?.pageSetup?.formatId)
  return (
    <FinishingSection id={SECTION.bookSetup} title="Page Setup">
      {state.bookSetupActive ? (
        <>
          <FormRow label="Every chapter prints in"><span className="fin-value">{format?.label ?? 'The book’s own setup'}</span></FormRow>
          <button type="button" className="fin-button" onClick={() => { if (state.scope === 'document') layout.setScope('folder') }}>Edit the Book’s Setup</button>
          <button type="button" className="fin-button is-destructive" onClick={layout.clearBookSetup}>Let Each Chapter Use Its Own</button>
        </>
      ) : (
        <>
          <Note>Each chapter shows its own setup on screen; printed as a book, every chapter takes the first chapter’s. Give the book a setup of its own to print them all alike.</Note>
          <button type="button" className="fin-button" disabled={!state.docPath} onClick={layout.useSetupForBook}>Use This Document’s Setup for the Book</button>
        </>
      )}
    </FinishingSection>
  )
}

const DIGITAL = { dropCaps: true, headImages: true, publisherFont: true, plainSceneBreaks: false, invertOrnamentsInDark: true }

export function DigitalSection({ layout }) {
  const { state, book } = layout
  const digital = { ...DIGITAL, ...(book.digital || {}) }
  const set = (patch) => layout.applyBook({ digital: { ...digital, ...patch } })
  return (
    <FinishingSection id={SECTION.digital} title="E-book" note="A reader chooses the page, the type size and often the font. These are what the book still decides — the EPUB and the preview both follow them.">
      <ToggleRow label="Show the E-book Preview" checked={state.typesetView === 'digital'} onChange={(on) => layout.setTypesetView(on ? 'digital' : 'print')} />
      <ToggleRow label="Drop Caps" title="A large first letter on each chapter, as in print" checked={digital.dropCaps} onChange={(dropCaps) => set({ dropCaps })} />
      <ToggleRow label="Chapter Pictures" title="The chapter’s picture and a picture ornament in each chapter’s head" checked={digital.headImages} onChange={(headImages) => set({ headImages })} />
      <ToggleRow label="The Book’s Font" title="Set in the book’s face where the reader lets the book choose" checked={digital.publisherFont} onChange={(publisherFont) => set({ publisherFont })} />
      <ToggleRow label="Plain Scene Breaks" title="Scene breaks as * * *, which every reader’s font has" checked={digital.plainSceneBreaks} onChange={(plainSceneBreaks) => set({ plainSceneBreaks })} />
      <ToggleRow label="Keep Ornaments Visible in Night Mode" title="Picture ornaments are inverted on a dark page" checked={digital.invertOrnamentsInDark} onChange={(invertOrnamentsInDark) => set({ invertOrnamentsInDark })} />
    </FinishingSection>
  )
}

export function NotesSection({ layout }) {
  const notes = { placement: 'page', numbering: 'perChapter', marks: 'numbers', heading: 'Notes', ...(layout.book.notes || {}) }
  const set = (patch) => layout.applyBook({ notes: { ...notes, ...patch } })
  return (
    <FinishingSection id={SECTION.notes} title="Footnotes & Endnotes" note="Put a note in with Insert ▸ Footnote in Write, and click its mark to write it. An e-book sets notes after each chapter, linked both ways; Word gets real footnotes.">
      <PickerRow label="Set Notes" value={notes.placement} onChange={(placement) => set({ placement })} options={[{ value: 'page', label: 'At the Foot of the Page' }, { value: 'chapter', label: 'After Each Chapter' }, { value: 'book', label: 'At the End of the Book' }]} />
      <PickerRow label="Numbered" value={notes.numbering} onChange={(numbering) => set({ numbering })} options={[{ value: 'perChapter', label: 'Afresh in Each Chapter' }, { value: 'continuous', label: 'On Through the Book' }]} />
      <FormRow label="Marks"><Segmented value={notes.marks} onChange={(marks) => set({ marks })} label="Marks" options={[{ value: 'numbers', label: '1 2 3' }, { value: 'symbols', label: '* † ‡' }]} /></FormRow>
      {notes.placement !== 'page' ? <FormRow label="Heading"><CommitText value={notes.heading} placeholder="Notes" label="Notes heading" onCommit={(heading) => set({ heading: heading.trim() || 'Notes' })} /></FormRow> : null}
    </FinishingSection>
  )
}

/* ---------------- editions ---------------- */

const EDITION_SYMBOLS = { paperback: 'book', hardcover: 'books.vertical', largePrint: 'textformat.size', ebook: 'ipad.and.iphone' }

export function EditionsSection({ layout }) {
  const { book, state } = layout
  const editions = book.editions ?? []
  const active = book.activeEdition
  const sets = state.cover?.sets ?? []
  const [renaming, setRenaming] = useState(null)
  const add = (event) => popUpNativeMenu(event, [
    { text: 'Paperback', action: () => layout.editEditions('add', { kind: 'paperback' }) },
    { text: 'Hardcover', action: () => layout.editEditions('add', { kind: 'hardcover' }) },
    { text: 'Large Print', action: () => layout.editEditions('add', { kind: 'largePrint' }) },
    { text: 'eBook', action: () => layout.editEditions('add', { kind: 'ebook' }) },
  ])
  return (
    <FinishingSection
      id={SECTION.editions}
      title="Editions"
      note={editions.length
        ? 'Changes to the page and the type are the edition’s being typeset. Export All Editions writes each print edition’s interior and cover PDFs, and each e-book’s EPUB.'
        : 'Add a hardcover, a large-print or an e-book edition: each keeps its own trim, margins, type and cover; the text and design stay one.'}
    >
      <PickerRow label="Typesetting" value={active ?? ''} onChange={(id) => layout.editEditions('activate', id ? { id } : {})} options={[{ value: '', label: 'The Book as Set Up' }, ...editions.map((e) => ({ value: e.id, label: e.name }))]} />
      {editions.map((edition) => (
        <div key={edition.id} className="fin-list-row">
          <SFIcon name={EDITION_SYMBOLS[edition.kind ?? 'paperback']} size={14} />
          {renaming === edition.id ? (
            <CommitText value={edition.name} label="Edition name" onCommit={(name) => { layout.editEditions('rename', { id: edition.id, name }); setRenaming(null) }} />
          ) : <span className={`fin-grow${edition.id === active ? ' is-strong' : ''}`}>{edition.name}</span>}
          {sets.length ? (
            <button
              type="button"
              className="fin-button is-small"
              title="The cover this edition prints and exports with"
              onClick={(event) => popUpNativeMenu(event, [
                { text: 'The Book’s Cover', action: () => layout.editEditions('setCover', { id: edition.id }) },
                { separator: true },
                ...sets.map((set) => ({ text: set.name, checked: set.id === edition.coverSetId, action: () => layout.editEditions('setCover', { id: edition.id, coverSetId: set.id }) })),
              ])}
            >
              {sets.find((set) => set.id === edition.coverSetId)?.name ?? 'Book’s Cover'}
            </button>
          ) : null}
          <button
            type="button"
            className="reference-icon-button"
            aria-label="Edition actions"
            onClick={(event) => popUpNativeMenu(event, [
              { text: 'Rename…', action: () => setRenaming(edition.id) },
              { text: 'Duplicate', action: () => layout.editEditions('duplicate', { id: edition.id }) },
              { separator: true },
              { text: 'Delete', action: () => layout.editEditions('delete', { id: edition.id }) },
            ])}
          >
            <SFIcon name="ellipsis" size={13} />
          </button>
        </div>
      ))}
      <button type="button" className="fin-button" onClick={add}><SFIcon name="plus" size={11} /> Add an Edition</button>
      {editions.length ? <button type="button" className="fin-button" onClick={layout.exportAllEditions}><SFIcon name="square.and.arrow.up" size={11} /> Export All Editions…</button> : null}
    </FinishingSection>
  )
}

/* ---------------- style ---------------- */

const cased = (text, headCase) => (headCase === 'upper' ? text.toUpperCase() : text)

function StyleCard({ style, current, onChoose }) {
  const d = style.design
  const face = primaryFamily(d.headingFont ?? style.typography.fontFamily)
  const align = d.alignment === 'left' ? 'flex-start' : d.alignment === 'right' ? 'flex-end' : 'center'
  const caseStyle = (headCase) => ({ fontVariant: headCase === 'smallCaps' ? 'small-caps' : undefined, fontStyle: headCase === 'italic' ? 'italic' : undefined })
  return (
    <button type="button" className={`fin-style-card${current ? ' is-current' : ''}`} title={style.description} aria-label={`${style.label} style`} aria-pressed={current} onClick={onChoose}>
      <span className="fin-style-page" style={{ alignItems: align, fontFamily: `"${face}", serif`, textAlign: d.alignment }}>
        {d.ornament === 'glyph' && d.ornamentPosition === 'above' ? <span style={{ fontSize: 11 }}>{d.ornamentGlyph}</span> : null}
        {d.showNumber ? <span style={{ fontSize: Math.min(22, Math.max(7, d.numberSizePt * 0.55)), ...caseStyle(d.numberCase) }}>{cased(d.numberSizePt > 20 ? '1' : 'Chapter One', d.numberCase)}</span> : null}
        {d.ornament === 'rule' && d.ornamentPosition === 'between' ? <span className="fin-style-rule" /> : null}
        {d.showTitle ? <span style={{ fontSize: Math.min(13, Math.max(8, d.titleSizePt * 0.5)), ...caseStyle(d.titleCase) }}>{cased('The Road', d.titleCase)}</span> : null}
        {d.ornament === 'glyph' && d.ornamentPosition === 'below' ? <span style={{ fontSize: 10 }}>{d.ornamentGlyph}</span> : null}
        <span className="fin-style-body" style={{ fontFamily: `"${primaryFamily(style.typography.fontFamily)}", serif` }}>It was late when</span>
      </span>
      <span className="fin-style-label">{style.label}</span>
    </button>
  )
}

export function StyleGallerySection({ layout }) {
  const styles = layout.catalog?.bookStyles ?? []
  const design = layout.book.chapterDesign
  const current = styles.find((style) => style.id === design?.styleId)
  const changed = current && design && JSON.stringify(design) !== JSON.stringify(current.design)
  return (
    <FinishingSection id={SECTION.style} title="Style" note="A style sets the book’s type, how its chapters open and its running heads. Everything below fine-tunes it.">
      <div className="fin-style-grid">
        {styles.map((style) => <StyleCard key={style.id} style={style} current={style.id === current?.id} onChoose={() => layout.applyStyle(style.id)} />)}
      </div>
      {changed ? <FormRow label={`Changed from ${current.label}`}><button type="button" className="reference-link" onClick={() => layout.applyStyle(current.id)}>Reset</button></FormRow> : null}
    </FinishingSection>
  )
}

/* ---------------- proof ---------------- */

const PROOF_NAMES = { loose: 'Loose Line', widow: 'Widow', orphan: 'Orphan', runt: 'Runt', stackedHyphens: 'Stacked Hyphens', shortPage: 'Short Last Page' }
const FIX_NAMES = { tighten: 'Tighten', loosen: 'Loosen', keepTogether: 'Keep Together', keepWithNext: 'Keep with Next', runLong: 'Run Page Long', runShort: 'Run Page Short' }

export function ProofSection({ layout }) {
  const { state } = layout
  const issues = state.proofIssues ?? []
  const paragraph = state.paragraph
  return (
    <FinishingSection id={SECTION.proof} title="Proof" note="Fixes change how lines fall, never the words, and print only. Each is in the typeset history.">
      <ToggleRow label="Mark Problems on the Pages" checked={state.proof} onChange={(proof) => layout.setDisplay({ proof })} />
      {state.proof ? (state.spread || state.typesetView === 'digital' ? (
        <Note>The proof reads the chapter’s own pages: show them one at a time, in Print.</Note>
      ) : issues.length === 0 ? (
        <p className="fin-ok"><SFIcon name="checkmark" size={12} /> Nothing to fix on this chapter’s pages.</p>
      ) : issues.map((issue) => (
        <div key={issue.id} className="fin-proof-issue" data-kind={issue.kind} role="button" tabIndex={0} title="Show it on the page" onClick={() => layout.showProofIssue(issue)} onKeyDown={(event) => { if (event.key === 'Enter') layout.showProofIssue(issue) }}>
          <strong>{PROOF_NAMES[issue.kind]} · page {issue.page}</strong>
          <span className="fin-proof-text">{issue.anchor.text}</span>
          <span className="fin-proof-fixes">
            {issue.fixes.map((fix) => <button key={fix} type="button" className="fin-button is-small" onClick={(event) => { event.stopPropagation(); layout.fixProofIssue(issue, fix) }}>{FIX_NAMES[fix]}</button>)}
          </span>
        </div>
      ))) : null}
      {paragraph ? (
        <>
          <FormRow label="Tracking">
            <button type="button" className="fin-button is-small" aria-label="Tighter" disabled={paragraph.tracking <= -10} onClick={() => layout.setParagraph({ nudgeTracking: -5 })}>−</button>
            <span className="fin-tabular">{paragraph.tracking === 0 ? '0' : `${paragraph.tracking > 0 ? '+' : ''}${paragraph.tracking}`}</span>
            <button type="button" className="fin-button is-small" aria-label="Looser" disabled={paragraph.tracking >= 10} onClick={() => layout.setParagraph({ nudgeTracking: 5 })}>+</button>
          </FormRow>
          <ToggleRow label="Keep Lines Together" checked={paragraph.keepTogether} onChange={(keepTogether) => layout.setParagraph({ keepTogether })} />
          <ToggleRow label="Keep with Next" checked={paragraph.keepWithNext} onChange={(keepWithNext) => layout.setParagraph({ keepWithNext })} />
          <PickerRow label="Its Page Runs" value={String(paragraph.pageAdjust)} onChange={(v) => layout.setParagraph({ pageAdjust: Number(v) })} options={[{ value: '-1', label: 'A Line Short' }, { value: '0', label: 'As Set' }, { value: '1', label: 'A Line Long' }]} />
        </>
      ) : null}
    </FinishingSection>
  )
}

/* ---------------- text styles ---------------- */

const BUILTIN_STYLES = new Set(['letter', 'textMessage', 'email', 'verse', 'blockQuote', 'journal', 'sign', 'centered', 'flushLeft'])
const clampLook = (look) => ({
  ...look,
  size: Math.min(3, Math.max(0.5, look.size)),
  indentEm: Math.min(12, Math.max(0, look.indentEm)),
  spaceLines: Math.min(4, Math.max(0, look.spaceLines)),
})

export function TextStylesSection({ layout }) {
  const { state, book } = layout
  const looks = state.textStyles ?? []
  const [open, setOpen] = useState(null)
  const save = (look) => {
    const stored = book.textStyles ?? []
    const next = stored.some((l) => l.id === look.id) ? stored.map((l) => (l.id === look.id ? clampLook(look) : l)) : [...stored, clampLook(look)]
    layout.applyBook({ textStyles: next })
  }
  const remove = (id) => {
    layout.applyBook({ textStyles: (book.textStyles ?? []).filter((l) => l.id !== id) })
    if (open === id) setOpen(null)
  }
  return (
    <FinishingSection id={SECTION.textStyles} title="Text Styles" note="Give a paragraph a style from Format ▸ Text Style. In Write it shows as a faint rule beside the text; here it is set as the book sets it.">
      {looks.map((look) => {
        const builtin = BUILTIN_STYLES.has(look.id)
        const set = (patch) => save({ ...look, ...patch })
        return (
          <div key={look.id} className="fin-group">
            <button type="button" className="fin-disclosure" aria-expanded={open === look.id} onClick={() => setOpen(open === look.id ? null : look.id)}>
              <SFIcon name="chevron.down" size={9} />
              <span style={{ fontStyle: look.italic ? 'italic' : undefined, fontVariant: look.smallCaps ? 'small-caps' : undefined }}>{look.name}</span>
              {state.paragraph?.styleName === look.id ? <span className="fin-muted" title="The caret is in one">· here</span> : null}
            </button>
            {open === look.id ? (
              <>
                {builtin ? null : <FormRow label="Name"><CommitText value={look.name} label="Style name" onCommit={(name) => set({ name })} /></FormRow>}
                <ToggleRow label="Its Own Font" checked={Boolean(look.fontFamily)} onChange={(on) => set({ fontFamily: on ? cssFamily('Helvetica Neue') : undefined })} />
                {look.fontFamily ? <FormRow label="Font"><FontSelect value={look.fontFamily} onChange={(name) => set({ fontFamily: cssFamily(name) })} /></FormRow> : null}
                <FormRow label="Size"><span className="fin-length"><CommitNumber value={Math.round(look.size * 100)} digits={0} min={50} max={300} label="Size" onCommit={(pct) => set({ size: pct / 100 })} /><span className="fin-unit">%</span></span></FormRow>
                <ToggleRow label="Italic" checked={look.italic} onChange={(italic) => set({ italic })} />
                <ToggleRow label="Small Capitals" checked={look.smallCaps} onChange={(smallCaps) => set({ smallCaps })} />
                <PickerRow label="Alignment" value={look.align} onChange={(align) => set({ align })} options={[{ value: 'inherit', label: 'As the Text' }, { value: 'left', label: 'Left' }, { value: 'center', label: 'Centered' }, { value: 'right', label: 'Right' }, { value: 'justify', label: 'Justified' }]} />
                <FormRow label="Indent Both Sides"><span className="fin-length"><CommitNumber value={look.indentEm} digits={1} min={0} max={12} label="Indent" onCommit={(indentEm) => set({ indentEm })} /><span className="fin-unit">em</span></span></FormRow>
                <ToggleRow label="No First-Line Indent" checked={look.flush} onChange={(flush) => set({ flush })} />
                <FormRow label="Space Around"><span className="fin-length"><CommitNumber value={look.spaceLines} digits={1} min={0} max={4} label="Space around" onCommit={(spaceLines) => set({ spaceLines })} /><span className="fin-unit">lines</span></span></FormRow>
                <ToggleRow label="Ruled Box" checked={look.boxed} onChange={(boxed) => set({ boxed })} />
                <button type="button" className={`fin-button${builtin ? '' : ' is-destructive'}`} onClick={() => remove(look.id)}>{builtin ? 'Reset to the App’s Look' : 'Delete Style'}</button>
              </>
            ) : null}
          </div>
        )
      })}
      <button
        type="button"
        className="fin-button"
        onClick={() => {
          const id = `custom-${Math.random().toString(16).slice(2, 10)}`
          save({ id, name: 'New Style', size: 1, italic: false, smallCaps: false, align: 'inherit', indentEm: 0, flush: false, spaceLines: 1, boxed: false })
          setOpen(id)
        }}
      >
        <SFIcon name="plus" size={11} /> Add a Style
      </button>
    </FinishingSection>
  )
}

/* ---------------- chapter openings and parts ---------------- */

const CASES = [{ value: 'asWritten', label: 'As Written' }, { value: 'upper', label: 'Capitals' }, { value: 'smallCaps', label: 'Small Capitals' }, { value: 'italic', label: 'Italic' }]
const ALIGNS = [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }]

const clampDesign = (d) => ({
  ...d,
  imageWidthPct: Math.min(100, Math.max(5, d.imageWidthPct)),
  numberSizePt: Math.min(96, Math.max(5, d.numberSizePt)),
  titleSizePt: Math.min(96, Math.max(5, d.titleSizePt)),
})

function PointsRow({ label, value, onCommit }) {
  return <FormRow label={label}><span className="fin-length"><CommitNumber value={value} digits={1} min={5} max={96} label={label} onCommit={onCommit} /><span className="fin-unit">pt</span></span></FormRow>
}

export function ChapterOpeningsSection({ layout }) {
  const { book, setup, unit, state } = layout
  const design = { ...DEFAULT_CHAPTER_DESIGN, ...(book.chapterDesign || {}) }
  const num = numbering(book)
  const edit = (patch) => layout.applyBook({ chapterDesign: clampDesign({ ...design, ...patch }) })
  const t = setup?.typography
  const editType = (patch) => layout.applySetup({ typography: { ...t, ...patch } })
  const example = chapterLabel(num.startAt === 0 ? 0 : 3, num) ?? ''
  return (
    <FinishingSection id={SECTION.headings} title="Chapter Openings" note="Every chapter opens this way, in the Typeset pages, in print and in every export. A chapter’s own subtitle, picture and epigraph are under This Page.">
      <PickerRow label="Chapters Start" value={design.chapterBreak} onChange={(chapterBreak) => edit({ chapterBreak })} options={[{ value: 'newPage', label: 'On a New Page' }, { value: 'newRightPage', label: 'On a Right-Hand Page' }, { value: 'continue', label: 'Straight On, Where There’s Room' }]} />
      <ToggleRow
        label="Number"
        checked={design.showNumber}
        onChange={(on) => {
          // A number needs a way of being written: words, until chosen.
          const patch = { chapterDesign: clampDesign({ ...design, showNumber: on }) }
          if (on && num.style === 'none') patch.chapterNumbering = { ...num, style: 'words' }
          layout.applyBook(patch)
        }}
      />
      {design.showNumber ? (
        <>
          <PickerRow label="Numbered" value={num.style} onChange={(style) => layout.applyBook({ chapterNumbering: { ...num, style } })} options={[{ value: 'words', label: 'One, Two, Three' }, { value: 'numerals', label: '1, 2, 3' }, { value: 'roman', label: 'I, II, III' }]} />
          <FormRow label="Before the Number"><CommitText value={num.prefix} placeholder="Chapter" label="Before the number" onCommit={(prefix) => layout.applyBook({ chapterNumbering: { ...num, prefix } })} /></FormRow>
          <FormRow label="First Chapter"><Segmented value={String(num.startAt === 0 ? 0 : 1)} onChange={(v) => layout.applyBook({ chapterNumbering: { ...num, startAt: Number(v) } })} label="First chapter" options={[{ value: '1', label: '1' }, { value: '0', label: '0' }]} /></FormRow>
          <FormRow label="Heading"><span className="fin-value fin-serif">{example}</span></FormRow>
        </>
      ) : null}
      <ToggleRow label="Title" checked={design.showTitle} onChange={(showTitle) => edit({ showTitle })} />
      <ToggleRow label="Subtitle" checked={design.showSubtitle} onChange={(showSubtitle) => edit({ showSubtitle })} />
      <ToggleRow label="Each Chapter’s Picture" checked={design.showImage} onChange={(showImage) => edit({ showImage })} />
      <FormRow label="Alignment"><Segmented value={design.alignment} onChange={(alignment) => edit({ alignment })} label="Alignment" options={ALIGNS} /></FormRow>
      {design.showNumber ? (<><PickerRow label="Number Set In" value={design.numberCase} onChange={(numberCase) => edit({ numberCase })} options={CASES} /><PointsRow label="Number Size" value={design.numberSizePt} onCommit={(numberSizePt) => edit({ numberSizePt })} /></>) : null}
      {design.showTitle ? (<><PickerRow label="Title Set In" value={design.titleCase} onChange={(titleCase) => edit({ titleCase })} options={CASES} /><PointsRow label="Title Size" value={design.titleSizePt} onCommit={(titleSizePt) => edit({ titleSizePt })} /></>) : null}
      <ToggleRow label="A Face of Its Own" checked={Boolean(design.headingFont)} onChange={(on) => edit({ headingFont: on ? (t?.fontFamily ?? 'Georgia, serif') : undefined })} />
      {design.headingFont ? <FormRow label="Heading Face"><FontSelect value={design.headingFont} onChange={(name) => edit({ headingFont: cssFamily(name) })} /></FormRow> : null}
      <PickerRow label="Ornament" value={design.ornament} onChange={(ornament) => edit({ ornament })} options={[{ value: 'none', label: 'None' }, { value: 'rule', label: 'A Rule' }, { value: 'glyph', label: 'A Glyph' }, { value: 'image', label: 'A Picture' }]} />
      {design.ornament === 'glyph' ? (
        <FormRow label="Glyph">
          <CommitText className="fin-centered" value={design.ornamentGlyph} placeholder="❦" label="Glyph" onCommit={(ornamentGlyph) => edit({ ornamentGlyph })} />
          <button type="button" className="reference-icon-button" aria-label="Glyphs" onClick={(event) => popUpNativeMenu(event, HEAD_GLYPHS.map((glyph) => ({ text: glyph, action: () => edit({ ornamentGlyph: glyph }) })))}><SFIcon name="chevron.down" size={10} /></button>
        </FormRow>
      ) : null}
      {design.ornament === 'image' ? (
        <FormRow label="Picture">
          {state.ornamentImageFile ? <img className="fin-thumb" src={fileUrl(state.ornamentImageFile)} alt="" /> : null}
          <button type="button" className="fin-button" onClick={async () => { const path = await choosePath({ title: 'Choose a picture every chapter’s head carries' }); if (path) layout.setHeadImage('ornament', path) }}>{design.ornamentImage ? 'Change…' : 'Choose…'}</button>
          {design.ornamentImage ? <button type="button" className="fin-button is-destructive" onClick={() => layout.setHeadImage('ornament', null)}>Remove</button> : null}
        </FormRow>
      ) : null}
      {design.ornament !== 'none' || design.showImage ? (
        <>
          <PickerRow label="Ornament and Picture" value={design.ornamentPosition} onChange={(ornamentPosition) => edit({ ornamentPosition })} options={[{ value: 'above', label: 'Above the Number' }, { value: 'between', label: 'Between Number and Title' }, { value: 'below', label: 'Below the Title' }]} />
          <FormRow label="Picture Width"><span className="fin-length"><CommitNumber value={design.imageWidthPct} digits={0} min={5} max={100} label="Picture width" onCommit={(imageWidthPct) => edit({ imageWidthPct })} /><span className="fin-unit">%</span></span></FormRow>
        </>
      ) : null}
      {t ? (
        <>
          <PickerRow label="First Paragraph" value={t.chapterOpening} onChange={(chapterOpening) => editType({ chapterOpening })} options={[{ value: 'plain', label: 'Plain' }, { value: 'dropCap', label: 'Drop Cap' }, { value: 'smallCaps', label: 'Small Caps' }, { value: 'dropCapAndSmallCaps', label: 'Drop Cap & Small Caps' }]} />
          <LengthRow label="Head Down the Page" mm={t.chapterSinkMm} unit={unit} onCommit={(chapterSinkMm) => editType({ chapterSinkMm })} />
        </>
      ) : <Note>Set type for print, under Body Text, for a drop cap and to set how far down the page each chapter opens.</Note>}
    </FinishingSection>
  )
}

export function PartsSection({ layout }) {
  const { book } = layout
  const part = book.partDesign
  const edit = (patch) => layout.applyBook({ partDesign: clampDesign({ ...part, ...patch }) })
  return (
    <FinishingSection id={SECTION.parts} title="Parts" note="Add a part from the Book navigator’s + menu. Parts are numbered “Part One”, “Part Two” in the chapters’ style, and listed in the contents.">
      <ToggleRow
        label="A Design of Their Own"
        checked={Boolean(part)}
        onChange={(on) => {
          const chapter = { ...DEFAULT_CHAPTER_DESIGN, ...(book.chapterDesign || {}) }
          layout.applyBook({ partDesign: on ? clampDesign({ ...chapter, showNumber: true, showTitle: true, chapterBreak: 'newRightPage', titleSizePt: Math.max(chapter.titleSizePt, 24), numberCase: 'upper' }) : undefined })
        }}
      />
      {part ? (
        <>
          <PickerRow label="Parts Start" value={part.chapterBreak} onChange={(chapterBreak) => edit({ chapterBreak })} options={[{ value: 'newPage', label: 'On a New Page' }, { value: 'newRightPage', label: 'On a Right-Hand Page' }]} />
          <FormRow label="Alignment"><Segmented value={part.alignment} onChange={(alignment) => edit({ alignment })} label="Alignment" options={ALIGNS} /></FormRow>
          <PickerRow label="Number Set In" value={part.numberCase} onChange={(numberCase) => edit({ numberCase })} options={CASES} />
          <PickerRow label="Title Set In" value={part.titleCase} onChange={(titleCase) => edit({ titleCase })} options={CASES} />
          <PickerRow label="Ornament" value={part.ornament === 'image' ? 'none' : part.ornament} onChange={(ornament) => edit({ ornament })} options={[{ value: 'none', label: 'None' }, { value: 'rule', label: 'A Rule' }, { value: 'glyph', label: 'A Glyph' }]} />
          {part.ornament === 'glyph' ? <FormRow label="Glyph"><CommitText className="fin-centered" value={part.ornamentGlyph} placeholder="❦" label="Glyph" onCommit={(ornamentGlyph) => edit({ ornamentGlyph })} /></FormRow> : null}
          <PointsRow label="Title Size" value={part.titleSizePt} onCommit={(titleSizePt) => edit({ titleSizePt: Math.min(72, Math.max(10, titleSizePt)) })} />
        </>
      ) : null}
    </FinishingSection>
  )
}
