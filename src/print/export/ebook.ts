/**
 * ebook.ts — the e-book as the book designs it: its stylesheet, what it leaves out of
 * print, and what stands between it and the stores.
 *
 * A reading system chooses the page, the type size and — when the reader asks — the
 * font, so none of the page setup carries over. What does is the book's voice: its
 * face (when the reader lets the book choose), how paragraphs are indented, how a
 * chapter opens, what a scene break looks like. `ebookCss` is that, for the EPUB's
 * stylesheet and for the Digital preview, which shows the same file.
 *
 * Everything is in ems, so it scales with the reader's type size; the drop cap is a
 * float, since few reading systems know `initial-letter`.
 */
import { ChapterOpening, PrintAlignment, PreflightSeverity } from '../../types'
import type { DigitalOptions, PreflightIssue, PrintTypography } from '../../types'
import { DEFAULT_DIGITAL } from '../chapterDesign'
import { PROSE_CSS } from './html'
import type { PMJSON } from './portable'

/** A scene break every reader's font can set. */
export const PLAIN_SCENE_BREAK = '* * *'

const PT_PER_MM = 72 / 25.4

const cssString = (text: string): string => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** Round to two places, for CSS without float noise. */
const r2 = (n: number) => Math.round(n * 100) / 100

/** A chapter's head, as ChapterHead.js draws it, in ems. */
const HEAD_CSS = `
.chapter-head { display: block; margin: 0 0 3em; padding-top: 2em; text-align: center; text-indent: 0; -webkit-hyphens: manual; hyphens: manual; page-break-inside: avoid; break-inside: avoid; }
.chapter-head[data-align='left'] { text-align: left; }
.chapter-head[data-align='right'] { text-align: right; }
.chapter-head .ch-number { font-size: 1em; line-height: 1.3; margin: 0 0 0.6em; }
.chapter-head .ch-title { font-family: inherit; font-size: 1.6em; font-weight: normal; line-height: 1.2; margin: 0; padding: 0; text-align: inherit; }
.chapter-head[data-number-case='upper'] .ch-number { text-transform: uppercase; letter-spacing: 0.16em; }
.chapter-head[data-number-case='smallCaps'] .ch-number { font-variant: small-caps; letter-spacing: 0.1em; }
.chapter-head[data-number-case='italic'] .ch-number { font-style: italic; }
.chapter-head[data-title-case='upper'] .ch-title { text-transform: uppercase; letter-spacing: 0.12em; }
.chapter-head[data-title-case='smallCaps'] .ch-title { font-variant: small-caps; letter-spacing: 0.06em; }
.chapter-head[data-title-case='italic'] .ch-title { font-style: italic; }
.chapter-head .ch-subtitle { margin: 0.5em 0 0; font-style: italic; }
.chapter-head .ch-ornament.is-rule { width: 3em; height: 0; border-top: 1px solid currentColor; margin: 0.9em auto; }
.chapter-head[data-align='left'] .ch-ornament.is-rule { margin-left: 0; }
.chapter-head[data-align='right'] .ch-ornament.is-rule { margin-right: 0; }
.chapter-head .ch-ornament.is-glyph { font-size: 1.4em; line-height: 1.2; margin: 0.4em 0; }
.chapter-head .ch-ornament.is-image, .chapter-head .ch-image { margin: 0.8em auto; }
.chapter-head .ch-ornament.is-image { width: 25%; }
.chapter-head .ch-ornament img, .chapter-head .ch-image img { display: block; width: 100%; height: auto; }
.chapter-head .ch-epigraph { margin: 1.4em 2em 0; padding: 0; border: 0; font-size: 0.92em; font-style: italic; text-align: left; color: inherit; }
.chapter-head .ch-epigraph p { margin: 0; text-indent: 0; }
.chapter-head .ch-epigraph .ch-epigraph-source { margin-top: 0.4em; text-align: right; font-style: normal; }
.chapter-head .ch-title { page-break-after: avoid; break-after: avoid; }
`

/**
 * The e-book's stylesheet: the shared prose rules, the chapter head, and the book's
 * typography as far as a reflowable book can carry it.
 */
export const ebookCss = ({
  typography,
  digital = DEFAULT_DIGITAL,
}: {
  typography?: PrintTypography | null
  digital?: DigitalOptions
}): string => {
  const out = [PROSE_CSS, HEAD_CSS]
  const t = typography
  if (t) {
    const body: string[] = []
    if (digital.publisherFont && t.fontFamily) body.push(`font-family: ${t.fontFamily};`)
    if (t.alignment === PrintAlignment.Justify) body.push('text-align: justify;')
    if (t.hyphenate) body.push('-webkit-hyphens: auto; -epub-hyphens: auto; hyphens: auto;')
    if (body.length) out.push(`body { ${body.join(' ')} }`)
    // The indent as the print sets it, in ems of the print's size.
    const indentEm = t.fontSizePt > 0 ? r2((t.firstLineIndentMm * PT_PER_MM) / t.fontSizePt) : 0
    if (indentEm > 0) {
      out.push(`p { text-indent: ${indentEm}em; margin: 0; }`)
      out.push('li p, td p, th p, blockquote p, .front-matter p, figure p, p[style*="text-align: center"], p[style*="text-align:center"] { text-indent: 0; }')
    }
    if (t.noIndentAfterBreak) out.push('.chapter-head + p, h1 + p, h2 + p, h3 + p, hr + p { text-indent: 0; }')
    const glyph = digital.plainSceneBreaks ? PLAIN_SCENE_BREAK : t.sceneBreak
    if (glyph) {
      out.push('hr { border: 0; height: auto; margin: 1em 0; text-align: center; }')
      out.push(`hr::after { content: ${cssString(glyph)}; display: block; letter-spacing: 0.2em; }`)
    } else {
      out.push('hr { border: 0; height: 1.5em; margin: 0; }')
    }
    const opening = t.chapterOpening
    const dropCap = digital.dropCaps && (opening === ChapterOpening.DropCap || opening === ChapterOpening.DropCapAndSmallCaps)
    const smallCaps = opening === ChapterOpening.SmallCaps || opening === ChapterOpening.DropCapAndSmallCaps
    if (dropCap) {
      out.push('.chapter-head + p { text-indent: 0; }')
      out.push('.chapter-head + p::first-letter { float: left; font-size: 3.2em; line-height: 0.82; margin: 0.06em 0.08em 0 0; }')
    }
    if (smallCaps) out.push('.chapter-head + p::first-line { font-variant: small-caps; letter-spacing: 0.04em; }')
  }
  if (digital.invertOrnamentsInDark) {
    // The reading system's night theme, and the preview's.
    const inverted = '.chapter-head .ch-ornament.is-image img { filter: invert(1); }'
    out.push(`@media (prefers-color-scheme: dark) { ${inverted} }`)
    out.push(`:root.reader-dark ${inverted}`)
  }
  return out.join('\n')
}

/**
 * A compiled chapter as the e-book sets it: without the head's pictures, when the
 * e-book leaves them out.
 */
export const digitalContent = (doc: PMJSON, digital: DigitalOptions = DEFAULT_DIGITAL): PMJSON => {
  if (digital.headImages || !doc.content?.some((n) => n.type === 'chapterHead')) return doc
  return {
    ...doc,
    content: doc.content.map((node) => {
      if (node.type !== 'chapterHead') return node
      const head = { ...((node.attrs?.head || {}) as Record<string, unknown>) }
      delete head.image
      if (head.ornament === 'image') head.ornament = 'none'
      delete head.ornamentImage
      return { ...node, attrs: { ...node.attrs, head } }
    }),
  }
}

/** What is known of an image the e-book carries. */
export interface EbookImage {
  src: string
  bytes?: number
  width?: number
  height?: number
  alt?: string
}

/** The stores' limits: Kindle's 5 MB per image, and 4 million pixels. */
export const EBOOK_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const EBOOK_IMAGE_MAX_PIXELS = 4_000_000

/** Images a chapter shows, with their alt text: body images and the head's. */
export const ebookImagesOf = (doc: PMJSON): EbookImage[] => {
  const out: EbookImage[] = []
  const walk = (node: PMJSON) => {
    if (node.type === 'image' && typeof node.attrs?.src === 'string') {
      out.push({ src: node.attrs.src as string, alt: typeof node.attrs.alt === 'string' ? node.attrs.alt : '' })
    }
    if (node.type === 'chapterHead') {
      const head = (node.attrs?.head || {}) as Record<string, unknown>
      // The head's pictures are decoration: a reader skips them, and so do these checks.
      if (typeof head.image === 'string' && head.image) out.push({ src: head.image, alt: 'decorative' })
    }
    for (const child of node.content || []) walk(child)
  }
  walk(doc)
  return out
}

/**
 * What would hold the e-book back at a store, or read badly: images without alt text,
 * or too big for Kindle; nothing for a contents to list; a cover not an e-book's shape.
 */
export const ebookChecks = ({
  images,
  chapters,
  cover,
}: {
  images: EbookImage[]
  chapters: number
  cover?: { width: number; height: number } | null
}): PreflightIssue[] => {
  const issues: PreflightIssue[] = []
  const add = (id: string, message: string, severity = PreflightSeverity.Warning) => issues.push({ id, severity, message })
  const seen = new Set<string>()
  const unique = images.filter((img) => (seen.has(img.src) ? false : (seen.add(img.src), true)))
  const noAlt = unique.filter((img) => !img.alt?.trim())
  if (noAlt.length) {
    add('ebook-alt', `${noAlt.length === 1 ? 'An image has' : `${noAlt.length} images have`} no description (alt text). Readers who listen to the book hear nothing there, and some stores ask for it.`)
  }
  const heavy = unique.filter((img) => (img.bytes || 0) > EBOOK_IMAGE_MAX_BYTES)
  if (heavy.length) {
    add('ebook-image-bytes', `${heavy.length === 1 ? 'An image is' : `${heavy.length} images are`} over 5 MB, Kindle's limit for one image. Save ${heavy.length === 1 ? 'it' : 'them'} smaller.`, PreflightSeverity.Error)
  }
  const large = unique.filter((img) => (img.width || 0) * (img.height || 0) > EBOOK_IMAGE_MAX_PIXELS)
  if (large.length) {
    add('ebook-image-pixels', `${large.length === 1 ? 'An image is' : `${large.length} images are`} over 4 million pixels; stores shrink ${large.length === 1 ? 'it' : 'them'}, and the book is bigger to download for nothing.`, PreflightSeverity.Note)
  }
  if (!chapters) add('ebook-empty', 'The e-book has no chapters: its contents would be empty.', PreflightSeverity.Error)
  if (!cover) {
    add('ebook-cover', 'The e-book has no cover. Add a front under Cover.', PreflightSeverity.Note)
  } else if (Math.abs(cover.height / cover.width - 1.6) > 0.08) {
    add('ebook-cover-shape', `The cover is ${cover.width} × ${cover.height}; e-book stores show covers 1.6 times as tall as they are wide (2560 × 1600).`, PreflightSeverity.Note)
  }
  return issues
}
