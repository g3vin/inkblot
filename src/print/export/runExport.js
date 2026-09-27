/**
 * runExport.js — File ▸ Export: PDF, EPUB, Word, Markdown, HTML, plain text, Fountain and Final Draft, for a document or a
 * book (a folder or the project, compiled in tree order).
 *
 * Asks where to save with the system save panel, then writes the file through the
 * fs plugin — which both shells provide, so this runs unchanged under Tauri and the
 * Swift shell. PDF is not built here: it is the print path saving instead of
 * printing, so a PDF is exactly the pages Print would have produced.
 */
import { save } from '@tauri-apps/plugin-dialog'
import { mkdir, writeFile, writeTextFile } from '@tauri-apps/plugin-fs'

import { withPrintBibliography } from '../../lib/references/printBibliography'
import { chapterTitleOf, compileSections, frontMatterSections, paragraphsOf } from '../bookMatter'
import { bookFolderFor, loadBookSections, loadChapters } from '../compile'
import { readDocPageSetup } from '../DocPageSetup'
import { resolvePageSetup } from '../pageSetup'
import { bookAuthor, getAuthorProfile, getMeasurement, getPrintScope, setLastExport, setMeasurement } from '../printLayoutStore'
import { activeCoverOf, digitalOf } from '../chapterDesign'
import { coverPage } from '../coverWrap'
import { bookWrap } from '../coverState'
import { mmToPx } from '../pageSizes'
import { textOfContent } from '../titlePage'
import { countWords } from '../../lib/wordCount'
import { measurePrint, printPages, runPrintJob } from '../printJob'
import { describeError, newJobId, reportJob } from '../printJobStatus'
import { buildDocx } from './docx'
import { buildFdx } from './fdx'
import { buildEpub } from './epub'
import { buildHtmlDocument } from './html'
import { decodeDataUri, resolveImage, toDataUri } from './images'
import { toMarkdown } from './markdown'
import { buildPlainText } from './text'
import { serializeFountain } from '../../script/fountain'
import { headsToBlocks, mapImageSources, portableContent } from './portable'
import { digitalContent, ebookCss } from './ebook'
import { primaryFamily } from '../typography'
import { loadProjectFonts, projectFontFiles } from '../projectFonts'

const FORMATS = {
  pdf: { ext: 'pdf', label: 'PDF' },
  epub: { ext: 'epub', label: 'EPUB' },
  markdown: { ext: 'md', label: 'Markdown' },
  html: { ext: 'html', label: 'HTML' },
  docx: { ext: 'docx', label: 'Word' },
  plainText: { ext: 'txt', label: 'Plain Text' },
  fountain: { ext: 'fountain', label: 'Fountain' },
  fdx: { ext: 'fdx', label: 'Final Draft' },
  coverPdf: { ext: 'pdf', label: 'Cover PDF' },
}

const safeFileName = (name) => (name || 'Untitled').replace(/[/\\:*?"<>|]+/g, '-').trim() || 'Untitled'

const dirOf = (path) => path.replace(/[/\\][^/\\]*$/, '')
const stemOf = (path) => path.replace(/^.*[/\\]/, '').replace(/\.[^.]+$/, '')

/**
 * Export, reporting where it has got to (`printJobStatus.js`). Resolves with the path
 * written, or null when the author cancelled the save panel; rejects, after reporting
 * the failure, when the file could not be made.
 */
export async function runExport({
  format,
  scope = 'document',
  bound = false,
  projectName,
  docPath,
  liveEditors = [],
  book,
  options = {},
  path: knownPath = null,
}) {
  const spec = FORMATS[format]
  if (!spec || !projectName || !docPath) return null

  const liveByPath = new Map(liveEditors.filter((e) => e?.path && e.editor && !e.editor.isDestroyed).map((e) => [e.path, e.editor]))
  const compiled = scope !== 'document'
  const title = compiled ? (book?.title || 'Book') : (docPath.split('/').pop() || 'Untitled')

  const jobId = newJobId()
  // Export Again writes where the last one did, without asking.
  let path = knownPath
  try {
    if (!path) path = await save({
      title: `Export ${spec.label}`,
      // The cover beside the interior, not over it.
      defaultPath: `${safeFileName(format === 'coverPdf' ? `${title} Cover` : title)}.${spec.ext}`,
      filters: [{ name: spec.label, extensions: [spec.ext] }],
    })
  } catch (error) {
    reportJob({ jobId, kind: 'export', format, phase: 'failed', message: describeError(error) })
    throw error
  }
  if (!path) return null

  const remember = () => setLastExport(projectName, { format, scope, path, bound: Boolean(bound), options })
  if (format === 'coverPdf') {
    const saved = await exportCoverPdf({ jobId, projectName, docPath, book, liveEditors, path })
    if (saved) remember()
    return saved ? path : null
  }
  if (format === 'pdf') {
    const saved = await runPrintJob({ jobId, projectName, docPath, scope, bound, liveEditors, book, options, pdfPath: path })
    if (saved) remember()
    return saved ? path : null
  }

  const report = (phase, extra = {}) => reportJob({ jobId, kind: 'export', format, phase, ...extra })
  report('preparing')
  await loadProjectFonts(projectName)
  try {
    await writeExport({ format, path, projectName, docPath, scope, liveByPath, title, book })
  } catch (error) {
    report('failed', { message: describeError(error) })
    throw error
  }
  report('done', { path })
  remember()
  return path
}

/**
 * The book's cover as one full-wrap PDF, at the size the printer takes it: the book's
 * pages counted first, when they have not been, so the spine is right.
 */
async function exportCoverPdf({ jobId, projectName, docPath, book, liveEditors, path }) {
  const scope = getPrintScope(projectName) === 'project' ? 'project' : 'folder'
  if (!getMeasurement(projectName, scope, docPath)) {
    const measured = await measurePrint({ projectName, docPath, scope, liveEditors, book })
    if (measured) setMeasurement(projectName, scope, docPath, measured)
  }
  const setup = resolvePageSetup({ docSetup: readDocPageSetup(liveEditors.find((e) => e.path === docPath)?.editor?.state.doc), bookSetup: book?.pageSetup, scope }).setup
  const { geometry } = bookWrap(projectName, docPath, book, book?.pageSetup || setup)
  const set = activeCoverOf(book)
  if (!set) throw new Error('The book has no cover yet.')
  const urls = {}
  for (const part of ['front', 'back', 'spine', 'wrap']) {
    const src = set[part]
    if (!src) continue
    const image = await resolveImage(projectName, src)
    if (image) urls[part] = toDataUri(image)
  }
  const page = coverPage(geometry, set, urls)
  return printPages({
    jobId,
    elements: [page],
    widthPx: mmToPx(geometry.wrapWidthMm),
    heightPx: mmToPx(geometry.wrapHeightMm),
    jobName: `${book?.title || 'Book'} — Cover`,
    pdfPath: path,
    format: 'coverPdf',
  })
}

/**
 * What an export sets, compiled: a book's pages in order — its own front matter pages,
 * parts, chapters headed as it numbers them, back matter — each titled for the
 * contents; a document as it is. HTML and EPUB draw a chapter's head as it is designed;
 * the other formats set it as a heading and the blocks under it. An e-book leaves out
 * what the book's digital options say, and comes with its stylesheet — which is what
 * the Digital preview shows, from this same call.
 */
export async function compileExport({ format, projectName, docPath, scope, live, book, title }) {
  const compiled = scope !== 'document'
  const author = bookAuthor(book)
  let chapters
  let sections = null
  if (compiled) {
    const raw = await loadBookSections(projectName, bookFolderFor(docPath, scope), book, live)
    const noted = await withPrintBibliography(
      projectName,
      raw.filter((s) => s.item.kind === 'chapter' && s.content).map((s) => ({ path: s.path, name: s.name, content: s.content }))
    )
    const byPath = new Map(noted.map((c) => [c.path, c]))
    sections = compileSections(
      raw.map((s) => (s.item.kind === 'chapter' && byPath.has(s.path) ? { ...s, content: byPath.get(s.path).content } : s)),
      book,
      { author, insertTitles: true }
    )
    chapters = sections.filter((s) => s.item.kind === 'chapter' && s.content)
  } else {
    chapters = await withPrintBibliography(projectName, await loadChapters(projectName, docPath, 'document', live))
  }
  const { setup } = resolvePageSetup({
    docSetup: (compiled ? null : readDocPageSetup(live(docPath))) || chapters[0]?.content?.attrs?.pageSetup,
    bookSetup: book?.pageSetup,
    scope,
  })
  const drawsHeads = format === 'html' || format === 'epub'
  const digital = digitalOf(book)
  const exportChapters = (sections ? sections.filter((s) => s.content) : chapters)
    .map((chapter) => {
      const content = drawsHeads ? chapter.content : headsToBlocks(chapter.content)
      return {
        title: chapterTitleOf(chapter.content, chapter.name),
        content: format === 'epub' ? digitalContent(content, digital) : content,
        inContents: chapter.role !== 'front',
        // Which of the book's entries it is, so a preview can find it.
        item: chapter.item?.id,
      }
    })
  // The pages an export sets from the book itself: the half title and the title page.
  const generated = new Set((sections || []).filter((s) => s.role === 'front').map((s) => s.item.generated).filter(Boolean))
  const front = compiled
    ? frontMatterSections(
      { frontMatter: { halfTitle: generated.has('halfTitle') } },
      { title, author, titlePage: generated.has('titlePage') || Boolean(setup.titlePage) }
    )
    : []
  const contents = compiled && (sections || []).some((s) => s.item.generated === 'contents')
  const css = format === 'epub' ? ebookCss({ typography: setup.typography, digital }) : null
  return { compiled, author, chapters, exportChapters, front, contents, setup, css }
}

/** Build a non-PDF export and write it to `path`. */
async function writeExport({ format, path, projectName, docPath, scope, liveByPath, title, book }) {
  const live = (p) => liveByPath.get(p)?.getJSON() || null
  const { compiled, author, chapters, exportChapters, front, contents, setup, css } = await compileExport({
    format, projectName, docPath, scope, live, book, title,
  })

  if (format === 'html') {
    // Inline every image, so the file stands alone.
    const inlined = []
    for (const chapter of exportChapters) {
      const srcs = new Map()
      const walk = (node) => {
        if (node.type === 'image' && node.attrs?.src) srcs.set(node.attrs.src, null)
        for (const child of node.content || []) walk(child)
      }
      walk(chapter.content)
      for (const src of srcs.keys()) {
        if (src.startsWith('data:')) continue
        const image = await resolveImage(projectName, src)
        if (image) srcs.set(src, toDataUri(image))
      }
      inlined.push({ ...chapter, content: mapImageSources(chapter.content, (src) => srcs.get(src) || src) })
    }
    const html = buildHtmlDocument({
      title,
      author,
      language: book?.language || 'en',
      chapters: inlined,
      setup,
      front,
      contents,
    })
    await writeTextFile(path, html)
    return path
  }

  if (format === 'markdown') {
    // Embedded images become files in a folder beside the Markdown.
    const assetsDir = `${stemOf(path)}_assets`
    const written = new Map()
    let count = 0
    const pending = []
    const imageSrc = (src) => {
      if (written.has(src)) return written.get(src)
      const decoded = src.startsWith('data:') ? decodeDataUri(src) : null
      if (!decoded && !src.startsWith('.assets/')) {
        written.set(src, src)
        return src
      }
      count += 1
      const name = `image-${count}.${decoded?.ext || src.split('.').pop() || 'png'}`
      const rel = `${assetsDir}/${name}`
      written.set(src, rel)
      pending.push({ src, decoded, rel })
      return rel
    }
    // The front matter as plain paragraphs: Markdown has no pages to set it on.
    const frontDocs = front
      .filter((section) => section.text)
      .map((section) => ({ type: 'doc', content: paragraphsOf(section.source ? `${section.text}\n\n— ${section.source}` : section.text) }))
    const md = [...frontDocs, ...exportChapters.map((chapter) => chapter.content)]
      .map((content) => toMarkdown(portableContent(content), { imageSrc }))
      .join('\n<div style="break-after: page"></div>\n\n')
    if (pending.length) await mkdir(`${dirOf(path)}/${assetsDir}`, { recursive: true })
    for (const item of pending) {
      const image = item.decoded || await resolveImage(projectName, item.src)
      if (image) await writeFile(`${dirOf(path)}/${item.rel}`, image.bytes)
    }
    await writeTextFile(path, md)
    return path
  }

  if (format === 'docx') {
    // A document alone still gets its title page; a book's is among its front matter.
    const sections = compiled ? front : (setup.titlePage ? [{ kind: 'titlePage', title, author }] : [])
    const words = setup.titlePage?.showWordCount
      ? chapters.reduce((n, c) => n + countWords(textOfContent(c.content)), 0)
      : 0
    const bytes = await buildDocx({
      title,
      author,
      language: book?.language || 'en-US',
      chapters: exportChapters,
      setup,
      front: sections,
      contents,
      profile: getAuthorProfile(),
      words,
      resolveImage: (src) => resolveImage(projectName, src),
    })
    await writeFile(path, bytes)
    return path
  }

  if (format === 'plainText') {
    const frontDocs = front
      .filter((section) => section.text || section.kind === 'titlePage')
      .map((section) => ({
        type: 'doc',
        content: section.kind === 'titlePage'
          ? paragraphsOf([title, author && `by ${author}`].filter(Boolean).join('\n'))
          : paragraphsOf(section.source ? `${section.text}\n\n— ${section.source}` : section.text),
      }))
    const text = buildPlainText(
      [...frontDocs, ...exportChapters.map((chapter) => chapter.content)],
      { wrap: 0, sceneBreak: setup.typography?.sceneBreak || '* * *' }
    )
    await writeTextFile(path, text)
    return path
  }

  if (format === 'fountain' || format === 'fdx') {
    // A script, or a book of them, as one: the chapters' lines one after another.
    const [first] = exportChapters
    const doc = {
      type: 'doc',
      attrs: first?.content?.attrs || {},
      content: exportChapters.flatMap((chapter, i) => [
        ...(i > 0 ? [{ type: 'pageBreak' }] : []),
        ...(chapter.content?.content || []),
      ]),
    }
    const profile = getAuthorProfile()
    const titlePage = {
      title,
      credit: author ? 'Written by' : '',
      author,
      contact: profile.agent || [profile.legalName, profile.address, profile.email, profile.phone].filter(Boolean).join('\n'),
    }
    const text = format === 'fountain' ? serializeFountain(doc, { titlePage }) : buildFdx(doc, { titlePage })
    await writeTextFile(path, text)
    return path
  }

  if (format === 'epub') {
    let cover = null
    if (book?.coverImage) cover = await resolveImage(projectName, book.coverImage)
    // The book's face, when it is one of the project's own and the reader is let see it:
    // embedded, where its licence allows.
    const digital = digitalOf(book)
    const family = setup.typography ? primaryFamily(setup.typography.fontFamily) : null
    const fonts = family && digital.publisherFont
      ? (await projectFontFiles(projectName, family)).filter((f) => f.embeddable)
      : []
    const bytes = await buildEpub({
      title,
      author,
      language: book?.language || 'en',
      chapters: exportChapters,
      resolveImage: (src) => resolveImage(projectName, src),
      cover,
      front,
      contents,
      css,
      fonts,
    })
    await writeFile(path, bytes)
    return path
  }
  return null
}
