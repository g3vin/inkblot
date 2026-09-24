/**
 * paginate.ts — where the pages break. Pure: measured geometry in, pushes out.
 *
 * The document is laid out as one continuous flow. Pagination does not move
 * content between containers; it *pushes* it down, so a line or block that would
 * cross the foot of a page starts instead at the head of the next one. The flow is
 * cut into **slots** — the text block of one page, or of one column of one page —
 * spaced `stride` apart, and every push is the distance from where a unit would
 * naturally fall to the top of the next slot.
 *
 * Input is **natural** geometry: where each unit sits with no pushes applied (the
 * measurer subtracts the pushes it finds). That is what makes one pass enough —
 * every decision depends only on what is above it plus the unit itself, so applying
 * the result cannot change the input and the layout never oscillates.
 *
 * Units are the leaves a break can fall between or inside, in document order:
 *   text   a textblock. `lines` are its line boxes; a break can fall before any
 *          line but the first. A float, or an inline image, merges the lines beside
 *          it into one line box, so it is never split.
 *   atom   something unbreakable: an image block, a Pinterest board, a conversation.
 *   row    one table row; a table breaks only between rows.
 *   break  a manual page, column or recto break; the next unit starts after it.
 */

export type ManualBreakKind = 'page' | 'column' | 'recto'

export interface LayoutLine {
  /** Natural top and bottom, in flow px. */
  top: number
  bottom: number
  /** Document position of the line's first character: where a line push goes. */
  pos: number
}

export interface LayoutUnit {
  kind: 'text' | 'atom' | 'row' | 'break'
  /** Document position of the unit's node: where a block push goes. */
  pos: number
  /** Natural content top and bottom, in flow px. */
  top: number
  bottom: number
  lines?: LayoutLine[]
  /** Headings: never the last thing on a page. */
  keepWithNext?: boolean
  breakKind?: ManualBreakKind
}

export interface LayoutFrame {
  /** Height of one slot: the page's text block. */
  slotHeight: number
  /** Distance from one slot's top to the next's, in flow px. */
  stride: number
  /** Slots per page: the column count. */
  columns: number
  /** Minimum lines of a split paragraph at a page's foot and head. */
  minLines: number
}

export interface Push {
  /** `block` pushes a unit's whole content; `line` pushes a paragraph from one line on. */
  kind: 'block' | 'line'
  pos: number
  height: number
}

export interface LayoutResult {
  pushes: Push[]
  /** Slots used, including any blank ones a recto break skipped. */
  slotCount: number
  /** Pages used: slotCount rounded up to whole pages. */
  pageCount: number
  /**
   * The document position each slot starts at, or null for a slot left blank (the
   * verso a recto break skipped). Index is the slot number.
   */
  slotStarts: Array<number | null>
  /** Slots whose content starts after a manual recto/page break or at the document start. */
  chapterStartSlots: number[]
}

/** Layout tolerance, px. Measured rects carry subpixel noise; half a pixel is not a line. */
const EPS = 0.5

export const paginate = (units: LayoutUnit[], frame: LayoutFrame): LayoutResult => {
  const { slotHeight, stride } = frame
  const columns = Math.max(1, Math.floor(frame.columns))
  const minLines = Math.max(1, Math.floor(frame.minLines))

  const slotTop = (s: number) => s * stride
  const slotBottom = (s: number) => s * stride + slotHeight

  const pushes: Push[] = []
  const slotStarts: Array<number | null> = [0]
  const chapterStartSlots: number[] = [0]
  let offset = 0
  let slot = 0
  let forced: ManualBreakKind | null = null
  // Whether the current slot holds anything yet. A unit at the head of its slot is
  // never pushed: it has nowhere better to go, and pushing it would loop forever.
  let slotHasContent = false

  const markSlot = (s: number, pos: number | null) => {
    while (slotStarts.length <= s) slotStarts.push(null)
    if (slotStarts[s] == null) slotStarts[s] = pos
  }

  /** The slot a forced break moves to, from the current one. */
  const slotAfterBreak = (kind: ManualBreakKind): number => {
    if (kind === 'column') return slot + 1
    const nextPage = Math.floor(slot / columns) + 1
    if (kind === 'page') return nextPage * columns
    // Recto: the next odd physical page, i.e. an even page index.
    return (nextPage % 2 === 0 ? nextPage : nextPage + 1) * columns
  }

  /** Push unit `u` so its content starts at the top of slot `target`. */
  const pushBlockTo = (u: LayoutUnit, target: number) => {
    const height = slotTop(target) - (u.top + offset)
    if (height > EPS) {
      pushes.push({ kind: 'block', pos: u.pos, height })
      offset += height
    }
    slot = target
    slotHasContent = false
  }

  /** Whether the first lines a unit must keep together fit in the current slot. */
  const headFits = (u: LayoutUnit | undefined): boolean => {
    if (!u || u.kind === 'break') return true
    const bottom = slotBottom(slot)
    if (u.kind === 'text' && u.lines && u.lines.length > 1) {
      const need = u.lines[Math.min(minLines, u.lines.length) - 1]
      return need.bottom + offset <= bottom + EPS
    }
    return u.bottom + offset <= bottom + EPS
  }

  for (let i = 0; i < units.length; i += 1) {
    const u = units[i]

    if (u.kind === 'break') {
      forced = u.breakKind || 'page'
      continue
    }

    if (forced) {
      const target = slotAfterBreak(forced)
      pushBlockTo(u, target)
      if (forced !== 'column') chapterStartSlots.push(target)
      forced = null
    } else if (u.top + offset >= slotBottom(slot) - EPS) {
      // It starts in the gap below this slot — after an oversized atom ran past the
      // foot — so it opens the next slot that is below it.
      let target = slot + 1
      while (u.top + offset > slotBottom(target) - EPS) target += 1
      pushBlockTo(u, target)
    }

    // Keep-with-next: a heading whose follower cannot start on this page goes over
    // with it. Runs of headings (a part title over a chapter title) move together.
    if (u.keepWithNext && slotHasContent) {
      let j = i
      while (units[j + 1]?.keepWithNext) j += 1
      const groupBottom = units[j].bottom + offset
      if (groupBottom > slotBottom(slot) + EPS || !headFits(units[j + 1])) {
        pushBlockTo(u, slot + 1)
      }
    }

    markSlot(slot, u.pos)

    // Place the unit, splitting a paragraph across as many slots as it needs.
    let firstLine = 0
    for (;;) {
      const bottom = slotBottom(slot)
      if (u.bottom + offset <= bottom + EPS) break

      const lines = u.kind === 'text' ? u.lines || [] : []
      const remaining = lines.length - firstLine
      if (remaining > 1) {
        // First line that does not fit.
        let j = firstLine
        while (j < lines.length && lines[j].bottom + offset <= bottom + EPS) j += 1
        const atHead = firstLine > 0 || !slotHasContent
        // Orphans: too few lines would be left at the foot.
        if (j - firstLine < minLines && !atHead) {
          pushBlockTo(u, slot + 1)
          markSlot(slot, u.pos)
          continue
        }
        // Widows: too few lines would be carried to the head.
        if (lines.length - j < minLines && j - firstLine > minLines) {
          j = Math.max(firstLine + minLines, lines.length - minLines)
        }
        if (j <= firstLine) j = firstLine + 1
        if (j >= lines.length) break
        const height = slotTop(slot + 1) - (lines[j].top + offset)
        if (height > EPS) {
          pushes.push({ kind: 'line', pos: lines[j].pos, height })
          offset += height
        }
        slot += 1
        slotHasContent = true
        markSlot(slot, lines[j].pos)
        firstLine = j
        continue
      }

      // Unbreakable (or down to one line). Move it to the next slot, unless it
      // already heads this one — then it is taller than a page, and overflows.
      if (slotHasContent && firstLine === 0) {
        pushBlockTo(u, slot + 1)
        markSlot(slot, u.pos)
        continue
      }
      break
    }
    slotHasContent = true
  }

  // A trailing manual break still opens its page, so the author sees it.
  if (forced) {
    const target = slotAfterBreak(forced)
    markSlot(target, null)
    slot = target
  }

  const slotCount = Math.max(slot + 1, slotStarts.length)
  const pageCount = Math.max(1, Math.ceil(slotCount / columns))
  return { pushes, slotCount, pageCount, slotStarts, chapterStartSlots }
}
