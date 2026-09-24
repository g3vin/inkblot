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
import { loadChapters } from './compile'
import { readDocPageSetup } from './DocPageSetup'
import { foldingGuide, printSequence } from './imposition'
import { paginationKey, settlePagination } from './PaginationExtension'
import { normalizePageSetup, pageMetrics } from './pageSetup'
import { pxToPt } from './pageSizes'
import { PAGE_GAP } from './printLayoutConstants'
import { imposeSheets, renderPages, snapshotBlocks } from './printRender'

const PRINT_ROOT_ID = 'print-root'
const PAGE_STYLE_ID = 'print-page-style'

/** Top-level H1s of a document, as { pos, text }: what a chapter's running head shows. */
export const chapterHeadings = (doc) => {
  const out = []
  doc.forEach((node, pos) => {
    if (node.type.name === 'heading' && node.attrs.level === 1 && node.textContent) out.push({ pos, text: node.textContent })
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
const layoutOffscreen = async (content, setup) => {
  const m = pageMetrics(setup)
  const host = document.createElement('div')
  host.className = 'print-layout print-offscreen'
  host.setAttribute('aria-hidden', 'true')
  const stage = document.createElement('div')
  stage.className = 'pl-stage'
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
  editor.commands.setPaginationFrame({
    slotHeight: m.contentHeight,
    stride,
    columns: setup.columns,
    minLines: setup.widowOrphanLines,
  })
  await waitForImages(mount)
  const result = settlePagination(editor.view)
  return {
    snapshot: snapshotBlocks(editor.view.dom),
    result,
    stride,
    headings: chapterHeadings(editor.state.doc),
    destroy: () => {
      editor.destroy()
      host.remove()
    },
  }
}

/** The live editor as a source, when it is already showing pages in this setup. */
const liveSource = (editor, setup) => {
  if (!editor || editor.isDestroyed) return null
  const state = paginationKey.getState(editor.state)
  if (!state?.frame || !state.result) return null
  const m = pageMetrics(setup)
  if (Math.abs(state.frame.slotHeight - m.contentHeight) > 0.5) return null
  return {
    snapshot: snapshotBlocks(editor.view.dom),
    result: state.result,
    stride: state.frame.stride,
    headings: chapterHeadings(editor.state.doc),
    destroy: () => {},
  }
}

let currentJob = null
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
const requestHostPrint = ({ jobName, widthPx, heightPx, pdfPath }) => {
  const jobId = `print-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
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
}) => {
  const liveByPath = new Map(liveEditors.filter((e) => e?.path && e.editor && !e.editor.isDestroyed).map((e) => [e.path, e.editor]))
  // A document whose bibliography appears only on paper gets it here (and so is laid
  // out afresh below, not taken from its live pages).
  const chapters = await withPrintBibliography(
    projectName,
    await loadChapters(projectName, docPath, scope, (path) => liveByPath.get(path)?.getJSON() || null)
  )
  if (!chapters.length) return null

  const firstOwn = chapters[0].content?.attrs?.pageSetup || readDocPageSetup(liveByPath.get(chapters[0].path)?.state.doc)
  const setup = normalizePageSetup(scope === 'document' ? firstOwn : (book?.pageSetup || firstOwn))

  const sources = []
  try {
    for (const chapter of chapters) {
      const live = chapter.printBibliography ? null : liveSource(liveByPath.get(chapter.path), setup)
      const laid = live || await layoutOffscreen(chapter.content, setup)
      sources.push({
        ...laid,
        setup,
        title: chapter.name,
        chapterTitleAt: chapterTitleAt(laid.headings, chapter.name),
      })
    }
    const bookTitle = scope === 'document' ? chapters[0].name : (book?.title || chapters[0].name)
    const pages = renderPages(sources, { bookTitle, author: book?.author || '' })
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
export const printFigure = async ({ markup, widthPx, heightPx, jobName, pdfPath }) => {
  if (currentJob) return currentJob
  currentJob = (async () => {
    try {
      const sheet = document.createElement('div')
      sheet.className = 'print-sheet print-figure'
      Object.assign(sheet.style, { width: `${widthPx}px`, height: `${heightPx}px`, overflow: 'hidden' })
      sheet.innerHTML = markup
      mountPrintRoot([sheet], widthPx, heightPx)
      await waitForImages(sheet)
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const completed = await requestHostPrint({ jobName, widthPx, heightPx, pdfPath })
      if (isNativeShell()) clearPrintRoot()
      return completed
    } finally {
      currentJob = null
    }
  })()
  return currentJob
}

/** Print (or save as PDF, with `pdfPath`). Resolves once the shell has the job. */
export const runPrintJob = async (options) => {
  if (currentJob) return currentJob
  currentJob = (async () => {
    try {
      const prepared = await preparePrint(options)
      if (!prepared) return false
      mountPrintRoot(prepared.elements, prepared.widthPx, prepared.heightPx)
      // Let the print root lay out once before WebKit snapshots it.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const completed = await requestHostPrint({
        jobName: prepared.jobName,
        widthPx: prepared.widthPx,
        heightPx: prepared.heightPx,
        pdfPath: options.pdfPath,
      })
      // The Swift shell says when it is done; the Tauri print sheet does not, so its
      // print root stays (hidden on screen) until the next job replaces it.
      if (isNativeShell()) clearPrintRoot()
      return completed
    } finally {
      currentJob = null
    }
  })()
  return currentJob
}
