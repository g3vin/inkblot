/**
 * printJob.js — Print…, Export PDF, and printing for binding.
 *
 * 1. Gather the chapters (compile.js): the active document, or a folder or the
 *    whole project as a book.
 * 2. Lay each out as pages. The document open in Print Layout already is, so its
 *    live editor is used as it stands — which is what makes the print exactly what
 *    was on screen. Anything else is laid out off screen in a hidden editor with the
 *    same extensions, CSS and width, then paginated synchronously.
 * 3. Cut the pages out (printRender.js) and, for binding, impose them onto sheets.
 * 4. Put them in #print-root, which is all the print stylesheet shows, and ask the
 *    shell to print the web view on paper of exactly that size, with no margins.
 *
 * The Swift shell prints on a `printRequest` event and reports back with a
 * `printFinished` command. The Tauri shell prints through `print_webview`.
 */
import { invoke } from '@tauri-apps/api/core'
import { Editor } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'

import { documentSurface } from '../bridge'
import { isNativeShell } from '../lib/host'
import { buildEditorExtensions } from '../lib/editorExtensions'
import { withPrintBibliography } from '../lib/references/printBibliography'
import { assetUrl, isAssetPath } from '../lib/assets'
import { mapImageSources } from './export/portable'
import { chapterTitleOf, compileSections } from './bookMatter'
import { pageOptionsOf } from './bookItems'
import { bookFolderFor, loadBookSections, loadChapters } from './compile'
import { readDocPageSetup } from './DocPageSetup'
import { describeError, newJobId, reportJob } from './printJobStatus'
import { contentsPages, halfTitlePage } from './frontMatter'
import { foldingGuide, printSequence } from './imposition'
import { paginationKey, settlePagination } from './PaginationExtension'
import { pageMetrics, resolvePageSetup, setupUsesToken, surnameOf } from './pageSetup'
import { pxToPt } from './pageSizes'
import { PAGE_GAP } from './printLayoutConstants'
import { imposeSheets, renderPages, snapshotBlocks } from './printRender'
import { bookAuthor, getAuthorProfile } from './printLayoutStore'
import { buildTitlePages, textOfContent } from './titlePage'
import { applyTypography, baselineGridPx, loadTypographyFont, typographyKey } from './typography'
import { applyTextStyleSheet, textStylesOf } from './textStyles'
import { notesOptionsOf, pageNotesOf, setBookNotes, setDocumentNotes } from './notes'
import { countWords } from '../lib/wordCount'
import { characterName } from '../script/elements'
import { breakdown, REPORT_TITLES, reportDocument } from '../script/reports'

const PRINT_ROOT_ID = 'print-root'
const PAGE_STYLE_ID = 'print-page-style'

/**
 * The text of a heading, with a line break read as a colon: a numbered chapter's
 * "Chapter One" over "The Storm" is "Chapter One: The Storm" in a running head.
 */
const headingText = (node) => node.textBetween(0, node.content.size, '', (leaf) => (leaf.type.name === 'hardBreak' ? ': ' : '')).trim()

/** Top-level H1s of a document, as { pos, text }: what a chapter's running head shows. */
export const chapterHeadings = (doc) => {
  const out = []
  doc.forEach((node, pos) => {
    // A compiled chapter's head: its title, as a running head wants it.
    if (node.type.name === 'chapterHead') {
      const text = node.attrs.head?.title || node.attrs.head?.label || ''
      if (text) out.push({ pos, text })
      return
    }
    if (node.type.name !== 'heading' || node.attrs.level !== 1) return
    const text = headingText(node)
    if (text) out.push({ pos, text })
  })
  return out
}

const chapterTitleAt = (headings, fallback) => (pos) => {
  let text = fallback
  for (const h of headings) {
    if (h.pos > pos) break
    text = h.text
  }
  return text
}

const waitForImages = async (root) => {
  const images = Array.from(root.querySelectorAll('img'))
  await Promise.all(images.map((img) => (img.complete ? null : img.decode?.().catch(() => {}))))
  if (document.fonts?.ready) await document.fonts.ready
}

/**
 * Lay a document out off screen as paginated pages. The caller destroys it once
 * the pages are cut: the clones do not need it.
 */
const layoutOffscreen = async (content, setup, { footnotes = true } = {}) => {
  const m = pageMetrics(setup)
  const host = document.createElement('div')
  host.className = 'print-layout print-offscreen'
  host.setAttribute('aria-hidden', 'true')
  const stage = document.createElement('div')
  stage.className = 'pl-stage'
  applyTypography(stage, setup.typography)
  stage.style.setProperty('--pl-flow-w', `${setup.columns > 1 ? m.columnWidth : m.contentWidth}px`)
  stage.style.setProperty('--pl-content-top', `${m.contentTop}px`)
  stage.style.setProperty('--pl-content-h', `${m.contentHeight}px`)
  const flow = document.createElement('div')
  flow.className = 'pl-flow'
  const mount = document.createElement('div')
  mount.className = 'editor'
  flow.appendChild(mount)
  stage.appendChild(flow)
  host.appendChild(stage)
  document.body.appendChild(host)

  const editor = new Editor({
    element: mount,
    editable: false,
    extensions: buildEditorExtensions(StarterKit.configure({
      bulletList: { keepMarks: true },
      orderedList: { keepMarks: true },
    })),
    content,
  })
  const stride = m.height + PAGE_GAP
  await loadTypographyFont(setup.typography)
  editor.commands.setPaginationFrame({
    slotHeight: m.contentHeight,
    stride,
    columns: setup.columns,
    minLines: setup.widowOrphanLines,
    grid: baselineGridPx(setup.typography),
    footnotes,
    typeKey: typographyKey(setup.typography),
  })
  await waitForImages(mount)
  const result = settlePagination(editor.view)
  return {
    snapshot: snapshotBlocks(editor.view.dom),
    result,
    stride,
    headings: chapterHeadings(editor.state.doc),
    notes: footnotes ? pageNotesOf(editor.state.doc) : [],
    destroy: () => {
      editor.destroy()
      host.remove()
    },
  }
}

/** The live editor as a source, when it is already showing pages in this setup. */
const liveSource = (editor, setup, { footnotes = true } = {}) => {
  if (!editor || editor.isDestroyed) return null
  const state = paginationKey.getState(editor.state)
  if (!state?.frame || !state.result) return null
  // Laid out with room for notes it is not to have, or without room it needs.
  if (Boolean(state.frame.footnotes ?? true) !== footnotes) return null
  const m = pageMetrics(setup)
  if (Math.abs(state.frame.slotHeight - m.contentHeight) > 0.5) return null
  // Set in other type, its lines break elsewhere: lay it out afresh.
  if ((state.frame.typeKey || '') !== typographyKey(setup.typography)) return null
  return {
    snapshot: snapshotBlocks(editor.view.dom),
    result: state.result,
    stride: state.frame.stride,
    headings: chapterHeadings(editor.state.doc),
    notes: footnotes ? pageNotesOf(editor.state.doc) : [],
    destroy: () => {},
  }
}

/**
 * Jobs run one at a time — there is one print root — in the order they were asked
 * for. A second job waits for the first rather than being dropped: an Export PDF
 * chosen while a print is still on its way must still happen.
 */
let queue = Promise.resolve()
const enqueue = (run) => {
  const job = queue.then(run)
  queue = job.catch(() => {})
  return job
}

const pendingFinish = new Map()

documentSurface.onCommand('printFinished', ({ jobId, completed }) => {
  pendingFinish.get(jobId)?.(completed)
  pendingFinish.delete(jobId)
})

const clearPrintRoot = () => {
  document.getElementById(PRINT_ROOT_ID)?.remove()
  document.getElementById(PAGE_STYLE_ID)?.remove()
}

const mountPrintRoot = (elements, widthPx, heightPx) => {
  clearPrintRoot()
  const style = document.createElement('style')
  style.id = PAGE_STYLE_ID
  style.textContent = `@page { size: ${widthPx}px ${heightPx}px; margin: 0; }`
  document.head.appendChild(style)
  const root = document.createElement('div')
  root.id = PRINT_ROOT_ID
  root.className = 'print-scope'
  for (const el of elements) root.appendChild(el)
  document.body.appendChild(root)
  return root
}

/** Ask the shell to print what #print-root holds. Resolves when the shell is done with it. */
const requestHostPrint = ({ jobId = newJobId(), jobName, widthPx, heightPx, pdfPath }) => {
  const request = {
    jobId,
    jobName,
    paperWidthPt: pxToPt(widthPx),
    paperHeightPt: pxToPt(heightPx),
    pdfPath: pdfPath || undefined,
  }
  if (isNativeShell()) {
    return new Promise((resolve) => {
      pendingFinish.set(jobId, resolve)
      documentSurface.publishPrintRequest(request)
    })
  }
  return invoke('print_webview', {
    jobName: request.jobName,
    paperWidthPt: request.paperWidthPt,
    paperHeightPt: request.paperHeightPt,
    pdfPath: request.pdfPath ?? null,
  }).then(() => true)
}

const guideSheet = (imposition, widthPx, heightPx, title) => {
  const sheet = document.createElement('div')
  sheet.className = 'print-sheet print-guide'
  Object.assign(sheet.style, { width: `${widthPx}px`, height: `${heightPx}px` })
  const h = document.createElement('h1')
  h.textContent = `${title} — folding and sewing guide`
  sheet.appendChild(h)
  const intro = document.createElement('p')
  intro.textContent = `${imposition.sheets.length} sheets, printed double-sided (flip on short edge). `
    + `Fold each sheet in half with the lower page number outside, nest the sheets of each signature in order, `
    + `and stack the signatures in order before sewing.`
    + (imposition.blanksAdded ? ` ${imposition.blanksAdded} blank page(s) were added to fill the last signature.` : '')
  sheet.appendChild(intro)
  const pre = document.createElement('pre')
  pre.textContent = foldingGuide(imposition).join('\n')
  sheet.appendChild(pre)
  return sheet
}

/**
 * Printed page numbers typed as `3-7, 10`: a set of them, or null for every page.
 * A range written backwards is read forwards; anything unreadable is ignored.
 */
export const parsePageRanges = (text) => {
  const wanted = new Set()
  for (const part of String(text || '').split(/[,;\s]+/)) {
    const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part.trim())
    if (!m) continue
    const a = Number(m[1])
    const b = m[2] ? Number(m[2]) : a
    for (let n = Math.min(a, b); n <= Math.max(a, b) && wanted.size < 100_000; n += 1) wanted.add(n)
  }
  return wanted.size ? wanted : null
}

/** The selected text of an editor, as a chapter to lay out alone. */
const selectionChapter = (editor, docPath) => {
  const { from, to } = editor.state.selection
  const cut = editor.state.doc.cut(from, to).toJSON()
  return { path: docPath, name: docPath.split('/').pop() || docPath, content: cut, selection: true }
}

/**
 * The pages of the chapter the cursor is in: from the Heading 1 before it to the next,
 * by where each page starts. A document without headings is one chapter.
 */
const pagesOfChapterAt = (pages, editor) => {
  if (!editor) return pages
  const at = editor.state.selection.from
  const headings = chapterHeadings(editor.state.doc)
  const start = headings.filter((h) => h.pos <= at).pop()?.pos ?? 0
  const end = headings.find((h) => h.pos > at)?.pos ?? Infinity
  return pages.filter((page) => {
    if (page.dataset.pos == null) return false
    const pos = Number(page.dataset.pos)
    return pos >= start && pos < end
  })
}

/**
 * The printed number of the page a position is on, from an editor's pagination; null
 * before it has laid out.
 */
export const printedPageAt = (editor, setup) => {
  const result = editor ? paginationKey.getState(editor.state)?.result : null
  const starts = result?.slotStarts
  if (!starts?.length || !result.pageCount) return null
  const columns = Math.max(1, Math.round(starts.length / result.pageCount))
  const first = setup?.pageNumberStart ?? 1
  return (pos) => {
    let slot = 0
    starts.forEach((start, i) => { if (start != null && start <= pos) slot = i })
    return first + Math.floor(slot / columns)
  }
}

/** A report on the script being written, as a chapter to lay out. */
const reportChapter = (editor, docPath, report) => {
  const name = docPath.split('/').pop() || docPath
  const setup = readDocPageSetup(editor.state.doc)
  const data = breakdown(editor.state.doc, printedPageAt(editor, setup) || undefined)
  return { path: docPath, name: `${REPORT_TITLES[report] || 'Report'}: ${name}`, content: reportDocument(report, data, name), report: true }
}

/**
 * Sides: the pages the chosen scenes are on — each scene from its heading to the next —
 * by where each page starts and the next begins.
 */
export const pagesOfScenes = (pages, editor, chosen) => {
  const scenes = breakdown(editor.state.doc).scenes
  const ranges = (chosen || [])
    .filter((i) => scenes[i])
    .map((i) => [scenes[i].pos, scenes[i + 1]?.pos ?? Infinity])
  const body = pages.filter((page) => page.dataset.pos != null)
  return body.filter((page, i) => {
    const start = Number(page.dataset.pos)
    const end = body[i + 1] ? Number(body[i + 1].dataset.pos) : Infinity
    return ranges.some(([from, to]) => start < to && end > from)
  })
}

const SPOKEN = ['script-dialogue', 'script-stageDialogue', 'script-parenthetical']

/**
 * An actor's copy: every speech of one character marked, name and lines. The pages'
 * clones are walked in order, so a speech carried over a page stays marked.
 */
export const highlightSpeeches = (pages, name) => {
  const wanted = characterName(name)
  let speaking = false
  for (const page of pages) {
    for (const line of page.querySelectorAll('.script-el')) {
      if (line.classList.contains('script-character') || line.classList.contains('script-stageCharacter')) {
        speaking = characterName(line.textContent || '') === wanted
      } else if (!SPOKEN.some((cls) => line.classList.contains(cls))) {
        speaking = false
      }
      if (speaking) line.classList.add('is-highlighted')
    }
  }
}

/** Text set faintly across a page, corner to corner. */
const watermark = (text, pageWidth) => {
  const mark = document.createElement('div')
  mark.className = 'print-watermark'
  const span = document.createElement('span')
  span.textContent = text
  // Sized to run most of the way across the diagonal, whatever its length.
  span.style.fontSize = `${Math.min(96, Math.max(18, (pageWidth * 1.25) / Math.max(4, text.length)))}px`
  mark.appendChild(span)
  return mark
}

/**
 * A book's chapters, where its design runs them on: each run of chapters becomes one
 * flow, so a chapter starts on the page the last one ended on when its head and a few
 * lines fit there (the pagination keeps a head with what follows). Each member keeps
 * where it starts in the flow, for the contents.
 */
export const runOn = (chapters, design) => {
  if (design?.chapterBreak !== 'continue') return chapters
  const out = []
  for (const chapter of chapters) {
    const last = out[out.length - 1]
    const joins = chapter.item?.kind === 'chapter' && last && (last.item?.kind === 'chapter' || last.members)
    if (!joins) {
      out.push(chapter)
      continue
    }
    const base = last.members ? last : {
      ...last,
      members: [{ name: last.name, content: last.content, pos: 0 }],
      content: { ...last.content, content: [...(last.content.content || [])] },
    }
    const size = base.content.content.reduce((n, node) => n + nodeSize(node), 0)
    base.members.push({ name: chapter.name, content: chapter.content, pos: size })
    base.content = { ...base.content, content: [...base.content.content, ...(chapter.content.content || [])] }
    base.original = null
    out[out.length - 1] = base
  }
  return out
}

/** A JSON node's size in ProseMirror positions, as the document it is part of counts it. */
const nodeSize = (node) => {
  if (node.type === 'text') return (node.text || '').length
  const inner = (node.content || []).reduce((n, child) => n + nodeSize(child), 0)
  // A leaf is one position; anything with content opens and closes around it.
  return node.content || !LEAVES.has(node.type) ? inner + 2 : 1
}
const LEAVES = new Set(['hardBreak', 'image', 'horizontalRule', 'pageBreak', 'chapterHead', 'citation', 'noteAnnotation'])

/**
 * A book's sections with each chapter head's pictures — stored as project paths — made
 * URLs the page can show, for laying it out and printing it.
 */
const withDisplayImages = async (projectName, sections) => {
  const urls = new Map()
  for (const section of sections) {
    for (const node of section.content?.content || []) {
      if (node.type !== 'chapterHead') continue
      for (const key of ['image', 'ornamentImage']) {
        const src = node.attrs?.head?.[key]
        if (typeof src === 'string' && isAssetPath(src) && !urls.has(src)) urls.set(src, await assetUrl(projectName, src))
      }
    }
  }
  if (!urls.size) return sections
  return sections.map((section) => (section.content
    ? { ...section, content: mapImageSources(section.content, (src) => urls.get(src) || src) }
    : section))
}

/**
 * A book's front matter as pages: the half title, the title page and the contents laid
 * out from the book, and its own pages (a copyright page, a dedication) flowed like any
 * chapter — each where the book put it and on the side it opens on, numbered in roman
 * from one, and run to an even count so the first chapter opens on a right-hand page.
 * Set after the body, so the contents know each chapter's folio.
 */
const buildBookFront = async ({ sections, chapters, folios, setup, bookTitle, author, profile, words, placement, onProgress }) => {
  const front = sections.filter((s) => s.role === 'front')
  const hasTitlePage = front.some((s) => s.item.generated === 'titlePage')
  // A book with no title page among its contents prints the setup's, as it always has,
  // after its half title.
  const sequence = [...front]
  if (!hasTitlePage && setup.titlePage) {
    const at = sequence.findIndex((s) => s.item.generated !== 'halfTitle')
    sequence.splice(at < 0 ? sequence.length : at, 0, { item: { id: 'setup-title-page', kind: 'generated', generated: 'titlePage', hidden: false } })
  }
  const entries = []
  chapters.forEach((chapter, i) => {
    if (chapter.members) {
      chapter.members.forEach((member, m) => {
        entries.push({ title: chapterTitleOf(member.content, member.name), folio: chapter.memberFolios?.[m] || folios[i] || '' })
      })
      return
    }
    const title = chapter.item?.kind === 'part'
      ? (chapter.label ? `${chapter.label}${chapter.item.title ? `: ${chapter.item.title}` : ''}` : chapter.name)
      : chapterTitleOf(chapter.content, chapter.name)
    entries.push({ title, folio: folios[i] || '', part: chapter.item?.kind === 'part' })
  })
  const titleSetup = setup.titlePage ? setup : { ...setup, titlePage: { style: 'book', showContact: false, showWordCount: false } }
  const sources = []
  for (const [index, section] of sequence.entries()) {
    onProgress({ done: index, total: sequence.length })
    const kind = section.item.generated
    const itemId = section.item.id
    if (kind === 'halfTitle') {
      sources.push({ fixed: (physical) => [halfTitlePage(setup, physical, bookTitle)], startOn: 'recto', itemId })
    } else if (kind === 'titlePage') {
      sources.push({ fixed: () => buildTitlePages({ setup: titleSetup, title: bookTitle, profile, author, words }).slice(0, 1), startOn: 'recto', itemId })
    } else if (kind === 'contents') {
      sources.push({ fixed: (physical) => contentsPages(setup, entries, physical), startOn: 'recto', itemId })
    } else if (section.content) {
      const laid = await layoutOffscreen(section.content, setup)
      sources.push({ ...laid, setup, title: section.name, chapterTitleAt: () => section.name, itemId, ...placement(section) })
    }
  }
  if (!sources.length) return []
  let pages
  try {
    pages = renderPages(sources, { bookTitle, author, surname: surnameOf(author), words, numberStart: 1, numberFormat: 'lowerRoman' })
  } finally {
    // The pages are clones: the off-screen editors they were cut from can go.
    for (const source of sources) source.destroy?.()
  }
  if ((setup.mirrorMargins || setup.chapterStartsOnRecto) && pages.length % 2 === 1) {
    const m = pageMetrics(setup)
    const blank = document.createElement('div')
    blank.className = 'print-page is-blank'
    Object.assign(blank.style, { width: `${m.width}px`, height: `${m.height}px` })
    pages.push(blank)
  }
  return pages
}

/**
 * Build the printable pages (or sheets) for a job and mount them in #print-root.
 * Exposed apart from printing so Print Preview and tests can use the same pages.
 */
export const preparePrint = async ({
  projectName,
  docPath,
  scope = 'document',
  bound = false,
  liveEditors = [],
  book,
  options = {},
  onProgress = () => {},
  measureOnly = false,
  // A book's chapters as another typeset set them (a typeset version previewed): each
  // one's content, given its path, before it compiles.
  mapContent = null,
}) => {
  const liveByPath = new Map(liveEditors.filter((e) => e?.path && e.editor && !e.editor.isDestroyed).map((e) => [e.path, e.editor]))
  const range = options.range || 'all'
  const activeEditor = liveByPath.get(docPath)
  // A report, or sides, is of the script being written.
  const report = options.report || null
  if (report || range === 'scenes') {
    if (!activeEditor) throw new Error('Open the script to print from it.')
    scope = 'document'
  }
  // The selection prints alone, as a document of its own.
  if (range === 'selection') {
    const selection = activeEditor?.state.selection
    if (!selection || selection.empty) throw new Error('Select some text to print it on its own.')
    scope = 'document'
  }
  const compiled = scope !== 'document'
  const author = bookAuthor(book)
  // The book's named text styles, on the pages it lays out.
  if (book) applyTextStyleSheet(textStylesOf(book))
  // Where its notes go: at the page's foot, pagination keeps room for them.
  const notesOptions = notesOptionsOf(book)
  const footnotes = notesOptions.placement === 'page'
  const live = (path) => liveByPath.get(path)?.getJSON() || null
  // A book is its contents in book order: front matter, parts, chapters, back matter.
  // Each chapter is numbered as the book numbers it; a document is as it is.
  let sections = null
  let loaded
  if (compiled && !report && range !== 'selection') {
    const loadedRaw = await loadBookSections(projectName, bookFolderFor(docPath, scope), book, live)
    const raw = mapContent ? loadedRaw.map((s) => (s.content ? { ...s, content: mapContent(s.path, s.content) } : s)) : loadedRaw
    // A document whose bibliography appears only on paper gets it here (and so is laid
    // out afresh below, not taken from its live pages).
    const withBibliography = await withPrintBibliography(
      projectName,
      raw.filter((s) => s.item.kind === 'chapter' && s.content).map((s) => ({ path: s.path, name: s.name, content: s.content }))
    )
    const byPath = new Map(withBibliography.map((c) => [c.path, c]))
    const withNotes = raw.map((s) => {
      const c = s.item.kind === 'chapter' ? byPath.get(s.path) : null
      return c ? { ...s, content: c.content, original: s.content, printBibliography: c.printBibliography } : { ...s, original: s.content }
    })
    sections = await withDisplayImages(projectName, setBookNotes(compileSections(withNotes, book, { author }), notesOptions, (s) => chapterTitleOf(s.content, s.name)))
    loaded = sections.filter((s) => s.item.kind === 'chapter' && s.content)
  } else {
    loaded = report
      ? [reportChapter(activeEditor, docPath, report)]
      : range === 'selection'
      ? [selectionChapter(activeEditor, docPath)]
      : await withPrintBibliography(projectName, await loadChapters(projectName, docPath, 'document', live))
    // A document's notes, numbered and set as its book sets them.
    loaded = loaded.map((c) => {
      const { doc, notes } = setDocumentNotes(c.content, notesOptions)
      return notes.length ? { ...c, content: doc } : c
    })
  }
  if (!loaded.length && !sections?.some((s) => s.content)) return null
  // What flows as pages: a document's chapter; a book's body and back matter — the
  // front matter is set after, once the body's folios are known for its contents.
  const design = sections ? book?.chapterDesign : null
  let chapters = sections
    ? runOn(sections.filter((s) => s.role !== 'front' && s.content), design)
    : loaded

  // A book with a setup of its own prints every chapter in it; otherwise the first
  // chapter's decides, as it always has. A document alone prints in its own, or in
  // its book's when it has none — which is what Print Layout showed it in.
  const first = chapters[0] || loaded[0] || sections?.find((s) => s.content)
  const firstOwn = first?.content?.attrs?.pageSetup || readDocPageSetup(liveByPath.get(first?.path)?.state.doc)
  const { setup } = resolvePageSetup({ docSetup: firstOwn, bookSetup: book?.pageSetup, scope })
  // The current chapter of a book is the document being written in, numbered as it
  // would be in the whole book.
  const chapterOnly = range === 'currentChapter' && compiled
  if (chapterOnly) {
    chapters = chapters.filter((chapter) => chapter.path === docPath)
    if (!chapters.length) throw new Error('This document is left out of the book.')
  }

  /** How a book's section sits: its item's page options; a chapter follows the design. */
  const placement = (section) => {
    if (section?.item?.kind === 'chapter' && design) {
      return { startOn: design.chapterBreak === 'newRightPage' ? 'recto' : 'any' }
    }
    if (!section?.item || section.item.kind === 'chapter') return {}
    const options = pageOptionsOf(section.item)
    // A part with a design of its own starts where the design says.
    const start = section.item.kind === 'part' && book?.partDesign
      ? (book.partDesign.chapterBreak === 'newRightPage' ? 'recto' : 'any')
      : options.start
    return { startOn: start, runningHeads: options.runningHeads, folio: options.folio, position: options.position }
  }

  const sources = []
  try {
    for (const [index, chapter] of chapters.entries()) {
      onProgress({ done: index, total: chapters.length })
      // A chapter the book numbered is not what its editor shows: lay it out afresh.
      const original = sections ? chapter.original : loaded[index]?.content
      const changed = chapter.printBibliography || chapter.selection || chapter.report || chapter.content !== original || chapterOnly
      const live = changed || !chapter.path ? null : liveSource(liveByPath.get(chapter.path), setup, { footnotes })
      const laid = live || await layoutOffscreen(chapter.content, setup, { footnotes })
      sources.push({
        ...laid,
        setup,
        title: chapter.name,
        chapterTitleAt: chapterTitleAt(laid.headings, chapter.name),
        itemId: chapter.item?.id,
        ...placement(chapter),
      })
    }
    const bookTitle = scope === 'document' ? (chapters[0] || loaded[0]).name : (book?.title || chapters[0]?.name || '')
    const profile = getAuthorProfile()
    // Words only when something shows them: counting a whole book is not free.
    const needsWords = setup.titlePage?.showWordCount || setupUsesToken(setup, 'words')
    const words = needsWords ? loaded.reduce((n, c) => n + countWords(textOfContent(c.content)), 0) : 0
    const folios = []
    const body = renderPages(sources, {
      bookTitle,
      author,
      surname: surnameOf(author),
      words,
      onChapterStart: (index, folio) => { folios[index] = folio },
    })
    // Chapters run on into one flow have their own folios: the page each head is on.
    for (const [index, chapter] of chapters.entries()) {
      if (!chapter.members) continue
      chapter.memberFolios = chapter.members.map(({ pos }) => {
        let folio = folios[index] || ''
        for (const page of body) {
          if (page.dataset.chapter !== String(index)) continue
          if (Number(page.dataset.pos) <= pos) folio = page.dataset.folio
        }
        return folio
      })
    }
    const m0 = pageMetrics(setup)
    let front
    if (sections && !chapterOnly) {
      front = await buildBookFront({
        sections,
        chapters,
        folios,
        setup,
        bookTitle,
        author,
        profile,
        words,
        placement,
        onProgress,
      })
    } else {
      // A report is not the script: it has no title page of its own.
      front = report ? [] : buildTitlePages({ setup, title: bookTitle, profile, author, words })
    }
    let pages = chapterOnly ? body : [...front, ...body]
    // Counting for the Publish tab: every page as it would print, and every word.
    if (measureOnly) {
      return { pageCount: pages.length, words: words || loaded.reduce((n, c) => n + countWords(textOfContent(c.content)), 0) }
    }
    if (range === 'currentChapter' && !compiled) pages = pagesOfChapterAt(pages, activeEditor)
    if (range === 'scenes') pages = pagesOfScenes(pages, activeEditor, options.scenes)
    if (options.highlightCharacter?.trim()) highlightSpeeches(pages, options.highlightCharacter)
    const wanted = parsePageRanges(options.pages)
    if (wanted) pages = pages.filter((page) => page.dataset.page && wanted.has(Number(page.dataset.page)))
    if (!pages.length) {
      if (range === 'scenes') throw new Error('Choose the scenes to print as sides.')
      throw new Error(wanted ? 'None of those pages are in what is being printed.' : 'There was nothing to print.')
    }
    if (options.watermark?.trim()) {
      const text = options.watermark.trim().replace(/\{recipient\}/g, options.recipient || '')
      for (const page of pages) page.appendChild(watermark(text, m0.width))
    }
    const m = pageMetrics(setup)

    if (bound && book?.binding && book.binding.binding !== 'none') {
      const { sheets, sheetWidth, sheetHeight, imposition } = imposeSheets(pages, setup, book.binding)
      // Sheets come out front, back, front, back; manual duplex wants every front first.
      const sequence = printSequence(imposition, book.binding.duplex === 'manual' ? 'manual' : 'automatic')
      const ordered = sequence.map(({ sheet, side }) => sheets[sheet * 2 + (side === 'front' ? 0 : 1)])
      if (book.binding.includeGuide) ordered.push(guideSheet(imposition, sheetWidth, sheetHeight, bookTitle))
      return { elements: ordered, widthPx: sheetWidth, heightPx: sheetHeight, jobName: bookTitle, pageCount: pages.length, imposition }
    }
    return { elements: pages, widthPx: m.width, heightPx: m.height, jobName: bookTitle, pageCount: pages.length }
  } finally {
    for (const source of sources) source.destroy()
  }
}

/**
 * Print one figure on one page — a map, drawn as SVG — through the same print root
 * and shell request as a document, so Print… and Export PDF work in both shells.
 * `markup` is the page's content; the page is `widthPx` × `heightPx`.
 */
export const printFigure = ({ markup, widthPx, heightPx, jobName, pdfPath }) => runJob({
  kind: pdfPath ? 'export' : 'print',
  format: pdfPath ? 'pdf' : undefined,
  pdfPath,
  prepare: async () => {
    const sheet = document.createElement('div')
    sheet.className = 'print-sheet print-figure'
    Object.assign(sheet.style, { width: `${widthPx}px`, height: `${heightPx}px`, overflow: 'hidden' })
    sheet.innerHTML = markup
    return { elements: [sheet], widthPx, heightPx, jobName, images: sheet }
  },
})

/**
 * One job, from gathering its pages to the shell's answer, reporting each step.
 * Resolves true when it printed or saved, false when there was nothing to print or the
 * author cancelled; rejects, after reporting the failure, when it could not be done.
 */
const runJob = ({ jobId = newJobId(), kind, format, pdfPath, prepare }) => enqueue(async () => {
  const report = (phase, extra = {}) => reportJob({ jobId, kind, format, phase, ...extra })
  report('preparing')
  try {
    const prepared = await prepare(({ done, total }) => report('laying', { done, total }))
    if (!prepared) {
      report('failed', { message: 'There was nothing to print.' })
      return false
    }
    mountPrintRoot(prepared.elements, prepared.widthPx, prepared.heightPx)
    if (prepared.images) await waitForImages(prepared.images)
    // Let the print root lay out once before WebKit snapshots it.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    report('writing')
    const completed = await requestHostPrint({
      jobId,
      jobName: prepared.jobName,
      widthPx: prepared.widthPx,
      heightPx: prepared.heightPx,
      pdfPath,
    })
    // The Swift shell says when it is done; the Tauri print sheet does not, so its
    // print root stays (hidden on screen) until the next job replaces it.
    if (isNativeShell()) clearPrintRoot()
    report(completed ? 'done' : 'cancelled', completed && pdfPath ? { path: pdfPath } : {})
    return completed
  } catch (error) {
    if (isNativeShell()) clearPrintRoot()
    report('failed', { message: describeError(error) })
    throw error
  }
})

/**
 * Print (or save as PDF, with `pdfPath`). Resolves once the shell is done with the job.
 * `jobId`, when given, is the id its statuses carry — an export passes its own.
 */
export const runPrintJob = (options) => {
  const recipients = (options.options?.recipients || []).map((r) => r.trim()).filter(Boolean)
  // A watermarked copy for each recipient: one job each, the name in the watermark.
  if (recipients.length && options.options?.watermark?.trim()) {
    return recipients.reduce((previous, recipient) => previous.then(() => runJob({
      kind: options.pdfPath ? 'export' : 'print',
      format: options.pdfPath ? 'pdf' : undefined,
      pdfPath: options.pdfPath ? recipientPath(options.pdfPath, recipient) : undefined,
      prepare: (onProgress) => preparePrint({ ...options, options: { ...options.options, recipient }, onProgress }),
    })), Promise.resolve(true))
  }
  return runJob({
    jobId: options.jobId,
    kind: options.pdfPath ? 'export' : 'print',
    format: options.pdfPath ? 'pdf' : undefined,
    pdfPath: options.pdfPath,
    prepare: (onProgress) => preparePrint({ ...options, onProgress }),
  })
}

/**
 * Lay what a scope covers out as it would print, without printing it: its page count
 * and words, for the Publish tab. Runs in the print queue, after any job before it.
 */
/**
 * Print pages already made — a book's cover, laid out whole — through the same print
 * root and shell request as a book, or save them as a PDF.
 */
export const printPages = ({ elements, widthPx, heightPx, jobName, pdfPath, jobId, format = 'pdf' }) => runJob({
  jobId,
  kind: pdfPath ? 'export' : 'print',
  format,
  pdfPath,
  prepare: async () => ({ elements, widthPx, heightPx, jobName, images: elements[0] }),
})

export const measurePrint = (options) => enqueue(() => preparePrint({ ...options, measureOnly: true }))

/** `Book.pdf` for Sam Reader → `Book – Sam Reader.pdf`, beside it. */
export const recipientPath = (path, recipient) => {
  const safe = recipient.replace(/[/\\:*?"<>|]+/g, '-')
  return /\.pdf$/i.test(path) ? path.replace(/\.pdf$/i, ` – ${safe}.pdf`) : `${path} – ${safe}`
}
