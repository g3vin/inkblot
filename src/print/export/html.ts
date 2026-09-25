/**
 * html.ts — a document or a book as one self-contained HTML file.
 *
 * Self-contained means it opens anywhere, forever: styles inline, images inline as
 * data URIs, no script. It also prints like the document: `@page` carries the
 * page size and margins, and page breaks, chapter openings and columns become the
 * print CSS for them — so printing the file from any browser gives close to what
 * Print Layout shows (a browser's own pagination, not Inkblot's).
 */
import { generateHTML } from '@tiptap/core'

import { getDocPreviewExtensions } from '../../lib/editorExtensions'
import { normalizePageSetup } from '../pageSetup'
import type { PageSetup } from '../pageSetup'
import { PageOrientation } from '../../types'
import { leadingPt } from '../typography'
import { portableContent } from './portable'
import type { PMJSON } from './portable'

export interface ExportChapter {
  title: string
  content: PMJSON
}

export const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

/** A chapter's body HTML: portable nodes, rendered with the document's own schema. */
export const chapterBodyHtml = (content: PMJSON): string => {
  const html = generateHTML(portableContent(content) as Parameters<typeof generateHTML>[0], getDocPreviewExtensions())
  // A page break is an editing affordance (contenteditable, a label); in a file it is
  // only the break.
  return html.replace(/<div([^>]*?)data-page-break="([a-z]+)"[^>]*><\/div>/g, '<div class="page-break page-break-$2"></div>')
}

/** Typography shared by the HTML export and the EPUB stylesheet. */
export const PROSE_CSS = `
body { font-family: Georgia, 'Times New Roman', serif; font-size: 18px; line-height: 1.6; color: #1b1b1b; }
h1, h2, h3, h4, h5, h6 { line-height: 1.2; font-weight: 700; }
h1 { font-size: 2em; margin: 0.67em 0; }
h2 { font-size: 1.5em; margin: 0.83em 0; }
h3 { font-size: 1.17em; margin: 1em 0; }
p { margin: 0 0 1em; }
blockquote { margin: 1em 0; padding-left: 1em; border-left: 3px solid #ccc; color: #444; }
pre { font-family: Menlo, monospace; font-size: 0.85em; white-space: pre-wrap; background: #f5f5f5; padding: 0.75em; }
code { font-family: Menlo, monospace; font-size: 0.9em; }
img { max-width: 100%; height: auto; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
th, td { border: 1px solid #bbb; padding: 6px 8px; vertical-align: top; }
th { background: #f0f0f0; }
th p, td p { margin: 0; }
mark { background: #fff59d; }
hr { border: 0; border-top: 1px solid #ccc; margin: 2em 0; }
.page-break { break-after: page; page-break-after: always; height: 0; }
.page-break-recto { break-after: right; page-break-after: right; }
.sc { font-variant: small-caps; }
.bibliography { margin-top: 2.5em; }
.bibliography-title { text-align: center; font-size: 1.25em; }
.bibliography-notes { padding-left: 2em; }
.bibliography-entries.is-hanging .bibliography-entry { padding-left: 2em; text-indent: -2em; }
.bibliography-annotation { margin: -0.4em 0 1em 2em; font-size: 0.95em; }
.bibliography-empty { display: none; }
`

export const buildHtmlDocument = ({
  title,
  author = '',
  language = 'en',
  chapters,
  setup: setupInput,
}: {
  title: string
  author?: string
  language?: string
  chapters: ExportChapter[]
  setup?: PageSetup | null
}): string => {
  const setup = normalizePageSetup(setupInput)
  // Millimetres to three places: enough for any printer, and no float noise in the CSS.
  const mm = (value: number) => `${Math.round(value * 1000) / 1000}mm`
  const landscape = setup.orientation === PageOrientation.Landscape
  const w = landscape ? setup.heightMm : setup.widthMm
  const h = landscape ? setup.widthMm : setup.heightMm
  const m = setup.margins
  const recto = setup.chapterStartsOnRecto
  const inside = m.insideMm + m.gutterMm
  const pageCss = `
@page { size: ${mm(w)} ${mm(h)}; margin: ${mm(m.topMm)} ${mm(m.outsideMm)} ${mm(m.bottomMm)} ${mm(inside)}; }
${setup.mirrorMargins ? `@page :left { margin-left: ${mm(m.outsideMm)}; margin-right: ${mm(inside)}; }\n@page :right { margin-left: ${mm(inside)}; margin-right: ${mm(m.outsideMm)}; }` : ''}
@media screen {
  body { background: #eee; margin: 0; }
  main { background: #fff; max-width: ${mm(w - inside - m.outsideMm)}; margin: 2em auto; padding: ${mm(m.topMm)} ${mm(m.outsideMm)} ${mm(m.bottomMm)} ${mm(inside)}; box-shadow: 0 2px 12px rgba(0,0,0,.15); }
}
@media print {
  main { ${setup.columns > 1 ? `columns: ${setup.columns}; column-gap: ${mm(setup.columnGapMm)};` : ''} }
  .chapter + .chapter { break-before: ${recto ? 'right' : 'page'}; }
  h1, h2, h3 { break-after: avoid; }
  p { orphans: ${setup.widowOrphanLines}; widows: ${setup.widowOrphanLines}; }
}`
  const t = setup.typography
  const typeCss = t ? `
main { font-family: ${t.fontFamily}; font-size: ${t.fontSizePt}pt; line-height: ${Math.round(leadingPt(t) * 100) / 100}pt; text-align: ${t.alignment === 'justify' ? 'justify' : 'left'}; hyphens: ${t.hyphenate ? 'auto' : 'manual'}; }
main p { margin: 0 0 ${t.paragraphSpacingPt}pt; text-indent: ${t.firstLineIndentMm}mm; }
main :is(li, td, th, blockquote) p { text-indent: 0; }
${t.noIndentAfterBreak ? 'main :is(h1, h2, h3, hr) + p, .chapter > p:first-child { text-indent: 0; }' : ''}
main hr { border: 0; text-align: center; }
main hr::after { content: ${JSON.stringify(t.sceneBreak)}; letter-spacing: 0.2em; }
.chapter > h1:first-child { padding-top: ${t.chapterSinkMm}mm; text-align: center; }` : ''
  const body = chapters.map((chapter, i) => (
    `<section class="chapter" id="chapter-${i + 1}" aria-label="${escapeHtml(chapter.title)}">\n${chapterBodyHtml(chapter.content)}\n</section>`
  )).join('\n')
  return `<!doctype html>
<html lang="${escapeHtml(language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${author ? `<meta name="author" content="${escapeHtml(author)}">\n` : ''}<meta name="generator" content="Inkblot">
<style>${PROSE_CSS}${pageCss}${typeCss}
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`
}
