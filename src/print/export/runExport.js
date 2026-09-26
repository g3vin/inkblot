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
import { chapterTitleOf, compileBook, frontMatterSections, paragraphsOf } from '../bookMatter'
import { loadChapters } from '../compile'
import { readDocPageSetup } from '../DocPageSetup'
import { resolvePageSetup } from '../pageSetup'
import { bookAuthor, getAuthorProfile, setLastExport } from '../printLayoutStore'
import { textOfContent } from '../titlePage'
import { countWords } from '../../lib/wordCount'
import { runPrintJob } from '../printJob'
import { describeError, newJobId, reportJob } from '../printJobStatus'
import { buildDocx } from './docx'
import { buildFdx } from './fdx'
import { buildEpub } from './epub'
import { buildHtmlDocument } from './html'
import { decodeDataUri, resolveImage, toDataUri } from './images'
import { toMarkdown } from './markdown'
import { buildPlainText } from './text'
import { serializeFountain } from '../../script/fountain'
import { mapImageSources, portableContent } from './portable'

const FORMATS = {
  pdf: { ext: 'pdf', label: 'PDF' },
  epub: { ext: 'epub', label: 'EPUB' },
  markdown: { ext: 'md', label: 'Markdown' },
  html: { ext: 'html', label: 'HTML' },
  docx: { ext: 'docx', label: 'Word' },
  plainText: { ext: 'txt', label: 'Plain Text' },
  fountain: { ext: 'fountain', label: 'Fountain' },
  fdx: { ext: 'fdx', label: 'Final Draft' },
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
      defaultPath: `${safeFileName(title)}.${spec.ext}`,
      filters: [{ name: spec.label, extensions: [spec.ext] }],
    })
  } catch (error) {
    reportJob({ jobId, kind: 'export', format, phase: 'failed', message: describeError(error) })
    throw error
  }
  if (!path) return null

  const remember = () => setLastExport(projectName, { format, scope, path, bound: Boolean(bound), options })
  if (format === 'pdf') {
    const saved = await runPrintJob({ jobId, projectName, docPath, scope, bound, liveEditors, book, options, pdfPath: path })
    if (saved) remember()
    return saved ? path : null
  }

  const report = (phase, extra = {}) => reportJob({ jobId, kind: 'export', format, phase, ...extra })
  report('preparing')
  try {
    await writeExport({ format, path, projectName, docPath, scope, liveByPath, compiled, title, book })
  } catch (error) {
    report('failed', { message: describeError(error) })
    throw error
  }
  report('done', { path })
  remember()
  return path
}

/** Build a non-PDF export and write it to `path`. */
async function writeExport({ format, path, projectName, docPath, scope, liveByPath, compiled, title, book }) {
  const author = bookAuthor(book)
  const chapters = await withPrintBibliography(
    projectName,
    await loadChapters(projectName, docPath, scope, (p) => liveByPath.get(p)?.getJSON() || null, { excluded: compiled ? book?.excluded : [] })
  )
  const { setup } = resolvePageSetup({
    docSetup: (compiled ? null : readDocPageSetup(liveByPath.get(docPath)?.state.doc)) || chapters[0]?.content?.attrs?.pageSetup,
    bookSetup: book?.pageSetup,
    scope,
  })
  // A book's chapters are headed — numbered, or by their names — and followed by its
  // back matter; a document exports as it is.
  const exportChapters = (compiled ? compileBook(chapters, book, { author, insertTitles: true }) : chapters)
    .map((chapter) => ({ title: chapterTitleOf(chapter.content, chapter.name), content: chapter.content }))
  const front = compiled ? frontMatterSections(book, { title, author, titlePage: Boolean(setup.titlePage) }) : []
  const contents = compiled && Boolean(book?.frontMatter?.contents)

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
    const bytes = await buildEpub({
      title,
      author,
      language: book?.language || 'en',
      chapters: exportChapters,
      resolveImage: (src) => resolveImage(projectName, src),
      cover,
      front,
      contents,
    })
    await writeFile(path, bytes)
    return path
  }
  return null
}
