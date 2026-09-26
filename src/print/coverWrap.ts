/**
 * coverWrap.ts — a printed book's cover: the full wrap, and what a printer asks of it.
 *
 * KDP and IngramSpark both take a paperback's cover as one PDF: back, spine and front
 * side by side, with bleed on every outside edge —
 *
 *   width   bleed + back (the trim's width) + spine + front (the trim's width) + bleed
 *   height  bleed + the trim's height + bleed
 *
 * where the bleed is ⅛ inch and the spine's width comes from the page count and the
 * paper (`spineWidthMm`, preflight.ts). Pictures should be 300 dots to the inch at the
 * size they print. The spine takes text only from 80 pages; the barcode sits bottom
 * right of the back, about 2 × 1.2 inches, and text keeps ⅛ inch inside the trim.
 *
 * The app does not design covers: it takes the author's pictures — a front, a back and
 * a spine, or one wrap across all three — fits them to the parts, checks them against
 * those rules, and lays out the one page the PDF is made from (`coverPage`).
 */
import { CoverFit, PreflightSeverity } from '../types'
import type { CoverSet, PreflightIssue } from '../types'
import { mmToPx } from './pageSizes'
import { SPINE_TEXT_MIN_PAGES } from './preflight'

export const BLEED_MM = 3.175
const MM_PER_INCH = 25.4
/** Keep text this far inside the trim. */
export const SAFE_MM = 3.175
/** Keep the spine's text this far from each fold. */
export const SPINE_CLEAR_MM = 1.5875
/** The barcode's box on the back, bottom right: 2 × 1.2 inches. */
export const BARCODE_MM = { width: 50.8, height: 30.48, inset: 6.35 }
/** An e-book's cover is taller than it is wide by this much. */
export const EBOOK_RATIO = 1.6

export interface WrapGeometry {
  trimWidthMm: number
  trimHeightMm: number
  spineWidthMm: number
  bleedMm: number
  wrapWidthMm: number
  wrapHeightMm: number
  /** Where each part is across the wrap, from its left edge, in mm. */
  back: { x: number; width: number }
  spine: { x: number; width: number }
  front: { x: number; width: number }
}

export const wrapGeometry = (trimWidthMm: number, trimHeightMm: number, spineWidthMm: number, bleedMm = BLEED_MM): WrapGeometry => {
  const spine = Math.max(0, spineWidthMm)
  return {
    trimWidthMm,
    trimHeightMm,
    spineWidthMm: spine,
    bleedMm,
    wrapWidthMm: bleedMm * 2 + trimWidthMm * 2 + spine,
    wrapHeightMm: bleedMm * 2 + trimHeightMm,
    back: { x: 0, width: bleedMm + trimWidthMm },
    spine: { x: bleedMm + trimWidthMm, width: spine },
    front: { x: bleedMm + trimWidthMm + spine, width: trimWidthMm + bleedMm },
  }
}

export interface PictureSize { width: number; height: number }

const dpi = (pixels: number, mm: number) => (mm > 0 ? (pixels / mm) * MM_PER_INCH : Infinity)

/**
 * What stands between a cover version and the printer: its pictures' resolution, the
 * spine it was made for, an e-book front's shape. `sizes` are the pictures' pixel sizes,
 * by part, where known.
 */
export const coverChecks = ({
  set,
  geometry,
  pageCount,
  sizes,
}: {
  set: CoverSet | null
  geometry: WrapGeometry
  pageCount: number
  sizes: Partial<Record<'front' | 'back' | 'spine' | 'wrap', PictureSize | null>>
}): PreflightIssue[] => {
  const issues: PreflightIssue[] = []
  const warn = (id: string, message: string, severity = PreflightSeverity.Warning) => issues.push({ id, severity, message })
  if (!set || !(set.front || set.wrap)) {
    warn('cover-none', 'The book has no cover yet. Drop a front, or one picture across the whole wrap.', PreflightSeverity.Note)
    return issues
  }
  if (!pageCount) {
    warn('cover-count', 'Count the pages (under Publishing) to size the spine and the wrap.', PreflightSeverity.Note)
  }
  const check = (part: 'front' | 'back' | 'spine' | 'wrap', widthMm: number, heightMm: number, name: string) => {
    const size = sizes[part]
    if (!set[part] || !size) return
    const low = Math.min(dpi(size.width, widthMm), dpi(size.height, heightMm))
    if (low < 300) warn(`cover-dpi-${part}`, `The ${name} prints at ${Math.round(low)} dots per inch; printers ask for 300. It may look soft.`)
  }
  const h = geometry.wrapHeightMm
  if (set.wrap) {
    check('wrap', geometry.wrapWidthMm, h, 'wrap')
    const size = sizes.wrap
    if (size && Math.abs(size.width / size.height - geometry.wrapWidthMm / h) > 0.03) {
      warn('cover-wrap-shape', `The wrap picture is not the wrap’s shape (${geometry.wrapWidthMm.toFixed(1)} × ${h.toFixed(1)} mm): it is ${set.fit === CoverFit.Fill ? 'cropped' : set.fit === CoverFit.Fit ? 'fitted with a border' : 'stretched'} to fit.`, PreflightSeverity.Note)
    }
  } else {
    check('front', geometry.front.width, h, 'front')
    check('back', geometry.back.width, h, 'back')
    check('spine', geometry.spine.width, h, 'spine')
    if (!set.back) warn('cover-back', 'There is no back cover: it prints blank.', PreflightSeverity.Note)
    if (!set.spine && geometry.spineWidthMm > 0) warn('cover-spine', 'There is no spine picture: it prints blank.', PreflightSeverity.Note)
  }
  if ((set.spine || set.wrap) && pageCount > 0 && pageCount < SPINE_TEXT_MIN_PAGES) {
    warn('cover-spine-text', `At ${pageCount} pages the spine is too thin for text: printers print none under ${SPINE_TEXT_MIN_PAGES} pages. Keep it plain.`, PreflightSeverity.Note)
  }
  if ((set.spine || set.wrap) && set.madeForSpineMm && geometry.spineWidthMm > 0 &&
    Math.abs(set.madeForSpineMm - geometry.spineWidthMm) > 0.5) {
    warn('cover-spine-changed', `The page count has changed: the spine is now ${geometry.spineWidthMm.toFixed(1)} mm, and the cover was made for ${set.madeForSpineMm.toFixed(1)} mm.`)
  }
  const front = sizes.front
  if (set.front && front) {
    if (Math.abs(front.height / front.width - EBOOK_RATIO) > 0.08) {
      warn('cover-ebook-shape', `As an e-book cover the front is best 1.6 times as tall as it is wide (2560 × 1600); this is ${front.width} × ${front.height}.`, PreflightSeverity.Note)
    }
    if (Math.min(front.width, front.height) < 1000) {
      warn('cover-ebook-size', 'As an e-book cover the front is small: stores ask for at least 1000 pixels on its short side.')
    }
  }
  return issues
}

/** How a picture sits in its box, as CSS `object-fit`. */
const objectFit = (fit: CoverFit) => (fit === CoverFit.Fit ? 'contain' : fit === CoverFit.Stretch ? 'fill' : 'cover')

/**
 * The full wrap as one page, at its size in px: each part's picture fitted to it, or the
 * wrap's across it all. `urls` are the pictures as the page can load them.
 */
export const coverPage = (geometry: WrapGeometry, set: CoverSet, urls: Partial<Record<'front' | 'back' | 'spine' | 'wrap', string>>): HTMLElement => {
  const page = document.createElement('div')
  page.className = 'print-page print-cover'
  Object.assign(page.style, {
    width: `${mmToPx(geometry.wrapWidthMm)}px`,
    height: `${mmToPx(geometry.wrapHeightMm)}px`,
    background: '#ffffff',
    position: 'relative',
    overflow: 'hidden',
  })
  const place = (url: string | undefined, x: number, width: number) => {
    if (!url) return
    const img = document.createElement('img')
    img.src = url
    img.alt = ''
    Object.assign(img.style, {
      position: 'absolute',
      left: `${mmToPx(x)}px`,
      top: '0',
      width: `${mmToPx(width)}px`,
      height: `${mmToPx(geometry.wrapHeightMm)}px`,
      objectFit: objectFit(set.fit || CoverFit.Fill),
    })
    page.appendChild(img)
  }
  if (set.wrap) {
    place(urls.wrap, 0, geometry.wrapWidthMm)
  } else {
    place(urls.back, geometry.back.x, geometry.back.width)
    if (geometry.spine.width > 0) place(urls.spine, geometry.spine.x, geometry.spine.width)
    place(urls.front, geometry.front.x, geometry.front.width)
  }
  return page
}
