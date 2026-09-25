/**
 * printRender.js — pages for paper, built from a laid-out, paginated editor.
 *
 * A printed page is not re-typeset: it is the editor's own layout, cut up. Each
 * page is a box the size of the paper holding, for each of its text columns, a
 * window onto the paginated flow at that slot. Into the window go clones of the
 * editor's top-level blocks that overlap it, each placed exactly where it sat in
 * the flow. Same DOM, same CSS, same width — so the same line breaks, the same
 * node views (a Pinterest board prints as it looks), and page breaks exactly where
 * the pagination put them. What prints is what Print Layout showed.
 *
 * Pages then go to the printer one per sheet, or, for binding, two per sheet side
 * in imposed order (imposition.ts), scaled to fit the half-sheet or centred at
 * actual size with crop marks, shifted toward the spine by the creep allowance.
 */
import { imposePages } from './imposition'
import { mmToPx } from './pageSizes'
import {
  describeWordCount,
  formatPageNumber,
  normalizePageSetup,
  pageLeftMargin,
  pageMetrics,
  runningTextFor,
} from './pageSetup'
import { getPageSizePreset } from './pageSizes'
import { applyTypography } from './typography'

/** Editing chrome that must never reach paper. */
const STRIP_SELECTORS = [
  '.image-toolbar',
  '.image-resize-handle',
  '.image-crop-overlay',
  '.pinterest-board-refresh-btn',
  '.pinterest-board-expand-hint',
  '.conversation-toolbar',
  '.column-resize-handle',
  '.note-marker',
  '.note-dot',
  '.margin-hang', // a bubble chip or note dot and its spacer (lib/marginHang.js)
  '.ProseMirror-gapcursor',
  '.drag-drop-caret',
].join(',')

const STRIP_CLASSES = [
  'ProseMirror-selectednode',
  'ProseMirror-focused',
  'has-focus',
  'is-selected',
  'selectedCell',
  'read-aloud-word-highlight',
]

const cleanClone = (node) => {
  node.querySelectorAll(STRIP_SELECTORS).forEach((el) => el.remove())
  for (const cls of STRIP_CLASSES) {
    if (node.classList?.contains(cls)) node.classList.remove(cls)
    node.querySelectorAll(`.${cls}`).forEach((el) => el.classList.remove(cls))
  }
  node.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'))
  node.removeAttribute?.('contenteditable')
  return node
}

/**
 * The top-level blocks of a paginated editor, with where each sits in the flow —
 * in layout px, relative to the editor root, whatever the live zoom.
 */
export const snapshotBlocks = (pmDom) => {
  const root = pmDom.getBoundingClientRect()
  const scale = root.width / (pmDom.offsetWidth || 1) || 1
  const blocks = []
  for (const child of Array.from(pmDom.children)) {
    const r = child.getBoundingClientRect()
    if (!r.height && !r.width) continue
    blocks.push({
      el: child,
      top: (r.top - root.top) / scale,
      left: (r.left - root.left) / scale,
      width: r.width / scale,
      height: r.height / scale,
    })
  }
  return { blocks, width: pmDom.offsetWidth, className: pmDom.className }
}

const makeRunning = (text, className, style) => {
  const el = document.createElement('div')
  el.className = `pl-running ${className}`
  Object.assign(el.style, style)
  for (const part of [text.left, text.center, text.right]) {
    const span = document.createElement('span')
    span.textContent = part
    el.appendChild(span)
  }
  return el
}

/**
 * One source's slot window: the blocks overlapping [from, to) of the editor root's
 * coordinates, cloned and placed, shifted so `from` is the window's top.
 */
const renderWindow = (snapshot, from, to, bleed) => {
  const editor = document.createElement('div')
  editor.className = 'editor print-editor'
  const pm = document.createElement('div')
  pm.className = snapshot.className.replace(/\bProseMirror-focused\b/g, '')
  pm.classList.add('print-flow')
  Object.assign(pm.style, {
    position: 'absolute',
    left: '0',
    top: `${-from}px`,
    width: `${snapshot.width}px`,
    height: `${to - from + 2 * bleed}px`,
    padding: '0',
    margin: '0',
  })
  for (const block of snapshot.blocks) {
    if (block.top + block.height <= from - bleed || block.top >= to + bleed) continue
    const clone = cleanClone(block.el.cloneNode(true))
    Object.assign(clone.style, {
      position: 'absolute',
      top: `${block.top}px`,
      left: `${block.left}px`,
      width: `${block.width}px`,
      margin: '0',
      boxSizing: 'border-box',
    })
    pm.appendChild(clone)
  }
  editor.appendChild(pm)
  return editor
}

/**
 * Pages for a set of laid-out sources (one per chapter). Returns page elements at
 * the page size, with continuous numbering, and blank versos wherever a chapter
 * must open on a recto.
 *
 * source: { snapshot, result, setup, stride, title, chapterTitleAt(pos) }
 * `onChapterStart(index, folio)` is told the folio each source's first page carries,
 * for a table of contents.
 */
export const renderPages = (sources, { bookTitle = '', author = '', surname, words = 0, onChapterStart } = {}) => {
  const pages = []
  if (!sources.length) return pages
  const setup = normalizePageSetup(sources[0].setup)
  const m = pageMetrics(setup)
  // The window onto the flow reaches a little past the text block, so an italic's
  // overhang or a descender is not shaved off. Half the margin is always safe: the
  // pagination leaves the whole margin (and the gap) empty between pages.
  const bleedY = Math.min(m.contentTop, m.height - m.contentTop - m.contentHeight) / 2
  const bleedX = setup.columns > 1
    ? m.columnGap / 2
    : Math.min(24, pageLeftMargin(setup, 1) / 2, pageLeftMargin(setup, 2) / 2)
  const totalPages = sources.reduce((n, s) => n + Math.max(1, s.result?.pageCount || 1), 0)

  const blankPage = () => {
    const page = document.createElement('div')
    page.className = 'print-page is-blank'
    Object.assign(page.style, { width: `${m.width}px`, height: `${m.height}px` })
    return page
  }
  const wordsText = words > 0 ? describeWordCount(words) : ''
  const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })

  sources.forEach((source, chapterIndex) => {
    const { snapshot, result, stride } = source
    const columns = setup.columns
    const chapterStarts = new Set(result.chapterStartSlots)
    // A chapter after the first starts on a new page — on a recto, if asked.
    if (chapterIndex > 0 && setup.chapterStartsOnRecto && pages.length % 2 === 1) pages.push(blankPage())

    for (let p = 0; p < Math.max(1, result.pageCount); p += 1) {
      const physical = pages.length + 1
      const firstSlot = p * columns
      const slots = result.slotStarts.slice(firstSlot, firstSlot + columns)
      const blank = p > 0 && slots.every((s) => s == null)
      const page = document.createElement('div')
      page.className = `print-page${blank ? ' is-blank' : ''}`
      Object.assign(page.style, { width: `${m.width}px`, height: `${m.height}px` })
      // The type the flow was laid out in, so the cloned lines are set as they were.
      applyTypography(page, setup.typography)

      const left = pageLeftMargin(setup, physical)
      for (let c = 0; c < columns && !blank; c += 1) {
        const slot = firstSlot + c
        const from = m.contentTop + slot * stride
        const clip = document.createElement('div')
        clip.className = 'print-clip'
        const x = left + c * (m.columnWidth + m.columnGap)
        const width = columns > 1 ? m.columnWidth : m.contentWidth
        Object.assign(clip.style, {
          left: `${x - bleedX}px`,
          top: `${m.contentTop - bleedY}px`,
          width: `${width + 2 * bleedX}px`,
          height: `${m.contentHeight + 2 * bleedY}px`,
        })
        const win = renderWindow(snapshot, from - bleedY, from + m.contentHeight + bleedY, 0)
        win.style.left = `${bleedX}px`
        clip.appendChild(win)
        page.appendChild(clip)
      }

      const startPos = slots.find((s) => s != null) ?? 0
      const ctx = {
        page: setup.pageNumberStart + physical - 1,
        pages: setup.pageNumberStart + totalPages - 1,
        title: bookTitle || source.title,
        chapter: source.chapterTitleAt?.(startPos) || source.title,
        author,
        surname,
        words: wordsText,
        date,
      }
      const flags = { chapterFirstPage: chapterStarts.has(firstSlot), blank }
      const header = runningTextFor(setup, 'header', physical, ctx, flags)
      const footer = runningTextFor(setup, 'footer', physical, ctx, flags)
      if (header) {
        page.appendChild(makeRunning(header, 'is-header', {
          left: `${left}px`, width: `${m.contentWidth}px`, top: `${m.headerTop}px`, height: `${Math.max(0, m.contentTop - m.headerTop)}px`,
        }))
      }
      if (footer) {
        page.appendChild(makeRunning(footer, 'is-footer', {
          left: `${left}px`, width: `${m.contentWidth}px`, top: `${m.contentTop + m.contentHeight}px`, height: `${Math.max(0, m.footerBottom - m.contentTop - m.contentHeight)}px`,
        }))
      }
      page.dataset.folio = formatPageNumber(ctx.page, setup.pageNumberFormat)
      if (p === 0) onChapterStart?.(chapterIndex, page.dataset.folio)
      pages.push(page)
    }
  })
  return pages
}

const CROP = 18 // crop-mark length, px (3/16 in)
const CROP_GAP = 6

const cropMarks = (x, y, w, h) => {
  const marks = []
  const line = (left, top, width, height) => {
    const el = document.createElement('div')
    el.className = 'print-crop'
    Object.assign(el.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` })
    marks.push(el)
  }
  for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
    const dx = cx === x ? -1 : 1
    const dy = cy === y ? -1 : 1
    line(dx < 0 ? cx - CROP_GAP - CROP : cx + CROP_GAP, cy - 0.25, CROP, 0.5)
    line(cx - 0.25, dy < 0 ? cy - CROP_GAP - CROP : cy + CROP_GAP, 0.5, CROP)
  }
  return marks
}

/**
 * Sheets for binding: the pages two to a side, landscape, in imposed order. Returns
 * { sheets: HTMLElement[], sheetWidth, sheetHeight, imposition }, sheets in the
 * order they go to the printer (front, back, front, back…).
 */
export const imposeSheets = (pages, setupInput, binding) => {
  const setup = normalizePageSetup(setupInput)
  const m = pageMetrics(setup)
  const preset = getPageSizePreset(binding.sheetPresetId) || getPageSizePreset('letter')
  // Landscape: two portrait pages side by side across the long edge.
  const sheetWidth = mmToPx(Math.max(preset.widthMm, preset.heightMm))
  const sheetHeight = mmToPx(Math.min(preset.widthMm, preset.heightMm))
  const half = sheetWidth / 2
  const fit = binding.sheetFit === 'fit'
  const scale = fit ? Math.min(half / m.width, sheetHeight / m.height) : Math.min(1, half / m.width, sheetHeight / m.height)
  const pw = m.width * scale
  const ph = m.height * scale
  const imposition = imposePages(pages.length, {
    binding: binding.binding === 'none' ? 'perfect' : binding.binding,
    sheetsPerSignature: binding.sheetsPerSignature,
    paperThicknessMm: binding.paperThicknessMm,
  })

  const place = (sheet, pageNumber, side, creepPx) => {
    // Left half: its right edge is the fold (the spine). Right half: its left edge.
    const x = side === 'left' ? half - pw : half
    const y = (sheetHeight - ph) / 2
    // Creep: content moves toward the spine, i.e. toward the sheet's centre.
    const shift = side === 'left' ? creepPx : -creepPx
    const slot = document.createElement('div')
    slot.className = 'print-imposed'
    Object.assign(slot.style, { left: `${x}px`, top: `${y}px`, width: `${pw}px`, height: `${ph}px` })
    if (pageNumber > 0) {
      const page = pages[pageNumber - 1].cloneNode(true)
      Object.assign(page.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        transform: `translateX(${shift}px) scale(${scale})`,
        transformOrigin: '0 0',
      })
      slot.appendChild(page)
    }
    sheet.appendChild(slot)
    if (binding.cropMarks && !fit) cropMarks(x, y, pw, ph).forEach((mark) => sheet.appendChild(mark))
  }

  const sheets = []
  for (const imposed of imposition.sheets) {
    const creepPx = mmToPx(imposed.creepMm || 0) * scale
    for (const side of ['front', 'back']) {
      const sheet = document.createElement('div')
      sheet.className = 'print-sheet'
      Object.assign(sheet.style, { width: `${sheetWidth}px`, height: `${sheetHeight}px` })
      place(sheet, imposed[side].left, 'left', creepPx)
      place(sheet, imposed[side].right, 'right', creepPx)
      if (binding.cropMarks) {
        // The fold.
        const fold = document.createElement('div')
        fold.className = 'print-fold'
        Object.assign(fold.style, { left: `${half - 0.25}px`, top: '0', height: `${Math.max(0, (sheetHeight - ph) / 2 - CROP_GAP)}px` })
        sheet.appendChild(fold)
      }
      sheet.dataset.sheet = `${imposed.signature}:${imposed.indexInSignature}:${side}`
      sheets.push(sheet)
    }
  }
  return { sheets, sheetWidth, sheetHeight, imposition }
}
