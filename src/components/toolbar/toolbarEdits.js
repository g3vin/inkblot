/**
 * toolbarEdits.js — what a drag in Customize Toolbar does to a layout, and how a
 * layout's pages fit the row. Pure.
 *
 * A drag comes from the toolbar itself (by its index there: a spacer can appear more
 * than once, so an item is not its id) or from the palette (by id). It ends inside
 * the toolbar at an insertion index — counted among the items left once the dragged
 * one is lifted out — or outside it. The toolbar shows one page at a time, so a drag
 * is made on a page (`applyPageDrop`), its indexes that page's.
 */
import { PAGE, isSpacer, pagesOf } from '../../lib/chromeLayout'

export function applyToolbarDrop(items, { source, inside, index }) {
  if (source.kind === 'toolbar') {
    const moved = items[source.index]
    if (moved === undefined) return items
    const rest = items.filter((_, i) => i !== source.index)
    if (!inside) return rest
    rest.splice(clampIndex(index, rest.length), 0, moved)
    return rest
  }

  if (source.kind === 'defaults') return inside ? [...source.items] : items

  const id = source.id
  if (!inside) return items
  if (isSpacer(id)) {
    const next = [...items]
    next.splice(clampIndex(index, next.length), 0, id)
    return next
  }
  const existing = items.indexOf(id)
  const rest = existing === -1 ? [...items] : items.filter((_, i) => i !== existing)
  rest.splice(clampIndex(index, rest.length), 0, id)
  return rest
}

const clampIndex = (index, length) => Math.max(0, Math.min(Number.isFinite(index) ? index : length, length))

/** Items the palette dims: those already in the toolbar, which can appear only once. */
export const inToolbar = (items, id) => !isSpacer(id) && id !== PAGE && items.includes(id)

const joinPages = (pages) => pages.flatMap((page, index) => (index ? [PAGE, ...page] : page))

/**
 * A drag that ends on page `page` (it may be one past the last: a page being made). An
 * item brought in from the palette that is on another page leaves it; a page break
 * dropped in splits the page there.
 */
export function applyPageDrop(items, page, drop) {
  if (drop.source.kind === 'defaults') return applyToolbarDrop(items, drop)
  const pages = pagesOf(items)
  while (pages.length <= page) pages.push([])
  const { source } = drop
  if (source.kind === 'palette' && !isSpacer(source.id) && source.id !== PAGE) {
    pages.forEach((other, i) => { if (i !== page) pages[i] = other.filter((id) => id !== source.id) })
  }
  pages[page] = applyToolbarDrop(pages[page], drop)
  return joinPages(pages)
}

/** The item at `index` on page `from`, moved to the end of page `to`. */
export function moveToPage(items, from, index, to) {
  const pages = pagesOf(items)
  if (from === to || pages[from]?.[index] === undefined) return items
  while (pages.length <= to) pages.push([])
  const [moved] = pages[from].splice(index, 1)
  pages[to].push(moved)
  return joinPages(pages)
}

/** Page `page` taken out, what it held joining the page before it (or after, for the first). */
export function removePage(items, page) {
  const pages = pagesOf(items)
  if (pages.length < 2 || !pages[page]) return items
  const [removed] = pages.splice(page, 1)
  const into = Math.max(0, page - 1)
  pages[into] = page === 0 ? [...removed, 'space', ...pages[into]] : [...pages[into], 'space', ...removed]
  return joinPages(pages)
}

/**
 * How many of a page's slots fit, from the front. Flexible spaces give way first — they
 * take no room of their own.
 */
export function fittingCount(widths, available, gap) {
  let used = 0
  for (let i = 0; i < widths.length; i += 1) {
    used += widths[i] + (i ? gap : 0)
    if (used > available) return i
  }
  return widths.length
}

/**
 * A page too wide for the row, as the runs of its slots that each fit: `[start, end)`
 * pairs. Every run holds at least one slot, so a slot wider than the row still shows.
 */
export function fitPage(widths, available, gap) {
  const runs = []
  let start = 0
  while (start < widths.length) {
    const count = Math.max(1, fittingCount(widths.slice(start), available, gap))
    runs.push([start, start + count])
    start += count
  }
  return runs.length ? runs : [[0, 0]]
}

/**
 * The slots to set aside while a choice is open in place beside slot `opener`, `extra`
 * wider than it was: those after it first, from the end, then those before it, from
 * the start, until the rest fit. The opener itself always stays.
 */
export function pushedAside(widths, opener, extra, available, gap) {
  const aside = new Set()
  let total = widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, widths.length - 1) + extra
  const order = [
    ...widths.map((_, i) => i).filter((i) => i > opener).reverse(),
    ...widths.map((_, i) => i).filter((i) => i < opener),
  ]
  for (const i of order) {
    if (total <= available) break
    aside.add(i)
    total -= widths[i] + gap
  }
  return aside
}
