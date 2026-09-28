/**
 * frontMatter.js — a printed book's pages before its first chapter.
 *
 *   half-title   the title alone                                 recto
 *   title page   the setup's (titlePage.js)                      recto
 *   copyright    at the foot of the title page's back            verso
 *   dedication   centred, a third of the way down                recto
 *   epigraph     the quotation and who said it                   recto
 *   contents     every chapter and the page it starts on         recto, as many as it takes
 *
 * Laid out here, not flowed through the editor: each is a page of its own, short and
 * fixed, and the contents need page numbers the body has already been given. None of
 * them is numbered. With facing pages, each opens on a recto and the whole runs to an
 * even count, so the first chapter opens on a right-hand page, as a book's does.
 */
import { pageLeftMargin, pageMetrics } from './pageSetup'
import { applyTypography } from './typography'

/** px per pt, as the page sizes are laid out (96 px to the inch). */
const PX_PER_PT = 96 / 72

const newPage = (setup, m, className) => {
  const page = document.createElement('div')
  page.className = `print-page print-matter ${className}`
  Object.assign(page.style, { width: `${m.width}px`, height: `${m.height}px` })
  applyTypography(page, setup.typography)
  return page
}

const block = (className, text, style) => {
  const el = document.createElement('div')
  el.className = className
  el.textContent = text
  Object.assign(el.style, style)
  return el
}

/** The text block's box on the `physical`th page of the whole print. */
const textBox = (setup, m, physical) => {
  const left = pageLeftMargin(setup, physical)
  return { left: `${left}px`, width: `${m.contentWidth}px`, top: m.contentTop, height: m.contentHeight }
}

/**
 * Rows of the contents that fit a page: the first page also holds its heading.
 * Exposed for the tests.
 */
export const contentsRowsPerPage = (setup) => {
  const m = pageMetrics(setup)
  const size = (setup.typography?.fontSizePt || 12) * PX_PER_PT
  const row = size * 1.8
  const total = Math.max(1, Math.floor(m.contentHeight / row))
  return { first: Math.max(1, total - 4), rest: total }
}

/** A half-title page — the title alone — for the `physical`th page of the print. */
export const halfTitlePage = (setup, physical, title) => {
  const m = pageMetrics(setup)
  const page = newPage(setup, m, 'fm-half-title')
  const box = textBox(setup, m, physical)
  page.appendChild(block('fm-center fm-title', title, { left: box.left, width: box.width, top: `${box.top + box.height * 0.3}px` }))
  return page
}

/**
 * The contents' pages, from the `firstPhysical`th page of the print: [{ title, folio,
 * part }] — a part's row is a heading over its chapters, with no folio of its own.
 */
export const contentsPages = (setup, entries, firstPhysical = 1) => {
  const m = pageMetrics(setup)
  const { first, rest } = contentsRowsPerPage(setup)
  const pages = []
  let index = 0
  while (index < entries.length || !pages.length) {
    const page = newPage(setup, m, 'fm-contents')
    const box = textBox(setup, m, firstPhysical + pages.length)
    const list = document.createElement('div')
    list.className = 'fm-contents-list'
    Object.assign(list.style, { left: box.left, width: box.width, top: `${box.top}px` })
    if (!pages.length) list.appendChild(block('fm-contents-heading', 'Contents', {}))
    const rows = pages.length ? rest : first
    for (const entry of entries.slice(index, index + rows)) {
      const row = document.createElement('div')
      row.className = `fm-contents-row${entry.part ? ' is-part' : ''}`
      row.appendChild(block('fm-contents-title', entry.title, {}))
      if (!entry.part) {
        row.appendChild(block('fm-contents-leader', '', {}))
        row.appendChild(block('fm-contents-folio', entry.folio, {}))
      }
      list.appendChild(row)
    }
    page.appendChild(list)
    pages.push(page)
    index += rows
  }
  return pages
}

/**
 * The front matter's pages, title pages included, in order.
 *
 * `contents`: [{ title, folio }] for every chapter, or null for none. `titlePages` are
 * titlePage.js's, which already carry a blank back when the setup faces pages.
 */
export const buildFrontMatterPages = ({ setup, book, title, titlePages = [], contents = null }) => {
  const front = book?.frontMatter || {}
  const m = pageMetrics(setup)
  const facing = Boolean(setup.mirrorMargins)
  const pages = []
  const blank = () => newPage(setup, m, 'is-blank')
  /** Start the next page on a recto. */
  const toRecto = () => {
    if (facing && pages.length % 2 === 1) pages.push(blank())
  }

  if (front.halfTitle && title) {
    pages.push(halfTitlePage(setup, pages.length + 1, title))
    if (facing) pages.push(blank())
  }

  toRecto()
  const titles = [...titlePages]
  const copyright = (front.copyright || '').trim()
  const copyrightPage = () => {
    const page = newPage(setup, m, 'fm-copyright')
    const box = textBox(setup, m, pages.length + 1)
    page.appendChild(block('fm-copyright-text', copyright, {
      left: box.left, width: box.width, bottom: `${m.height - box.top - box.height}px`,
    }))
    return page
  }
  if (copyright && facing && titles.length === 2) {
    // The title page's blank back is where the copyright goes.
    pages.push(titles[0])
    pages.push(copyrightPage())
  } else {
    pages.push(...titles)
    if (copyright) pages.push(copyrightPage())
  }

  const dedication = (front.dedication || '').trim()
  if (dedication) {
    toRecto()
    const page = newPage(setup, m, 'fm-dedication')
    const box = textBox(setup, m, pages.length + 1)
    page.appendChild(block('fm-center fm-dedication-text', dedication, { left: box.left, width: box.width, top: `${box.top + box.height * 0.28}px` }))
    pages.push(page)
  }

  const epigraph = (front.epigraph || '').trim()
  if (epigraph) {
    toRecto()
    const page = newPage(setup, m, 'fm-epigraph')
    const box = textBox(setup, m, pages.length + 1)
    const wrap = document.createElement('div')
    wrap.className = 'fm-epigraph-wrap'
    Object.assign(wrap.style, { left: box.left, width: box.width, top: `${box.top + box.height * 0.28}px` })
    wrap.appendChild(block('fm-epigraph-text', epigraph, {}))
    const source = (front.epigraphSource || '').trim()
    if (source) wrap.appendChild(block('fm-epigraph-source', `— ${source}`, {}))
    page.appendChild(wrap)
    pages.push(page)
  }

  if (contents?.length) {
    toRecto()
    pages.push(...contentsPages(setup, contents, pages.length + 1))
  }

  // The body's first page is a recto.
  if (facing && pages.length % 2 === 1) pages.push(blank())
  return pages
}
