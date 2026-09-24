/**
 * imposition.ts — laying a book's pages out on sheets so that, printed double-sided,
 * folded and bound, they read in order.
 *
 * A **sheet** carries four pages: two side by side on its front, two on its back.
 * Folded in half it is a **folio**; folios nested inside one another and sewn
 * through the fold are a **signature** (a gathering). A book is a stack of them.
 *
 * Signature size is the binder's choice, and it trades thickness against strength:
 * each extra folio adds a sheet's thickness at the fold and pushes the innermost
 * pages further out at the fore-edge (creep). Hand binders mostly sew four folios
 * (16 pages) of ordinary 20–24lb / 75–90gsm paper; heavier stock wants three,
 * thin or bible paper takes six to eight, and a single signature of every page is
 * a saddle-stitched booklet. Offset printers impose 16- and 32-page signatures.
 *
 * Page numbers here are 1-based physical pages; 0 is a blank added to fill the
 * last signature.
 */

export type BindingType = 'signatures' | 'saddle' | 'perfect'

export interface SignatureGuidance {
  sheets: number
  label: string
}

/** Shown beside the "sheets per signature" control. */
export const SIGNATURE_GUIDANCE: SignatureGuidance[] = [
  { sheets: 3, label: 'Heavy paper (28–32 lb / 105–120 gsm): 3 sheets, 12 pages' },
  { sheets: 4, label: 'Standard for hand binding (20–24 lb / 75–90 gsm): 4 sheets, 16 pages' },
  { sheets: 5, label: 'Lighter text paper: 5 sheets, 20 pages' },
  { sheets: 6, label: 'Thin paper: 6 sheets, 24 pages' },
  { sheets: 8, label: 'Bible / onion-skin paper, or offset 32-pagers: 8 sheets, 32 pages' },
]

export const DEFAULT_SHEETS_PER_SIGNATURE = 4
export const MAX_SHEETS_PER_SIGNATURE = 8

export interface SheetSide {
  /** The page on the left half and the right half; 0 is blank. */
  left: number
  right: number
}

export interface ImposedSheet {
  /** 1-based signature, and this sheet's 0-based place in it from the outside. */
  signature: number
  indexInSignature: number
  front: SheetSide
  back: SheetSide
  /**
   * Creep compensation for this sheet's pages, in mm: how far to shift each page's
   * content toward the spine. Zero for the outermost sheet.
   */
  creepMm: number
}

export interface Imposition {
  binding: BindingType
  sheets: ImposedSheet[]
  /** Pages after padding: a multiple of the signature size. */
  paddedPageCount: number
  blanksAdded: number
  pagesPerSignature: number
}

export interface ImpositionOptions {
  binding: BindingType
  /** Folios per signature, for `signatures`. Ignored for saddle and perfect. */
  sheetsPerSignature?: number
  /** Sheet (paper) thickness in mm; 0.1mm is ordinary 20lb bond. For creep. */
  paperThicknessMm?: number
}

/**
 * The page pairs of one signature of `n` pages (n a multiple of 4), numbered from
 * `first`. Sheet i (0 = outermost) carries, front: [last − 2i, first + 2i] and
 * back: [first + 2i + 1, last − 2i − 1] — so a 4-page folio is front 4|1, back 2|3,
 * and folded, it reads 1, 2, 3, 4.
 */
export const signatureSheets = (first: number, n: number): Array<{ front: SheetSide; back: SheetSide }> => {
  const last = first + n - 1
  const out = []
  for (let i = 0; i < n / 4; i += 1) {
    out.push({
      front: { left: last - 2 * i, right: first + 2 * i },
      back: { left: first + 2 * i + 1, right: last - 2 * i - 1 },
    })
  }
  return out
}

export const imposePages = (pageCount: number, options: ImpositionOptions): Imposition => {
  const binding = options.binding
  const thickness = Math.max(0, options.paperThicknessMm ?? 0.1)
  const count = Math.max(1, Math.floor(pageCount))

  if (binding === 'perfect') {
    // Perfect binding cuts every leaf apart and glues the spine, so pages stay in
    // reading order: each sheet is two leaves side by side, printed recto then verso.
    // (1|3 on the front and 2|4 on the back cut into leaves 1–2 and 3–4.)
    const padded = Math.ceil(count / 4) * 4
    const sheets: ImposedSheet[] = []
    for (let p = 1, s = 0; p <= padded; p += 4, s += 1) {
      sheets.push({
        signature: s + 1,
        indexInSignature: 0,
        front: { left: p, right: p + 2 },
        // Duplex flips on the short edge: the back of the left half is behind the right.
        back: { left: p + 3, right: p + 1 },
        creepMm: 0,
      })
    }
    return finish(binding, sheets, padded, count, 4)
  }

  const perSignature = binding === 'saddle'
    ? Math.ceil(count / 4) * 4
    : 4 * Math.min(MAX_SHEETS_PER_SIGNATURE, Math.max(1, Math.floor(options.sheetsPerSignature || DEFAULT_SHEETS_PER_SIGNATURE)))
  const padded = Math.ceil(count / perSignature) * perSignature

  const sheets: ImposedSheet[] = []
  for (let first = 1, sig = 1; first <= padded; first += perSignature, sig += 1) {
    const pairs = signatureSheets(first, perSignature)
    pairs.forEach((pair, i) => {
      sheets.push({
        signature: sig,
        indexInSignature: i,
        ...pair,
        // Each folio wraps the ones inside it, so the innermost sheet's pages stick
        // out furthest at the fore-edge — by roughly one sheet thickness per folio
        // outside it. Its content moves that far toward the spine.
        creepMm: thickness * i,
      })
    })
  }
  return finish(binding, sheets, padded, count, perSignature)
}

const finish = (
  binding: BindingType,
  sheets: ImposedSheet[],
  padded: number,
  count: number,
  pagesPerSignature: number
): Imposition => {
  // Pages past the end are blanks.
  const blank = (p: number) => (p > count ? 0 : p)
  for (const sheet of sheets) {
    sheet.front = { left: blank(sheet.front.left), right: blank(sheet.front.right) }
    sheet.back = { left: blank(sheet.back.left), right: blank(sheet.back.right) }
  }
  return { binding, sheets, paddedPageCount: padded, blanksAdded: padded - count, pagesPerSignature }
}

export type DuplexMode = 'automatic' | 'manual'

/**
 * The order sheet sides go to the printer. Automatic duplex prints each sheet front
 * then back. Manual duplex prints every front, then — after the stack is turned
 * over and fed back in — every back in reverse, so the last front printed meets the
 * first back.
 */
export const printSequence = (
  imposition: Imposition,
  duplex: DuplexMode
): Array<{ sheet: number; side: 'front' | 'back' }> => {
  const n = imposition.sheets.length
  if (duplex === 'automatic') {
    return imposition.sheets.flatMap((_, i) => [
      { sheet: i, side: 'front' as const },
      { sheet: i, side: 'back' as const },
    ])
  }
  const fronts = imposition.sheets.map((_, i) => ({ sheet: i, side: 'front' as const }))
  const backs = Array.from({ length: n }, (_, k) => ({ sheet: n - 1 - k, side: 'back' as const }))
  return [...fronts, ...backs]
}

/** The folding guide: one line per sheet, in the order they are nested and sewn. */
export const foldingGuide = (imposition: Imposition): string[] => {
  const label = (p: number) => (p === 0 ? 'blank' : String(p))
  const lines: string[] = []
  let current = 0
  for (const sheet of imposition.sheets) {
    if (sheet.signature !== current) {
      current = sheet.signature
      lines.push(imposition.binding === 'perfect'
        ? `Sheet ${current}`
        : `Signature ${current}`)
    }
    if (imposition.binding === 'perfect') {
      lines.push(`  front ${label(sheet.front.left)} | ${label(sheet.front.right)} · back ${label(sheet.back.left)} | ${label(sheet.back.right)} — cut down the middle`)
    } else {
      lines.push(`  sheet ${sheet.indexInSignature + 1}: front ${label(sheet.front.left)} | ${label(sheet.front.right)} · back ${label(sheet.back.left)} | ${label(sheet.back.right)}`)
    }
  }
  return lines
}
