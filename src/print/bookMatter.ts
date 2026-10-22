/**
 * bookMatter.ts — what a book adds to its chapters as it compiles: numbered chapter
 * headings, and the pages after the last chapter.
 *
 * Shared by printing and every export, so "Chapter Seven" is the same heading on paper,
 * in the EPUB and in the HTML. Pure functions over TipTap JSON; the front matter,
 * which is laid out rather than flowed, is `frontMatter.js` for print and part of each
 * export's own builder.
 */
import { BookItemKind, ChapterNumberStyle, ChapterType, MatterKind } from '../types'
import type { BackMatter, ChapterDesign, ChapterMeta, ChapterNumbering, FrontMatter } from '../types'
import { chapterNumbers, isLegacyMatter, partNumbers, sectionsOf } from './bookItems'
import type { BookSection, Chapter } from './compile'
import { toRoman } from './pageSetup'
import { chapterHeadText } from './ChapterHead'

interface PMNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PMNode[]
  text?: string
}

type Doc = Chapter['content']

/** A compiled chapter: a document's, or one of the book's own (back matter). */
export interface CompiledChapter extends Chapter {
  /** Set on the book's own pages, which are not numbered as chapters. */
  matter?: 'back'
}

const ONES = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

/** 1 → "One", 42 → "Forty-Two", 105 → "One Hundred Five": how a chapter number is spelled. */
export const numberToWords = (value: number): string => {
  const n = Math.floor(value)
  if (n < 0) return `Minus ${numberToWords(-n)}`
  if (n < 20) return ONES[n]
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '')
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${numberToWords(n % 100)}` : ''}`
  if (n < 1_000_000) return `${numberToWords(Math.floor(n / 1000))} Thousand${n % 1000 ? ` ${numberToWords(n % 1000)}` : ''}`
  return String(n)
}

/** "Chapter One", "Chapter 1", "Part IV" — or null when chapters keep their own headings. */
export const chapterLabel = (n: number, numbering?: ChapterNumbering | null): string | null => {
  const style = numbering?.style || ChapterNumberStyle.None
  if (style === ChapterNumberStyle.None) return null
  const number = style === ChapterNumberStyle.Words ? numberToWords(n)
    : style === ChapterNumberStyle.Roman ? toRoman(n)
      : String(n)
  const prefix = (numbering?.prefix || '').trim()
  return prefix ? `${prefix} ${number}` : number
}

const text = (value: string): PMNode => ({ type: 'text', text: value })
const heading = (content: PMNode[], attrs: Record<string, unknown> = {}): PMNode => ({
  type: 'heading',
  attrs: { ...attrs, level: 1 },
  content,
})

const hasHeading = (doc: Doc): boolean => (doc.content || []).some((n) => (n as PMNode).type === 'heading')

/**
 * A chapter's content, headed as the book asks: its number (and its own title under
 * it), or — numbering off — its own heading, with the document's name put in as one
 * when `insertTitle` is set and it has none.
 */
export const headChapter = (
  content: Doc,
  name: string,
  n: number,
  numbering: ChapterNumbering | null | undefined,
  { insertTitle = false }: { insertTitle?: boolean } = {}
): Doc => {
  const blocks = (content.content || []) as PMNode[]
  const label = chapterLabel(n, numbering)
  if (!label) {
    if (!insertTitle || hasHeading(content)) return content
    return { ...content, content: [heading([text(name)]), ...blocks] }
  }
  const first = blocks[0]
  const opensWithTitle = first?.type === 'heading' && first.attrs?.level === 1
  const title = opensWithTitle ? (first.content || []) : (name ? [text(name)] : [])
  const inline = numbering?.includeTitle && title.length
    ? [text(label), { type: 'hardBreak' }, ...title]
    : [text(label)]
  return {
    ...content,
    content: [heading(inline, opensWithTitle ? first.attrs : {}), ...(opensWithTitle ? blocks.slice(1) : blocks)],
  }
}

/** Paragraphs from typed text: a blank line between paragraphs, a line break within one. */
export const paragraphsOf = (value: string, { linePerParagraph = false } = {}): PMNode[] => {
  const blocks = linePerParagraph ? value.split(/\r?\n/) : value.split(/\r?\n\s*\r?\n/)
  return blocks
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split(/\r?\n/)
      const content: PMNode[] = []
      lines.forEach((line, i) => {
        if (i > 0) content.push({ type: 'hardBreak' })
        if (line) content.push(text(line))
      })
      return { type: 'paragraph', content }
    })
}

/** The pages after the last chapter, each a chapter of its own under its heading. */
export const backMatterChapters = (back: Partial<BackMatter> | null | undefined, author = ''): CompiledChapter[] => {
  const out: CompiledChapter[] = []
  const add = (title: string, body: string | undefined, options = {}) => {
    if (!body?.trim()) return
    out.push({
      path: '',
      name: title,
      matter: 'back',
      content: { type: 'doc', content: [heading([text(title)]), ...paragraphsOf(body, options)] },
    })
  }
  add('Acknowledgements', back?.acknowledgements)
  add('About the Author', back?.aboutTheAuthor)
  add(author ? `Also by ${author}` : 'Also By', back?.alsoBy, { linePerParagraph: true })
  return out
}

/**
 * A book's chapters as they print and export: each headed by its number when the book
 * numbers them, then the back matter. A document printed alone is left as it is.
 */
export const compileBook = (
  chapters: Chapter[],
  book: { chapterNumbering?: ChapterNumbering | null; backMatter?: Partial<BackMatter> | null } | null | undefined,
  { author = '', insertTitles = false }: { author?: string; insertTitles?: boolean } = {}
): CompiledChapter[] => [
  ...chapters.map((chapter, i) => ({
    ...chapter,
    content: headChapter(chapter.content, chapter.name, i + 1, book?.chapterNumbering, { insertTitle: insertTitles }),
  })),
  ...backMatterChapters(book?.backMatter, author),
]

/** A heading's or a chapter's title as text, a line break read as a colon. */
const inlineText = (nodes: PMNode[] = []): string => nodes
  .map((n) => (n.type === 'text' ? n.text || '' : n.type === 'hardBreak' ? ': ' : inlineText(n.content)))
  .join('')

/** What a chapter is called in a contents or an EPUB's navigation: its head, or its first heading. */
export const chapterTitleOf = (content: Doc, fallback: string): string => {
  const blocks = (content.content || []) as PMNode[]
  const head = blocks.find((n) => n.type === 'chapterHead')
  if (head) return chapterHeadText((head.attrs?.head || {}) as ChapterHeadValue) || fallback
  const first = blocks.find((n) => n.type === 'heading')
  return inlineText(first?.content).trim() || fallback
}

/* ---------------- chapter heads, as the book designs them ---------------- */

/** Everything a chapter head shows, resolved: what `ChapterHead.js` renders. */
export interface ChapterHeadValue {
  label?: string | null
  title?: string
  subtitle?: string
  image?: string
  imageWidthPct?: number
  ornament?: string
  ornamentGlyph?: string
  ornamentImage?: string
  ornamentPosition?: string
  alignment?: string
  numberCase?: string
  titleCase?: string
  headingFont?: string
  numberSizePt?: number
  titleSizePt?: number
  epigraph?: string
  epigraphSource?: string
}

/** A chapter's head: the book's design, filled with this chapter's number, title and own head. */
export const chapterHeadFor = (
  design: ChapterDesign,
  { label = null, title = '', meta = null }: { label?: string | null; title?: string; meta?: Partial<ChapterMeta> | null }
): ChapterHeadValue => {
  const head: ChapterHeadValue = {
    alignment: design.alignment,
    numberCase: design.numberCase,
    titleCase: design.titleCase,
    numberSizePt: design.numberSizePt,
    titleSizePt: design.titleSizePt,
    ornament: design.ornament,
    ornamentPosition: design.ornamentPosition,
    imageWidthPct: design.imageWidthPct,
  }
  if (design.showNumber && label) head.label = label
  if (design.showTitle && title) head.title = title
  if (design.showSubtitle && meta?.subtitle) head.subtitle = meta.subtitle
  if (design.showImage && meta?.image) head.image = meta.image
  if (meta?.epigraph) {
    head.epigraph = meta.epigraph
    if (meta.epigraphSource) head.epigraphSource = meta.epigraphSource
  }
  if (design.headingFont) head.headingFont = design.headingFont
  if (design.ornamentGlyph) head.ornamentGlyph = design.ornamentGlyph
  if (design.ornamentImage) head.ornamentImage = design.ornamentImage
  return head
}

/** A heading's inline content as plain text, a line break as a space. */
const plainTitle = (nodes: PMNode[] = []): string => nodes
  .map((n) => (n.type === 'text' ? n.text || '' : n.type === 'hardBreak' ? ' ' : plainTitle(n.content)))
  .join('')
  .trim()

/**
 * A chapter's content opening with its head: its opening Heading 1 becomes the head's
 * title (or its document's name does, with none), with its label over it.
 */
export const headWithDesign = (content: Doc, name: string, label: string | null, design: ChapterDesign): Doc => {
  const blocks = (content.content || []) as PMNode[]
  const first = blocks[0]
  const opensWithTitle = first?.type === 'heading' && first.attrs?.level === 1
  const title = opensWithTitle ? plainTitle(first.content) : name
  const meta = (content.attrs?.chapter || null) as Partial<ChapterMeta> | null
  const head: PMNode = { type: 'chapterHead', attrs: { head: chapterHeadFor(design, { label, title, meta }) } }
  return { ...content, content: [head, ...(opensWithTitle ? blocks.slice(1) : blocks)] }
}

/** One of the pages before the first chapter, as an export writes it. */
export interface FrontSection {
  kind: 'halfTitle' | 'titlePage' | 'copyright' | 'dedication' | 'epigraph'
  title?: string
  author?: string
  text?: string
  source?: string
}

/**
 * The front matter an export carries, in order. The contents are each format's own —
 * an EPUB's navigation, the HTML's list — so they are not among these.
 */
export const frontMatterSections = (
  book: { frontMatter?: Partial<FrontMatter> | null } | null | undefined,
  { title = '', author = '', titlePage = false }: { title?: string; author?: string; titlePage?: boolean } = {}
): FrontSection[] => {
  const front = book?.frontMatter || {}
  const out: FrontSection[] = []
  if (front.halfTitle && title) out.push({ kind: 'halfTitle', title })
  if (titlePage) out.push({ kind: 'titlePage', title, author })
  if (front.copyright?.trim()) out.push({ kind: 'copyright', text: front.copyright.trim() })
  if (front.dedication?.trim()) out.push({ kind: 'dedication', text: front.dedication.trim() })
  if (front.epigraph?.trim()) out.push({ kind: 'epigraph', text: front.epigraph.trim(), source: front.epigraphSource?.trim() || '' })
  return out
}

/* ---------------- a book compiled from its contents ---------------- */

/** Where a section falls: before the first chapter, among them, or after the last. */
export type SectionRole = 'front' | 'body' | 'back'

/** A book section as it prints: headed, numbered, and placed. */
export interface CompiledSection extends BookSection {
  role: SectionRole
  /** A numbered chapter's number, or a part's. */
  number?: number
  /** The label its head carries: "Chapter One", "Prologue", "Part II". */
  label?: string | null
}

const TYPE_LABELS: Partial<Record<ChapterType, string>> = {
  [ChapterType.Prologue]: 'Prologue',
  [ChapterType.Epilogue]: 'Epilogue',
  [ChapterType.Interlude]: 'Interlude',
}

/** A legacy matter page's text, as it was typed into the Book tab before pages were documents. */
export const legacyMatterContent = (
  kind: MatterKind | undefined,
  book: { frontMatter?: Partial<FrontMatter> | null; backMatter?: Partial<BackMatter> | null } | null | undefined,
  author = ''
): Doc => {
  const front = book?.frontMatter || {}
  const back = book?.backMatter || {}
  const centered = (value: string) => paragraphsOf(value).map((n) => ({ ...n, attrs: { textAlign: 'center' } }))
  switch (kind) {
    case MatterKind.Copyright: return { type: 'doc', content: paragraphsOf(front.copyright || '') }
    case MatterKind.Dedication: return { type: 'doc', content: centered(front.dedication || '') }
    case MatterKind.Epigraph: return {
      type: 'doc',
      content: [...centered(front.epigraph || ''), ...(front.epigraphSource?.trim() ? centered(`— ${front.epigraphSource.trim()}`) : [])],
    }
    case MatterKind.Acknowledgements: return { type: 'doc', content: [heading([text('Acknowledgements')]), ...paragraphsOf(back.acknowledgements || '')] }
    case MatterKind.AboutAuthor: return { type: 'doc', content: [heading([text('About the Author')]), ...paragraphsOf(back.aboutTheAuthor || '')] }
    case MatterKind.AlsoBy: return {
      type: 'doc',
      content: [heading([text(author ? `Also by ${author}` : 'Also By')]), ...paragraphsOf(back.alsoBy || '', { linePerParagraph: true })],
    }
    default: return { type: 'doc', content: [] }
  }
}

/** A part's divider: its number and its title, as one heading — or, designed, as a head. */
export const partContent = (label: string | null, title: string, design?: ChapterDesign | null): Doc => {
  if (design) {
    const head = chapterHeadFor({ ...design, showNumber: true, showTitle: true }, { label, title: title === label ? '' : title })
    return { type: 'doc', attrs: { bookPart: true }, content: [{ type: 'chapterHead', attrs: { head } }] }
  }
  const inline: PMNode[] = label ? [text(label)] : []
  if (title && title !== label) inline.push(...(inline.length ? [{ type: 'hardBreak' }] : []), text(title))
  return { type: 'doc', attrs: { bookPart: true }, content: inline.length ? [heading(inline)] : [] }
}

/**
 * A book's sections as they print and export: each chapter headed by its number (or
 * its type — "Prologue"), each part a divider, legacy matter set from its text, and each
 * placed front, body or back. Generated pages (a title page, the contents) pass through
 * for the printer or the export to lay out.
 */
export const compileSections = (
  sections: BookSection[],
  book: {
    chapterNumbering?: ChapterNumbering | null
    frontMatter?: Partial<FrontMatter> | null
    backMatter?: Partial<BackMatter> | null
    chapterDesign?: ChapterDesign | null
    partDesign?: ChapterDesign | null
  } | null | undefined,
  { author = '', insertTitles = false }: { author?: string; insertTitles?: boolean } = {}
): CompiledSection[] => {
  // A book set up before designs is headed as it was, by its numbering alone.
  const design = book?.chapterDesign || null
  const items = sections.map((s) => s.item)
  const numbering = book?.chapterNumbering
  const numbers = chapterNumbers(items, numbering?.startAt ?? 1)
  const parts = partNumbers(items)
  const { front, back } = sectionsOf(sections.map((s) => ({ ...s.item, section: s })))
  const roleOf = new Map<BookSection, SectionRole>()
  front.forEach((it) => roleOf.set(it.section, 'front'))
  back.forEach((it) => roleOf.set(it.section, 'back'))
  const partNumbering = {
    style: !numbering?.style || numbering.style === ChapterNumberStyle.None ? ChapterNumberStyle.Words : numbering.style,
    prefix: 'Part',
    includeTitle: true,
  } as ChapterNumbering

  return sections.map((section) => {
    const role = roleOf.get(section) || 'body'
    const { item } = section
    if (item.kind === BookItemKind.Part) {
      const n = parts.get(item.id)
      const label = n ? chapterLabel(n, partNumbering) : null
      return { ...section, role, number: n, label, content: partContent(label, item.title || section.name, design ? (book?.partDesign || design) : null) }
    }
    if (item.kind === BookItemKind.Matter) {
      const content = isLegacyMatter(item) ? legacyMatterContent(item.matter, book, author) : section.content
      return { ...section, role, content }
    }
    if (item.kind !== BookItemKind.Chapter || !section.content) return { ...section, role }
    const number = numbers.get(item.id)
    const typeLabel = TYPE_LABELS[item.chapterType as ChapterType]
    let content: Doc
    let label: string | null = null
    if (design) {
      label = number != null ? chapterLabel(number, { ...numbering, style: numbering?.style && numbering.style !== ChapterNumberStyle.None ? numbering.style : ChapterNumberStyle.Words, prefix: numbering?.prefix ?? 'Chapter' } as ChapterNumbering) : (typeLabel || null)
      // A prologue says what it is whether or not the book shows chapter numbers.
      const shown = typeLabel ? { ...design, showNumber: true } : design
      content = headWithDesign(section.content, section.name, label, shown)
    } else if (number != null) {
      content = headChapter(section.content, section.name, number, numbering, { insertTitle: insertTitles })
      label = chapterLabel(number, numbering)
    } else if (typeLabel) {
      // A prologue is headed by what it is, over its own title when the book keeps titles.
      content = headChapter(section.content, section.name, 0, null, { insertTitle: insertTitles })
      content = labelled(content, typeLabel, numbering?.includeTitle !== false)
      label = typeLabel
    } else {
      content = headChapter(section.content, section.name, 0, null, { insertTitle: insertTitles })
    }
    return { ...section, role, number, label, content }
  })
}

/** A chapter's content with `label` over (or instead of) its opening title. */
const labelled = (content: Doc, label: string, keepTitle: boolean): Doc => {
  const blocks = (content.content || []) as PMNode[]
  const first = blocks[0]
  const opensWithTitle = first?.type === 'heading' && first.attrs?.level === 1
  const title = opensWithTitle ? (first.content || []) : []
  const inline = keepTitle && title.length ? [text(label), { type: 'hardBreak' }, ...title] : [text(label)]
  return { ...content, content: [heading(inline, opensWithTitle ? first.attrs : {}), ...(opensWithTitle ? blocks.slice(1) : blocks)] }
}
