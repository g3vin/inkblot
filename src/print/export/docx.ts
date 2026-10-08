/**
 * docx.ts — a document or a book as a Word file, written by hand: no library.
 *
 * A .docx is a ZIP of XML parts (Office Open XML). What goes in:
 *
 *   word/document.xml   the text, one section per chapter, so a chapter opens on a new
 *                       page (a right-hand one, if the setup asks) with no running head
 *                       on its first page when the setup leaves it off
 *   word/styles.xml     the setup's typography as Normal, Heading 1–6, Quote and Code —
 *                       so an editor restyling the manuscript changes it everywhere
 *   word/numbering.xml  bullets and numbers, each list restarting on its own
 *   word/header*.xml    the running heads and feet, left / centre / right on tab stops,
 *   word/footer*.xml    with {page}, {pages} and {chapter} as live Word fields
 *   word/settings.xml   facing pages, different left and right heads, hyphenation
 *   word/media/*        the images, PNG, JPEG or GIF
 *
 * The page setup becomes the section properties: paper, orientation, margins and
 * gutter, header and footer distances, columns, and the page-number format and start.
 * Word lays the pages out itself, so its page breaks are its own, not Print Layout's.
 */
import type { FrontSection } from '../bookMatter'
import { normalizePageSetup, surnameOf, describeWordCount } from '../pageSetup'
import type { PageSetup } from '../pageSetup'
import { contactLines } from '../titlePage'
import { LineSpacing, PageNumberFormat, PageOrientation, PrintAlignment, TitlePageStyle } from '../../types'
import type { AuthorProfile, PrintTypography, RunningText, TextStyleLook } from '../../types'
import type { ExportChapter } from './html'
import { imageSize, isRemote, toPortableImage } from './images'
import type { ResolvedImage } from './images'
import { collectImageSources, portableContent } from './portable'
import type { PMJSON } from './portable'
import { escapeXml as x } from './xml'
import { createZip } from './zip'

export interface DocxOptions {
  title: string
  author?: string
  language?: string
  chapters: ExportChapter[]
  setup?: PageSetup | null
  /** A book's pages before its first chapter; a `titlePage` is set in the setup's style. */
  front?: FrontSection[]
  /** A table of contents (a Word TOC field, filled in when Word opens the file). */
  contents?: boolean
  /** For a manuscript's title page: contact details and the word count. */
  profile?: Partial<AuthorProfile>
  words?: number
  /** The book's named text styles, as Word paragraph styles. */
  textStyles?: TextStyleLook[]
  resolveImage: (src: string) => Promise<ResolvedImage | null>
  modified?: Date
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NS = `xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

/** Twentieths of a point, Word's unit for lengths on the page. */
export const twips = (mm: number): number => Math.round((mm * 1440) / 25.4)
const EMU_PER_PX = 9525
const PX_PER_MM = 96 / 25.4

/* ---------------- runs ---------------- */

type Mark = NonNullable<PMJSON['marks']>[number]

/** A CSS colour as Word's six hex digits, or null for one it cannot take. */
export const hexColor = (value: unknown): string | null => {
  const s = String(value || '').trim()
  const hex = /^#?([0-9a-f]{6})$/i.exec(s) || /^#?([0-9a-f]{3})$/i.exec(s)
  if (hex) return (hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1]).toUpperCase()
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s)
  if (rgb) return rgb.slice(1, 4).map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('').toUpperCase()
  return null
}

/** A CSS font size in half-points, Word's unit for type sizes. */
const halfPoints = (value: unknown): number | null => {
  const m = /^([\d.]+)\s*(px|pt|em|rem)?$/i.exec(String(value || '').trim())
  if (!m) return null
  const n = Number(m[1])
  const unit = (m[2] || 'px').toLowerCase()
  const pt = unit === 'pt' ? n : unit === 'px' ? n * 0.75 : n * 12
  return Number.isFinite(pt) && pt > 0 ? Math.round(pt * 2) : null
}

const firstFamily = (list: unknown): string => String(list || '').split(',')[0].trim().replace(/^["']|["']$/g, '')

/** Run formatting a caller adds to the marks': a header cell's bold, a page's size. */
interface RunExtra { b?: boolean; i?: boolean; sz?: number; u?: boolean }

const runProps = (marks: Mark[] = [], extra: RunExtra = {}): string => {
  const has = (type: string) => marks.find((m) => m.type === type)
  const style = has('textStyle')?.attrs || {}
  const parts: string[] = []
  const code = has('code')
  const family = code ? 'Courier New' : firstFamily(style.fontFamily)
  if (family) parts.push(`<w:rFonts w:ascii="${x(family)}" w:hAnsi="${x(family)}" w:cs="${x(family)}"/>`)
  if (has('bold') || extra.b) parts.push('<w:b/>')
  if (has('italic') || extra.i) parts.push('<w:i/>')
  if (has('strike')) parts.push('<w:strike/>')
  const color = hexColor(style.color)
  if (color) parts.push(`<w:color w:val="${color}"/>`)
  const size = halfPoints(style.fontSize) || extra.sz
  if (size) parts.push(`<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`)
  if (has('underline') || has('link') || extra.u) parts.push('<w:u w:val="single"/>')
  const highlight = has('highlight')
  if (highlight) parts.push(`<w:shd w:val="clear" w:color="auto" w:fill="${hexColor(highlight.attrs?.color) || 'FFF59D'}"/>`)
  if (has('subscript')) parts.push('<w:vertAlign w:val="subscript"/>')
  else if (has('superscript')) parts.push('<w:vertAlign w:val="superscript"/>')
  const rStyle = has('link') ? '<w:rStyle w:val="Hyperlink"/>' : ''
  const inner = rStyle + parts.join('')
  return inner ? `<w:rPr>${inner}</w:rPr>` : ''
}

/** Text as runs' content: tabs and line breaks as Word's own. */
const textContent = (value: string): string => value
  .split(/(\t|\n)/)
  .map((piece) => (piece === '\t' ? '<w:tab/>' : piece === '\n' ? '<w:br/>' : piece ? `<w:t xml:space="preserve">${x(piece)}</w:t>` : ''))
  .join('')

const run = (value: string, marks: Mark[] = [], extra: RunExtra = {}): string => `<w:r>${runProps(marks, extra)}${textContent(value)}</w:r>`

/** HTML (a citation, a bibliography entry) as its text. */
const htmlText = (html: unknown): string => {
  const s = String(html || '')
  if (!s) return ''
  if (typeof DOMParser !== 'undefined') return new DOMParser().parseFromString(s, 'text/html').body.textContent || ''
  return s.replace(/<[^>]*>/g, '')
}

/* ---------------- the writer ---------------- */

interface Section {
  body: string
  /** How the section starts: after a page, or on the next right-hand one. */
  start: 'nextPage' | 'oddPage'
  /** The chapter's running heads (none for the front matter). */
  heads: boolean
  /** No running head on its first page. */
  titlePg: boolean
  /** Numbering restarts here, at this number. */
  pageStart?: number
}

interface Placed { rid: string; cx: number; cy: number; name: string }

class Writer {
  rels: Array<{ id: string; type: string; target: string; external?: boolean }> = []
  media: Array<{ name: string; bytes: Uint8Array }> = []
  images = new Map<string, Placed | null>()
  lists: Array<{ abstract: number; start: number }> = []
  drawingId = 0
  /** The next paragraph opens flush: after a heading or a scene break. */
  flushNext = false
  /** Notes at their marks, as Word footnotes, numbered from 1. */
  footnotes: string[] = []

  constructor(readonly setup: PageSetup, readonly type: PrintTypography | undefined) {}

  rel(type: string, target: string, external = false): string {
    const id = `rId${this.rels.length + 1}`
    this.rels.push({ id, type, target, external })
    return id
  }

  get contentWidthPx(): number {
    const s = this.setup
    const w = s.orientation === PageOrientation.Landscape ? s.heightMm : s.widthMm
    const width = w - s.margins.insideMm - s.margins.outsideMm - s.margins.gutterMm
    return ((s.columns > 1 ? (width - s.columnGapMm * (s.columns - 1)) / s.columns : width) * PX_PER_MM)
  }

  get contentWidthTwips(): number {
    return Math.round((this.contentWidthPx / PX_PER_MM) * (1440 / 25.4))
  }

  async placeImages(chapters: PMJSON[], resolve: DocxOptions['resolveImage']): Promise<void> {
    for (const chapter of chapters) {
      for (const src of collectImageSources(chapter)) {
        if (this.images.has(src)) continue
        const raw = isRemote(src) ? null : await resolve(src)
        const image = raw ? await toPortableImage(raw) : null
        const size = image ? imageSize(image) : null
        if (!image || !size) {
          this.images.set(src, null)
          continue
        }
        const name = `image${this.media.length + 1}.${image.ext === 'jpeg' ? 'jpg' : image.ext}`
        this.media.push({ name, bytes: image.bytes })
        const rid = this.rel(`${REL}/image`, `media/${name}`)
        this.images.set(src, { rid, name, cx: size.width, cy: size.height })
      }
    }
  }

  drawing(src: string, widthAttr: unknown): string {
    const placed = this.images.get(src)
    if (!placed) return ''
    const max = this.contentWidthPx
    const asked = String(widthAttr ?? '')
    let width = /%$/.test(asked) ? (Number.parseFloat(asked) / 100) * max : Number.parseFloat(asked)
    if (!Number.isFinite(width) || width <= 0) width = placed.cx
    width = Math.min(width, max)
    const height = (width * placed.cy) / placed.cx
    const cx = Math.round(width * EMU_PER_PX)
    const cy = Math.round(height * EMU_PER_PX)
    this.drawingId += 1
    const id = this.drawingId
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${x(placed.name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${placed.rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  }

  /** Inline content as runs. */
  inline(nodes: PMJSON[] = [], extra: RunExtra = {}): string {
    return nodes.map((node) => {
      if (node.type === 'text') {
        const link = node.marks?.find((m) => m.type === 'link')
        const href = typeof link?.attrs?.href === 'string' ? link.attrs.href : ''
        const r = run(node.text || '', node.marks, extra)
        if (!href) return r
        return `<w:hyperlink r:id="${this.rel(`${REL}/hyperlink`, href, true)}">${r}</w:hyperlink>`
      }
      if (node.type === 'hardBreak') return '<w:r><w:br/></w:r>'
      if (node.type === 'image') return this.drawing(String(node.attrs?.src || ''), node.attrs?.width)
      if (node.type === 'citation') return run(htmlText(node.attrs?.rendered), [], extra)
      if (node.type === 'footnote') {
        // Set after the chapter or the book: its mark only, raised.
        if (node.attrs?.end) return `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>${textContent(String(node.attrs?.mark || ''))}</w:r>`
        this.footnotes.push(String(node.attrs?.text || ''))
        return `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${this.footnotes.length}"/></w:r>`
      }
      return this.inline(node.content, extra)
    }).join('')
  }

  paragraph(props: { style?: string; align?: unknown; flush?: boolean; numId?: number; level?: number; indentLeft?: number; keepNext?: boolean }, runs: string): string {
    const p: string[] = []
    if (props.style) p.push(`<w:pStyle w:val="${props.style}"/>`)
    if (props.keepNext) p.push('<w:keepNext/>')
    if (props.numId) p.push(`<w:numPr><w:ilvl w:val="${props.level || 0}"/><w:numId w:val="${props.numId}"/></w:numPr>`)
    if (props.indentLeft != null) p.push(`<w:ind w:left="${props.indentLeft}" w:firstLine="0"/>`)
    else if (props.flush) p.push('<w:ind w:firstLine="0"/>')
    const jc = { center: 'center', right: 'right', justify: 'both', left: 'left' }[String(props.align || '')]
    if (jc) p.push(`<w:jc w:val="${jc}"/>`)
    return `<w:p>${p.length ? `<w:pPr>${p.join('')}</w:pPr>` : ''}${runs}</w:p>`
  }

  newList(ordered: boolean, start = 1): number {
    this.lists.push({ abstract: ordered ? 1 : 0, start })
    return this.lists.length
  }

  /** Block content as paragraphs and tables. `quote` sets paragraphs as quotations. */
  blocks(nodes: PMJSON[] = [], ctx: { quote?: boolean; level?: number } = {}): string {
    return nodes.map((node) => this.block(node, ctx)).join('')
  }

  block(node: PMJSON, ctx: { quote?: boolean; level?: number } = {}): string {
    const attrs = node.attrs || {}
    switch (node.type) {
      case 'paragraph': {
        const flush = this.flushNext
        this.flushNext = false
        const named = typeof attrs.styleName === 'string' && attrs.styleName ? textStyleId(attrs.styleName) : undefined
        const p = this.paragraph({ style: named || (ctx.quote ? 'Quote' : undefined), align: attrs.textAlign, flush: flush && !named }, this.inline(node.content))
        // A picture with a page to itself.
        const fullPage = (node.content || []).some((n) => n.type === 'image' && (n.attrs?.layout === 'page' || n.attrs?.layout === 'bleed'))
        const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
        return fullPage ? `${pageBreak}${p}${pageBreak}` : p
      }
      case 'heading': {
        const level = Math.min(6, Math.max(1, Number(attrs.level) || 1))
        this.flushNext = Boolean(this.type?.noIndentAfterBreak)
        return this.paragraph({ style: `Heading${level}`, align: attrs.textAlign }, this.inline(node.content))
      }
      case 'blockquote':
        return this.blocks(node.content, { ...ctx, quote: true })
      case 'bulletList':
      case 'orderedList':
        return this.list(node, ctx.level || 0)
      case 'codeBlock': {
        const text = (node.content || []).map((n) => n.text || '').join('')
        return this.paragraph({ style: 'Code' }, run(text))
      }
      case 'horizontalRule': {
        this.flushNext = Boolean(this.type?.noIndentAfterBreak)
        const glyph = this.type?.sceneBreak || '* * *'
        return this.paragraph({ style: 'SceneBreak' }, glyph ? run(glyph) : '')
      }
      case 'image':
        return this.paragraph({ align: 'center', flush: true }, this.drawing(String(attrs.src || ''), attrs.width))
      case 'pageBreak': {
        const kind = attrs.kind === 'column' ? 'column' : 'page'
        return `<w:p><w:r><w:br w:type="${kind}"/></w:r></w:p>`
      }
      case 'table':
        return this.table(node)
      case 'scriptElement':
        return this.paragraph({ style: scriptStyleId(attrs.element) }, this.inline(node.content))
      case 'bibliography': {
        const out = [this.paragraph({ style: 'Heading2', align: 'center' }, run(String(attrs.title || 'References')))]
        for (const note of (attrs.notes as unknown[]) || []) out.push(this.paragraph({ flush: true }, run(htmlText(note))))
        for (const entry of (attrs.entries as Array<{ html?: string; annotation?: string }>) || []) {
          out.push(this.paragraph({ style: 'Bibliography' }, run(htmlText(entry?.html))))
          if (entry?.annotation) out.push(this.paragraph({ indentLeft: 720 }, run(entry.annotation)))
        }
        return out.join('')
      }
      default:
        // Anything else that holds blocks is written as its blocks; a leaf is left out.
        return node.content ? this.blocks(node.content, ctx) : ''
    }
  }

  list(node: PMJSON, level: number): string {
    const ordered = node.type === 'orderedList'
    const numId = this.newList(ordered, Number(node.attrs?.start) || 1)
    return (node.content || []).map((item) => (item.content || []).map((child, i) => {
      if (child.type === 'bulletList' || child.type === 'orderedList') return this.list(child, Math.min(8, level + 1))
      if (child.type === 'paragraph' && i === 0) {
        return this.paragraph({ style: 'ListParagraph', numId, level, align: child.attrs?.textAlign }, this.inline(child.content))
      }
      // A second paragraph in an item sits under the first, unnumbered.
      if (child.type === 'paragraph') return this.paragraph({ indentLeft: 720 * (level + 1) }, this.inline(child.content))
      return this.block(child, { level: level + 1 })
    }).join('')).join('')
  }

  table(node: PMJSON): string {
    const rows = node.content || []
    const firstRow = rows[0]?.content || []
    const columns = Math.max(1, firstRow.reduce((n, cell) => n + (Number(cell.attrs?.colspan) || 1), 0))
    const widths: number[] = []
    for (const cell of firstRow) {
      const span = Number(cell.attrs?.colspan) || 1
      const given = Array.isArray(cell.attrs?.colwidth) ? (cell.attrs?.colwidth as unknown[]) : []
      for (let i = 0; i < span; i += 1) widths.push(Number(given[i]) || 0)
    }
    const total = this.contentWidthTwips
    const known = widths.reduce((a, b) => a + b, 0)
    const grid = widths.every((w) => w > 0) && known > 0
      ? widths.map((w) => Math.round((w / known) * total))
      : Array.from({ length: columns }, () => Math.round(total / columns))
    // Cells a row-spanning cell above still covers, by grid column: how many rows more.
    const covering = new Map<number, { rows: number; span: number }>()
    const rowXml = rows.map((row) => {
      const cells: string[] = []
      let col = 0
      const header = (row.content || []).every((c) => c.type === 'tableHeader')
      const continueMerges = () => {
        let merge = covering.get(col)
        while (merge && merge.rows > 0) {
          merge.rows -= 1
          const span = merge.span
          const width = grid.slice(col, col + span).reduce((a, b) => a + b, 0)
          cells.push(`<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}<w:vMerge/></w:tcPr><w:p/></w:tc>`)
          if (merge.rows === 0) covering.delete(col)
          col += span
          merge = covering.get(col)
        }
      }
      for (const cell of row.content || []) {
        continueMerges()
        const span = Number(cell.attrs?.colspan) || 1
        const rowspan = Number(cell.attrs?.rowspan) || 1
        const width = grid.slice(col, col + span).reduce((a, b) => a + b, 0) || Math.round(total / columns)
        const props = [
          `<w:tcW w:w="${width}" w:type="dxa"/>`,
          span > 1 ? `<w:gridSpan w:val="${span}"/>` : '',
          rowspan > 1 ? '<w:vMerge w:val="restart"/>' : '',
          cell.type === 'tableHeader' ? '<w:shd w:val="clear" w:color="auto" w:fill="F0F0F0"/>' : '',
        ].join('')
        if (rowspan > 1) covering.set(col, { rows: rowspan - 1, span })
        const saved = this.flushNext
        this.flushNext = true
        const content = (cell.content || []).map((child) => (child.type === 'paragraph'
          ? this.paragraph({ flush: true, align: child.attrs?.textAlign }, this.inline(child.content, { b: cell.type === 'tableHeader' }))
          : this.block(child))).join('') || '<w:p/>'
        this.flushNext = saved
        cells.push(`<w:tc><w:tcPr>${props}</w:tcPr>${content}</w:tc>`)
        col += span
      }
      continueMerges()
      return `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells.join('')}</w:tr>`
    }).join('')
    const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>`
    return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rowXml}</w:tbl><w:p/>`
  }

  /** A chapter's content as sections: a break to a right-hand page starts a new one. */
  chapterSections(content: PMJSON, first: boolean): Section[] {
    this.flushNext = Boolean(this.type?.noIndentAfterBreak)
    const out: Section[] = []
    let body: string[] = []
    let start: Section['start'] = this.setup.chapterStartsOnRecto ? 'oddPage' : 'nextPage'
    let opening = true
    for (const node of content.content || []) {
      if (node.type === 'pageBreak' && node.attrs?.kind === 'recto') {
        out.push({ body: body.join(''), start, heads: true, titlePg: opening && this.setup.differentFirstPage })
        body = []
        start = 'oddPage'
        opening = false
        continue
      }
      body.push(this.block(node))
    }
    out.push({ body: body.join(''), start, heads: true, titlePg: opening && this.setup.differentFirstPage })
    if (first) out[0].pageStart = this.setup.pageNumberStart
    return out
  }
}

/* ---------------- the title page and front matter ---------------- */

const centered = (w: Writer, text: string, extra: RunExtra = {}): string => w.paragraph({ align: 'center', flush: true }, run(text, [], extra))

/** Space before a paragraph, as a share of the text block's height. */
const spaceBefore = (setup: PageSetup, share: number): string => {
  const landscape = setup.orientation === PageOrientation.Landscape
  const height = (landscape ? setup.widthMm : setup.heightMm) - setup.margins.topMm - setup.margins.bottomMm
  return `<w:spacing w:before="${twips(height * share)}"/>`
}

/** A paragraph with space before it, the spacing put where the schema wants it. */
const withSpace = (paragraph: string, spacing: string): string => {
  if (!paragraph.startsWith('<w:p><w:pPr>')) return paragraph.replace(/^<w:p>/, `<w:p><w:pPr>${spacing}</w:pPr>`)
  const end = paragraph.indexOf('</w:pPr>')
  const pPr = paragraph.slice(0, end)
  const at = ['<w:ind', '<w:jc'].map((tag) => pPr.indexOf(tag)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? end
  return paragraph.slice(0, at) + spacing + paragraph.slice(at)
}

const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'

const titlePageXml = (w: Writer, section: FrontSection, options: DocxOptions): string => {
  const setup = w.setup
  const style = setup.titlePage?.style || TitlePageStyle.Book
  const title = section.title || options.title
  const byline = section.author || options.author || options.profile?.byline || ''
  const contact = setup.titlePage?.showContact ? contactLines(options.profile || {}) : []
  if (style === TitlePageStyle.Manuscript) {
    const words = setup.titlePage?.showWordCount && options.words ? describeWordCount(options.words) : ''
    const right = w.contentWidthTwips
    const lines = Math.max(contact.length, words ? 1 : 0)
    const top = Array.from({ length: lines }, (_, i) => (
      `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="${right}"/></w:tabs><w:ind w:firstLine="0"/></w:pPr>${run(contact[i] || '')}${i === 0 && words ? `<w:r><w:tab/></w:r>${run(words)}` : ''}</w:p>`
    )).join('')
    return top
      + withSpace(centered(w, title.toUpperCase()), spaceBefore(setup, 0.33))
      + (byline ? centered(w, `by ${byline}`) : '')
  }
  if (style === TitlePageStyle.Screenplay) {
    return withSpace(centered(w, title.toUpperCase(), { u: true }), spaceBefore(setup, 0.33))
      + centered(w, '')
      + centered(w, 'Written by')
      + (byline ? centered(w, byline) : '')
      + (contact.length ? withSpace(w.paragraph({ flush: true }, run(contact.join('\n'))), spaceBefore(setup, 0.3)) : '')
  }
  return withSpace(centered(w, title, { sz: 48 }), spaceBefore(setup, 0.3))
    + (byline ? centered(w, byline, { sz: 28 }) : '')
}

const frontXml = (w: Writer, sections: FrontSection[], options: DocxOptions): string => {
  const pages: string[] = sections.map((section) => {
    const paragraphs = (text = '') => text.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean)
    switch (section.kind) {
      case 'halfTitle': return withSpace(centered(w, section.title || '', { sz: 36 }), spaceBefore(w.setup, 0.3))
      case 'titlePage': return titlePageXml(w, section, options)
      case 'copyright': return paragraphs(section.text).map((p) => w.paragraph({ flush: true }, run(p, [], { sz: 18 }))).join('')
      case 'dedication': return paragraphs(section.text)
        .map((p, i) => { const para = centered(w, p, { i: true }); return i === 0 ? withSpace(para, spaceBefore(w.setup, 0.28)) : para }).join('')
      case 'epigraph': return paragraphs(section.text)
        .map((p, i) => { const para = w.paragraph({ style: 'Epigraph' }, run(p)); return i === 0 ? withSpace(para, spaceBefore(w.setup, 0.28)) : para }).join('')
        + (section.source ? w.paragraph({ align: 'right', flush: true }, run(`— ${section.source}`)) : '')
      default: return ''
    }
  })
  if (options.contents) {
    pages.push(`${centered(w, 'Contents', { b: true, sz: 32 })}<w:p><w:pPr><w:ind w:firstLine="0"/></w:pPr><w:fldSimple w:instr=" TOC \\o &quot;1-1&quot; \\h \\z \\u "><w:r><w:t>Word fills in the contents when the file is opened. If it asks, choose Yes.</w:t></w:r></w:fldSimple></w:p>`)
  }
  return pages.filter(Boolean).join(PAGE_BREAK)
}

/* ---------------- running heads ---------------- */

const FIELDS: Record<string, string> = { page: ' PAGE ', pages: ' NUMPAGES ', chapter: ' STYLEREF "heading 1" ' }

const runningRuns = (template: string, ctx: Record<string, string>): string => template
  .split(/(\{[a-z]+\})/)
  .map((piece) => {
    const token = /^\{([a-z]+)\}$/.exec(piece)?.[1]
    if (token && FIELDS[token]) return `<w:fldSimple w:instr="${x(FIELDS[token])}"><w:r><w:t>${token === 'chapter' ? '' : '1'}</w:t></w:r></w:fldSimple>`
    if (token && token in ctx) return run(ctx[token])
    return piece ? run(piece) : ''
  })
  .join('')

const headerPart = (kind: 'hdr' | 'ftr', text: RunningText | null, w: Writer, ctx: Record<string, string>): string => {
  const width = w.contentWidthTwips
  const slots = text ? [text.left, text.center, text.right] : ['', '', '']
  const body = slots.map((slot) => runningRuns(slot || '', ctx)).join('<w:r><w:tab/></w:r>')
  const style = kind === 'hdr' ? 'Header' : 'Footer'
  return `${XML_HEAD}<w:${kind} ${NS}><w:p><w:pPr><w:pStyle w:val="${style}"/><w:tabs><w:tab w:val="center" w:pos="${Math.round(width / 2)}"/><w:tab w:val="right" w:pos="${width}"/></w:tabs></w:pPr>${text ? body : ''}</w:p></w:${kind}>`
}

/* ---------------- styles, numbering, settings ---------------- */

const lineSpacing = (t: PrintTypography | undefined): string => {
  if (!t) return '<w:spacing w:after="160" w:line="276" w:lineRule="auto"/>'
  const after = Math.round(t.paragraphSpacingPt * 20)
  switch (t.lineSpacing) {
    case LineSpacing.Exact: return `<w:spacing w:after="${after}" w:line="${Math.round(t.lineValue * 20)}" w:lineRule="exact"/>`
    case LineSpacing.OneAndAHalf: return `<w:spacing w:after="${after}" w:line="360" w:lineRule="auto"/>`
    case LineSpacing.Double: return `<w:spacing w:after="${after}" w:line="480" w:lineRule="auto"/>`
    case LineSpacing.Multiple: return `<w:spacing w:after="${after}" w:line="${Math.round(240 * t.lineValue)}" w:lineRule="auto"/>`
    default: return `<w:spacing w:after="${after}" w:line="240" w:lineRule="auto"/>`
  }
}

/**
 * A script's elements as paragraph styles, so a producer's assistant opening the file in
 * Word finds "Character" and "Dialogue" in the style list, set as the page has them
 * (Script.css): indents from the left margin in tenths of an inch, a blank line before
 * the lines that open something, capitals where the page shows them.
 */
interface ScriptStyle { id: string; name: string; left?: number; right?: number; before?: number; jc?: string; caps?: boolean; b?: boolean; i?: boolean; u?: boolean; keepNext?: boolean }

const INCH = 1440
const LINE = 240

const SCRIPT_STYLES: ScriptStyle[] = [
  { id: 'sceneHeading', name: 'Scene Heading', before: LINE, caps: true, b: true, keepNext: true },
  { id: 'action', name: 'Action', before: LINE },
  { id: 'character', name: 'Character', left: 2.2 * INCH, before: LINE, caps: true, keepNext: true },
  { id: 'parenthetical', name: 'Parenthetical', left: 1.6 * INCH, right: 1.9 * INCH, keepNext: true },
  { id: 'dialogue', name: 'Dialogue', left: 1.0 * INCH, right: 1.5 * INCH },
  { id: 'transition', name: 'Transition', before: LINE, jc: 'right', caps: true },
  { id: 'shot', name: 'Shot', before: LINE, caps: true, keepNext: true },
  { id: 'centered', name: 'Centered', before: LINE, jc: 'center' },
  { id: 'actHeading', name: 'Act', before: 2 * LINE, jc: 'center', caps: true, u: true, keepNext: true },
  { id: 'sceneTitle', name: 'Scene', before: LINE, jc: 'center', caps: true, keepNext: true },
  { id: 'stageDirection', name: 'Stage Direction', left: 2.5 * INCH, before: LINE, i: true },
  { id: 'stageCharacter', name: 'Stage Character', before: LINE, jc: 'center', caps: true, keepNext: true },
  { id: 'stageDialogue', name: 'Stage Dialogue' },
]

/** The style id a script element's paragraphs take ("ScriptDialogue"). */
export const scriptStyleId = (element: unknown): string => {
  const spec = SCRIPT_STYLES.find((s) => s.id === element) || SCRIPT_STYLES[1]
  return `Script${spec.id[0].toUpperCase()}${spec.id.slice(1)}`
}

const scriptStylesXml = (stage: boolean): string => SCRIPT_STYLES.map((s) => {
  // A play's parentheticals sit further in, in italics.
  const spec = stage && s.id === 'parenthetical' ? { ...s, left: 2.0 * INCH, right: 1.0 * INCH, i: true } : s
  const p = [
    spec.keepNext ? '<w:keepNext/>' : '',
    `<w:spacing w:before="${spec.before || 0}" w:after="0"/>`,
    `<w:ind w:left="${Math.round(spec.left || 0)}" w:right="${Math.round(spec.right || 0)}" w:firstLine="0"/>`,
    `<w:jc w:val="${spec.jc || 'left'}"/>`,
  ].join('')
  const r = [spec.b ? '<w:b/>' : '', spec.i ? '<w:i/>' : '', spec.caps ? '<w:caps/>' : '', spec.u ? '<w:u w:val="single"/>' : ''].join('')
  return `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${scriptStyleId(spec.id)}"><w:name w:val="${spec.name}"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>${p}</w:pPr>${r ? `<w:rPr>${r}</w:rPr>` : ''}</w:style>`
}).join('\n')

/** A named text style's Word style id. */
export const textStyleId = (id: string): string => `Text${id.replace(/[^A-Za-z0-9]/g, '')}`

/** The book's named text styles, as Word paragraph styles over Normal. */
const textStylesXml = (looks: TextStyleLook[], t: PrintTypography | undefined): string => {
  const body = t?.fontSizePt || 12
  const lineTwips = Math.round(body * 20 * 1.2)
  return looks.map((s) => {
    const p: string[] = []
    const space = Math.round(s.spaceLines * lineTwips)
    if (space) p.push(`<w:spacing w:before="${space}" w:after="${space}"/>`)
    if (s.boxed) p.push('<w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="4" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="4" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="4" w:color="auto"/></w:pBdr>')
    const indent = Math.round(s.indentEm * body * 20)
    if (indent || s.flush) p.push(`<w:ind${indent ? ` w:left="${indent}" w:right="${indent}"` : ''}${s.flush ? ' w:firstLine="0"' : ''}/>`)
    const jc = { left: 'left', center: 'center', right: 'right', justify: 'both' }[String(s.align)]
    if (jc) p.push(`<w:jc w:val="${jc}"/>`)
    const r: string[] = []
    if (s.fontFamily) {
      const face = x(firstFamily(s.fontFamily))
      r.push(`<w:rFonts w:ascii="${face}" w:hAnsi="${face}" w:cs="${face}"/>`)
    }
    if (s.italic) r.push('<w:i/>')
    if (s.smallCaps) r.push('<w:smallCaps/>')
    if (s.size !== 1) r.push(`<w:sz w:val="${Math.round(body * 2 * s.size)}"/><w:szCs w:val="${Math.round(body * 2 * s.size)}"/>`)
    return `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${textStyleId(s.id)}"><w:name w:val="${x(s.name)}"/><w:basedOn w:val="Normal"/><w:qFormat/>${p.length ? `<w:pPr>${p.join('')}</w:pPr>` : ''}${r.length ? `<w:rPr>${r.join('')}</w:rPr>` : ''}</w:style>`
  }).join('\n')
}

const stylesXml = (t: PrintTypography | undefined, language: string, script: 'screenplay' | 'stageplay' | null = null, textStyles: TextStyleLook[] = []): string => {
  const font = t ? firstFamily(t.fontFamily) : 'Georgia'
  const size = Math.round((t?.fontSizePt || 12) * 2)
  const indent = t ? twips(t.firstLineIndentMm) : 0
  const jc = t?.alignment === PrintAlignment.Justify ? '<w:jc w:val="both"/>' : ''
  const heading = (level: number, scale: number, extra = '') => `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${level === 1 ? 480 : 240}" w:after="${level === 1 ? 360 : 120}" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/>${extra}<w:jc w:val="${level === 1 && t ? 'center' : 'left'}"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${Math.round(size * scale)}"/><w:szCs w:val="${Math.round(size * scale)}"/></w:rPr></w:style>`
  // A chapter's title sits partway down its page, as the setup asks.
  const sink = t && t.chapterSinkMm > 0 ? `<w:spacing w:before="${twips(t.chapterSinkMm)}" w:after="480" w:line="240" w:lineRule="auto"/>` : ''
  const h1 = sink ? heading(1, 1.6).replace(/<w:spacing[^>]*\/>/, sink) : heading(1, 1.6)
  return `${XML_HEAD}<w:styles ${NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${x(font)}" w:hAnsi="${x(font)}" w:eastAsia="${x(font)}" w:cs="${x(font)}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:lang w:val="${x(language)}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>${lineSpacing(t)}</w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:widowControl/>${lineSpacing(t)}<w:ind w:firstLine="${indent}"/>${jc}</w:pPr></w:style>
${h1}
${heading(2, 1.3)}
${heading(3, 1.15)}
${heading(4, 1)}
${heading(5, 1)}
${heading(6, 1)}
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720" w:right="720" w:firstLine="0"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Epigraph"><w:name w:val="Epigraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="1440" w:right="1440" w:firstLine="0"/><w:jc w:val="left"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="160" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="left"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="SceneBreak"><w:name w:val="Scene Break"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:firstLine="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Bibliography"><w:name w:val="Bibliography"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720" w:hanging="720"/><w:jc w:val="left"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="left"/></w:pPr><w:rPr><w:sz w:val="${Math.max(16, size - 4)}"/><w:szCs w:val="${Math.max(16, size - 4)}"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="left"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="left"/></w:pPr></w:style>
${script ? `${scriptStylesXml(script === 'stageplay')}\n` : ''}${textStyles.length ? `${textStylesXml(textStyles, t)}\n` : ''}<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
</w:styles>`
}

const numberingXml = (lists: Writer['lists']): string => {
  const bullets = ['•', '◦', '▪']
  const formats = ['decimal', 'lowerLetter', 'lowerRoman']
  const level = (i: number, ordered: boolean) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${ordered ? formats[i % 3] : 'bullet'}"/><w:lvlText w:val="${ordered ? `%${i + 1}.` : bullets[i % 3]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`
  const abstract = (id: number, ordered: boolean) => `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${Array.from({ length: 9 }, (_, i) => level(i, ordered)).join('')}</w:abstractNum>`
  const nums = lists.map((list, i) => `<w:num w:numId="${i + 1}"><w:abstractNumId w:val="${list.abstract}"/>${list.abstract === 1 ? `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="${list.start}"/></w:lvlOverride>` : ''}</w:num>`)
  return `${XML_HEAD}<w:numbering ${NS}>${abstract(0, false)}${abstract(1, true)}${nums.join('')}</w:numbering>`
}

/** Word's footnotes part: its two separators, then each note. */
const footnotesXml = (notes: string[]): string => `${XML_HEAD}<w:footnotes ${NS}>${[
  '<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>',
  '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>',
  ...notes.map((text, i) => `<w:footnote w:id="${i + 1}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>${textContent(` ${text}`)}</w:p></w:footnote>`),
].join('')}</w:footnotes>`

const settingsXml = (setup: PageSetup, t: PrintTypography | undefined, updateFields: boolean, footnotes = false): string => `${XML_HEAD}<w:settings ${NS}>${[
  setup.mirrorMargins ? '<w:mirrorMargins/>' : '',
  footnotes ? '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>' : '',
  '<w:defaultTabStop w:val="720"/>',
  t?.hyphenate ? '<w:autoHyphenation/>' : '',
  setup.versoHeader || setup.versoFooter ? '<w:evenAndOddHeaders/>' : '',
  updateFields ? '<w:updateFields w:val="true"/>' : '',
  '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>',
].join('')}</w:settings>`

/* ---------------- the package ---------------- */

export const buildDocx = async (options: DocxOptions): Promise<Uint8Array> => {
  const setup = normalizePageSetup(options.setup)
  const type = setup.typography || undefined
  const w = new Writer(setup, type)
  const language = options.language || 'en-US'
  const chapters = options.chapters.map((c) => portableContent(c.content))
  const written = chapters.map((c) => c.attrs?.writingFormat).find((f) => f === 'screenplay' || f === 'stageplay')
  const scriptFormat = (written as 'screenplay' | 'stageplay' | undefined) || null

  // Fixed relationships first, so their ids are known.
  w.rel(`${REL}/styles`, 'styles.xml')
  w.rel(`${REL}/settings`, 'settings.xml')
  w.rel(`${REL}/numbering`, 'numbering.xml')
  await w.placeImages(chapters, options.resolveImage)

  const author = options.author || ''
  const ctx = {
    title: options.title,
    author,
    surname: surnameOf(author),
    words: options.words ? describeWordCount(options.words) : '',
    date: new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
  }
  const parts: Array<{ name: string; data: string }> = []
  const headerRef = (kind: 'hdr' | 'ftr', text: RunningText | null) => {
    const n = parts.filter((p) => p.name.startsWith(`word/${kind === 'hdr' ? 'header' : 'footer'}`)).length + 1
    const file = `${kind === 'hdr' ? 'header' : 'footer'}${n}.xml`
    parts.push({ name: `word/${file}`, data: headerPart(kind, text, w, ctx) })
    return w.rel(`${REL}/${kind === 'hdr' ? 'header' : 'footer'}`, file)
  }
  const heads = {
    header: headerRef('hdr', setup.header),
    footer: headerRef('ftr', setup.footer),
    evenHeader: setup.versoHeader || setup.versoFooter ? headerRef('hdr', setup.versoHeader || setup.header) : null,
    evenFooter: setup.versoHeader || setup.versoFooter ? headerRef('ftr', setup.versoFooter || setup.footer) : null,
    firstHeader: setup.differentFirstPage ? headerRef('hdr', null) : null,
    firstFooter: setup.differentFirstPage ? headerRef('ftr', null) : null,
  }

  const landscape = setup.orientation === PageOrientation.Landscape
  const pageW = twips(landscape ? setup.heightMm : setup.widthMm)
  const pageH = twips(landscape ? setup.widthMm : setup.heightMm)
  const m = setup.margins
  const fmt = { [PageNumberFormat.Arabic]: 'decimal', [PageNumberFormat.LowerRoman]: 'lowerRoman', [PageNumberFormat.UpperRoman]: 'upperRoman' }[setup.pageNumberFormat] || 'decimal'
  const sectPr = (section: Section): string => [
    '<w:sectPr>',
    section.heads ? [
      `<w:headerReference w:type="default" r:id="${heads.header}"/>`,
      heads.evenHeader ? `<w:headerReference w:type="even" r:id="${heads.evenHeader}"/>` : '',
      heads.firstHeader ? `<w:headerReference w:type="first" r:id="${heads.firstHeader}"/>` : '',
      `<w:footerReference w:type="default" r:id="${heads.footer}"/>`,
      heads.evenFooter ? `<w:footerReference w:type="even" r:id="${heads.evenFooter}"/>` : '',
      heads.firstFooter ? `<w:footerReference w:type="first" r:id="${heads.firstFooter}"/>` : '',
    ].join('') : '',
    `<w:type w:val="${section.start}"/>`,
    `<w:pgSz w:w="${pageW}" w:h="${pageH}"${landscape ? ' w:orient="landscape"' : ''}/>`,
    `<w:pgMar w:top="${twips(m.topMm)}" w:right="${twips(m.outsideMm)}" w:bottom="${twips(m.bottomMm)}" w:left="${twips(m.insideMm)}" w:header="${twips(setup.headerDistanceMm)}" w:footer="${twips(setup.footerDistanceMm)}" w:gutter="${twips(m.gutterMm)}"/>`,
    `<w:pgNumType w:fmt="${fmt}"${section.pageStart != null ? ` w:start="${section.pageStart}"` : ''}/>`,
    setup.columns > 1 ? `<w:cols w:num="${setup.columns}" w:space="${twips(setup.columnGapMm)}"/>` : '<w:cols w:space="720"/>',
    section.titlePg ? '<w:titlePg/>' : '',
    '</w:sectPr>',
  ].join('')

  const sections: Section[] = []
  const front = options.front || []
  if (front.length || options.contents) {
    sections.push({ body: frontXml(w, front, options), start: 'nextPage', heads: false, titlePg: false })
  }
  chapters.forEach((content, i) => sections.push(...w.chapterSections(content, i === 0)))
  if (!sections.length) sections.push({ body: '', start: 'nextPage', heads: true, titlePg: false })
  // The body is never empty: a section must hold at least a paragraph.
  const body = sections.map((section, i) => {
    const content = section.body || '<w:p/>'
    return i < sections.length - 1 ? `${content}<w:p><w:pPr>${sectPr(section)}</w:pPr></w:p>` : `${content}${sectPr(section)}`
  }).join('')

  const document = `${XML_HEAD}<w:document ${NS}><w:body>${body}</w:body></w:document>`
  const hasNotes = w.footnotes.length > 0
  if (hasNotes) w.rel(`${REL}/footnotes`, 'footnotes.xml')
  const contentTypes = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Default Extension="jpg" ContentType="image/jpeg"/>
<Default Extension="gif" ContentType="image/gif"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
${hasNotes ? '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' : ''}
${parts.map((p) => `<Override PartName="/${p.name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${p.name.includes('header') ? 'header' : 'footer'}+xml"/>`).join('\n')}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`
  const rootRels = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`
  const docRels = `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${w.rels.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${x(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('\n')}
</Relationships>`
  const stamp = (options.modified || new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const core = `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${x(options.title)}</dc:title>
${author ? `<dc:creator>${x(author)}</dc:creator>\n` : ''}<dc:language>${x(language)}</dc:language>
<dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified>
</cp:coreProperties>`

  return createZip([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: stylesXml(type, language, scriptFormat, options.textStyles || []) },
    { name: 'word/settings.xml', data: settingsXml(setup, type, Boolean(options.contents), hasNotes) },
    ...(hasNotes ? [{ name: 'word/footnotes.xml', data: footnotesXml(w.footnotes) }] : []),
    { name: 'word/numbering.xml', data: numberingXml(w.lists) },
    { name: 'word/_rels/document.xml.rels', data: docRels },
    { name: 'docProps/core.xml', data: core },
    ...parts,
    ...w.media.map((media) => ({ name: `word/media/${media.name}`, data: media.bytes, store: true })),
  ], options.modified)
}
