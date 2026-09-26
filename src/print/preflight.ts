/**
 * preflight.ts — a book checked against a print-on-demand service's rules before it
 * is sent: the trim size, the margins a book of its length needs, its page count,
 * its pictures' resolution — and how wide its spine will be, for the cover.
 *
 * Pure functions over the setup and the figures, so the Publish tab can show them as
 * they change and the tests can pin them. The figures are the services' published
 * ones (KDP's and IngramSpark's paperback guides); they change from time to time, so
 * every message says "about" where it should, and the tab says to check the service's
 * own calculator before the cover goes out.
 */
import { PageOrientation, PaperStock, PreflightSeverity, PublishingService } from '../types'
import type { PageSetup, PreflightIssue, PublishingTarget } from '../types'
import { normalizePageSetup, suggestedInsideMarginMm } from './pageSetup'

const INCH = 25.4

/** Paper thickness per page, in inches: what the services' spine calculators use. */
const PAGE_THICKNESS_IN: Record<PublishingService, Record<PaperStock, number>> = {
  [PublishingService.None]: { [PaperStock.Cream]: 0.0025, [PaperStock.White]: 0.002252, [PaperStock.Color]: 0.002347 },
  [PublishingService.Kdp]: { [PaperStock.Cream]: 0.0025, [PaperStock.White]: 0.002252, [PaperStock.Color]: 0.002347 },
  [PublishingService.IngramSpark]: { [PaperStock.Cream]: 0.0025, [PaperStock.White]: 0.0022, [PaperStock.Color]: 0.0026 },
}

/** Paperback trim sizes each service prints, in inches (width × height). */
const TRIMS: Record<Exclude<PublishingService, PublishingService.None>, Array<[number, number]>> = {
  [PublishingService.Kdp]: [
    [5, 8], [5.06, 7.81], [5.25, 8], [5.5, 8.5], [6, 9], [6.14, 9.21], [6.69, 9.61], [7, 10], [7.44, 9.69],
    [7.5, 9.25], [8, 10], [8.25, 6], [8.25, 8.25], [8.5, 8.5], [8.5, 11], [8.27, 11.69],
  ],
  [PublishingService.IngramSpark]: [
    [4, 6], [4.25, 7], [4.37, 7], [5, 8], [5.06, 7.81], [5.25, 8], [5.5, 8.25], [5.5, 8.5], [5.83, 8.27], [6, 9],
    [6.14, 9.21], [6.69, 9.61], [7, 10], [7.44, 9.69], [7.5, 9.25], [8, 10], [8.25, 11], [8.5, 8.5], [8.5, 11], [8.27, 11.69],
  ],
}

const PAGE_LIMITS: Record<Exclude<PublishingService, PublishingService.None>, { min: number; max: Record<PaperStock, number> }> = {
  [PublishingService.Kdp]: { min: 24, max: { [PaperStock.Cream]: 776, [PaperStock.White]: 828, [PaperStock.Color]: 828 } },
  [PublishingService.IngramSpark]: { min: 18, max: { [PaperStock.Cream]: 1100, [PaperStock.White]: 1200, [PaperStock.Color]: 1200 } },
}

export const SERVICE_NAMES: Record<PublishingService, string> = {
  [PublishingService.None]: '',
  [PublishingService.Kdp]: 'KDP',
  [PublishingService.IngramSpark]: 'IngramSpark',
}

/** The least margin a service allows at the edges of a page, in mm (¼ in, no bleed). */
export const MIN_OUTER_MARGIN_MM = 0.25 * INCH
/** KDP puts text on a spine only past this many pages. */
export const SPINE_TEXT_MIN_PAGES = 80

/** How wide a book's spine is, in mm: its pages, two to a leaf, at the paper's thickness. */
export const spineWidthMm = ({ pageCount, paper = PaperStock.Cream, service = PublishingService.Kdp }: {
  pageCount: number
  paper?: PaperStock
  service?: PublishingService
}): number => Math.max(0, pageCount) * PAGE_THICKNESS_IN[service][paper] * INCH

/** Reading time at 250 words a minute, the usual adult silent-reading pace. */
export const readingMinutes = (words: number): number => Math.round(Math.max(0, words) / 250)

const trimOf = (setup: PageSetup): [number, number] => {
  const landscape = setup.orientation === PageOrientation.Landscape
  return [(landscape ? setup.heightMm : setup.widthMm) / INCH, (landscape ? setup.widthMm : setup.heightMm) / INCH]
}

const fmtIn = (inches: number): string => `${Math.round(inches * 100) / 100}″`

/** The listed trim nearest a page, by how far each edge would move. */
export const nearestTrim = (service: Exclude<PublishingService, PublishingService.None>, setup: PageSetup): [number, number] => {
  const [w, h] = trimOf(setup)
  return TRIMS[service].reduce((best, trim) => (
    Math.abs(trim[0] - w) + Math.abs(trim[1] - h) < Math.abs(best[0] - w) + Math.abs(best[1] - h) ? trim : best
  ))
}

/** An image in the document, as placed: its pixels and how wide it prints, in inches. */
export interface PlacedImage { pixelsWide: number; printedInches: number }

/**
 * What stands between this setup and the service printing it. Each issue carries the
 * setup with the fix made, where there is one to make.
 */
export const preflight = ({ setup: input, target, pageCount, images = [] }: {
  setup: PageSetup
  target: PublishingTarget
  pageCount: number
  images?: PlacedImage[]
}): PreflightIssue[] => {
  const service = target.service
  if (service === PublishingService.None) return []
  const setup = normalizePageSetup(input)
  const name = SERVICE_NAMES[service]
  const issues: PreflightIssue[] = []
  const fixed = (change: (s: PageSetup) => PageSetup): PageSetup => ({ ...change(structuredClone(setup)), formatId: setup.formatId })

  const [w, h] = trimOf(setup)
  const listed = TRIMS[service].some(([tw, th]) => Math.abs(tw - w) < 0.02 && Math.abs(th - h) < 0.02)
  if (!listed) {
    const [nw, nh] = nearestTrim(service, setup)
    issues.push({
      id: 'trim',
      severity: PreflightSeverity.Error,
      message: `${name} does not print ${fmtIn(w)} × ${fmtIn(h)} paperbacks. The nearest size it does is ${fmtIn(nw)} × ${fmtIn(nh)}.`,
      fixLabel: `Use ${fmtIn(nw)} × ${fmtIn(nh)}`,
      fixedSetup: fixed((s) => ({
        ...s,
        presetId: 'custom',
        orientation: PageOrientation.Portrait,
        widthMm: Math.round(nw * INCH * 1000) / 1000,
        heightMm: Math.round(nh * INCH * 1000) / 1000,
      })),
    })
  }

  if (!setup.mirrorMargins) {
    issues.push({
      id: 'mirror',
      severity: PreflightSeverity.Warning,
      message: 'A printed book has facing pages: the inside margin should be on the binding side of each.',
      fixLabel: 'Use Facing Pages',
      fixedSetup: fixed((s) => ({ ...s, mirrorMargins: true })),
    })
  }

  if (pageCount > 0) {
    const inside = setup.margins.insideMm + setup.margins.gutterMm
    const needed = suggestedInsideMarginMm(pageCount)
    if (inside + 0.05 < needed) {
      issues.push({
        id: 'gutter',
        severity: PreflightSeverity.Error,
        message: `At ${pageCount} pages, ${name} needs an inside margin of at least ${fmtIn(needed / INCH)}; this one is ${fmtIn(inside / INCH)}.`,
        fixLabel: 'Widen the Gutter',
        fixedSetup: fixed((s) => ({ ...s, margins: { ...s.margins, gutterMm: Math.round((needed - s.margins.insideMm) * 1000) / 1000 } })),
      })
    }
    const limits = PAGE_LIMITS[service]
    const max = limits.max[target.paper]
    if (pageCount < limits.min) {
      issues.push({ id: 'pages-min', severity: PreflightSeverity.Error, message: `${name} prints paperbacks of at least ${limits.min} pages; this is ${pageCount}.` })
    } else if (pageCount > max) {
      issues.push({ id: 'pages-max', severity: PreflightSeverity.Error, message: `${name} prints about ${max} pages at most on this paper; this is ${pageCount}. A larger trim or smaller type would take fewer.` })
    }
    if (pageCount % 2 === 1) {
      issues.push({ id: 'odd', severity: PreflightSeverity.Note, message: `The book has an odd number of pages; ${name} adds a blank one at the end.` })
    }
  }

  const edges = ['topMm', 'bottomMm', 'outsideMm'] as const
  const thin = edges.filter((edge) => setup.margins[edge] + 0.05 < MIN_OUTER_MARGIN_MM)
  if (thin.length) {
    issues.push({
      id: 'edges',
      severity: PreflightSeverity.Error,
      message: `${name} needs at least ¼″ of margin at the top, bottom and outside edge, or the trim can cut into the text.`,
      fixLabel: 'Widen to ¼″',
      fixedSetup: fixed((s) => ({ ...s, margins: { ...s.margins, ...Object.fromEntries(thin.map((edge) => [edge, MIN_OUTER_MARGIN_MM])) } })),
    })
  }

  const blurry = images.filter((img) => img.printedInches > 0 && img.pixelsWide / img.printedInches < 300)
  if (blurry.length) {
    const worst = Math.min(...blurry.map((img) => Math.round(img.pixelsWide / img.printedInches)))
    issues.push({
      id: 'dpi',
      severity: PreflightSeverity.Warning,
      message: `${blurry.length === 1 ? 'A picture prints' : `${blurry.length} pictures print`} at under 300 dots per inch (as low as ${worst}), and may look soft. Use a larger image, or place it smaller.`,
    })
  }
  return issues
}
