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
 *
 * A typesetter's own, set on a paragraph (ParagraphTypeset.ts, read by measure.ts):
 *   keepWithNext      as a heading
 *   split: 'never'    kept together
 *   pageAdjust        the slot it starts in runs that many lines long (+) or short (−)
 *
 * On a baseline grid (`frame.grid`), every paragraph starts on a whole line from its
 * slot's top: what came before it — a picture, a head — is rounded up to whole lines.
 *
 * Footnotes: a line whose marks have notes (`line.notes`, their height) takes that much
 * room — and, the first on its page, the rule over them (`frame.noteGap`) — from the
 * foot of the slot it lands in, so the notes set there fit below the text.
 *
 * A script adds rules of its own, carried on the units (measure.ts sets them):
 *   keepWithNext      a scene heading, a character, a parenthetical: never last on a page
 *   keepWithPrevious  a transition: never first on a page — the line before comes over
 *   split: 'never'    a parenthetical moves whole
 *   split: 'sentences' dialogue breaks only between sentences, with two lines or more on
 *                     each side; the page it leaves ends "(MORE)" and the next opens with
 *                     the speaker's name and "(CONT'D)" — `continuations` says where
 */

export type ManualBreakKind = 'page' | 'column' | 'recto'

export interface LayoutLine {
  /** Natural top and bottom, in flow px. */
  top: number
  bottom: number
  /** Document position of the line's first character: where a line push goes. */
  pos: number
  /** The height of the notes whose marks are on this line, set at its page's foot. */
  notes?: number
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
  /** A script's transition: never the first thing on a page. */
  keepWithPrevious?: boolean
  /** Where a text unit may break: between any lines (the default), only between
   * sentences, or not at all. */
  split?: 'lines' | 'sentences' | 'never'
  /** For `split: 'sentences'`: whether line `index` starts a sentence. */
  canBreakBefore?: (index: number) => boolean
  /** Dialogue split across pages is marked (MORE) and CUE (CONT'D). */
  continuation?: { cue: string }
  breakKind?: ManualBreakKind
  /** The slot this unit starts in runs this many of its lines long, or short. */
  pageAdjust?: number
}

/** A speech carried over a page: drawn at the line push at `pos`. */
export interface Continuation {
  pos: number
  cue: string
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
  /** The baseline grid's pitch, px: paragraphs start on whole lines. 0 or absent: none. */
  grid?: number
  /** The rule over a page's footnotes, and the space around it, px. */
  noteGap?: number
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
  /** Speeches carried over a page, for their (MORE) and (CONT'D). */
  continuations: Continuation[]
}

/** The fewest lines of a speech left on either side of a page break. */
const SPEECH_MIN_LINES = 2

/** The height of a unit's first line: what a (MORE) or a (CONT'D) takes. */
const lineHeightOf = (u: LayoutUnit): number => {
  const first = u.lines?.[0]
  return first ? Math.max(0, first.bottom - first.top) : 0
}

/**
 * The lines of a speech that may end a page: the first index `k` it can break before,
 * at or after `from`, leaving `SPEECH_MIN_LINES` on each side — or -1.
 */
const firstSentenceBreak = (u: LayoutUnit, from: number): number => {
  const lines = u.lines || []
  for (let k = Math.max(from, SPEECH_MIN_LINES); k <= lines.length - SPEECH_MIN_LINES; k += 1) {
    if (u.canBreakBefore?.(k)) return k
  }
  return -1
}

/** Layout tolerance, px. Measured rects carry subpixel noise; half a pixel is not a line. */
const EPS = 0.5

export const paginate = (units: LayoutUnit[], frame: LayoutFrame): LayoutResult => {
  const { slotHeight, stride } = frame
  const columns = Math.max(1, Math.floor(frame.columns))
  const minLines = Math.max(1, Math.floor(frame.minLines))

  const grid = frame.grid && frame.grid > 1 ? frame.grid : 0
  // Slots a typesetter ran long or short, by how much.
  const adjust = new Map<number, number>()

  const slotTop = (s: number) => s * stride
  const slotBottom = (s: number) => s * stride + slotHeight + (adjust.get(s) || 0)

  // The room each slot's footnotes take at its foot.
  const noteSpace = new Map<number, number>()
  const noteGap = frame.noteGap || 0
  const notesIn = (u: LayoutUnit, from: number, to: number) => {
    let n = 0
    const lines = u.lines || []
    for (let i = from; i < to && i < lines.length; i += 1) n += lines[i].notes || 0
    return n
  }
  /** What the slot's notes take, with `extra` more of them. */
  const reserved = (s: number, extra = 0) => {
    const n = (noteSpace.get(s) || 0) + extra
    return n > 0 ? n + noteGap : 0
  }
  const keepNotes = (s: number, u: LayoutUnit, from: number, to: number) => {
    const n = notesIn(u, from, to)
    if (n) noteSpace.set(s, (noteSpace.get(s) || 0) + n)
  }

  const pushes: Push[] = []
  const continuations: Continuation[] = []
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

  /** Push a block down; a second push of the same block adds to its first. */
  const pushBlock = (pos: number, height: number) => {
    const last = pushes[pushes.length - 1]
    if (last && last.kind === 'block' && last.pos === pos) last.height += height
    else pushes.push({ kind: 'block', pos, height })
    offset += height
  }

  /** Push unit `u` so its content starts at the top of slot `target`. */
  const pushBlockTo = (u: LayoutUnit, target: number) => {
    const height = slotTop(target) - (u.top + offset)
    if (height > EPS) pushBlock(u.pos, height)
    slot = target
    slotHasContent = false
  }

  /** Whether the first lines a unit must keep together fit in the current slot. */
  const headFits = (u: LayoutUnit | undefined): boolean => {
    if (!u || u.kind === 'break') return true
    const bottom = slotBottom(slot)
    if (u.kind === 'text' && u.split === 'never') return u.bottom + offset <= bottom + EPS
    if (u.kind === 'text' && u.split === 'sentences' && u.lines && u.lines.length > 1) {
      if (u.bottom + offset <= bottom + EPS) return true
      // The shortest part that may stay, with its (MORE) under it.
      const k = firstSentenceBreak(u, 0)
      if (k < 0) return false
      return u.lines[k - 1].bottom + offset + lineHeightOf(u) <= bottom + EPS
    }
    if (u.kind === 'text' && u.lines && u.lines.length > 1) {
      const need = u.lines[Math.min(minLines, u.lines.length) - 1]
      return need.bottom + offset <= bottom + EPS
    }
    return u.bottom + offset <= bottom + EPS
  }

  // Where each unit was placed from, so a transition can bring the line before it over.
  interface Placed { index: number; pushes: number; continuations: number; offset: number; slot: number; hadContent: boolean }
  const history: Placed[] = []
  const sendOver = new Set<number>()

  for (let i = 0; i < units.length; i += 1) {
    const u = units[i]

    if (u.kind === 'break') {
      forced = u.breakKind || 'page'
      history.length = 0
      continue
    }

    // A transition that would open a page takes the line before it along — and that
    // line's speaker, and a scene heading above them, which may not be left behind:
    // undo their placing, and place them again at the head of the next page.
    const last = history[history.length - 1]
    if (u.keepWithPrevious && !forced && last && last.index === i - 1 && last.slot === slot &&
      u.bottom + offset > slotBottom(slot) + EPS) {
      let h = history.length - 1
      while (h > 0 && units[history[h - 1].index].keepWithNext && history[h - 1].slot === slot && history[h - 1].index === history[h].index - 1) h -= 1
      const from = history[h]
      if (from.hadContent && !sendOver.has(from.index)) {
        pushes.length = from.pushes
        continuations.length = from.continuations
        offset = from.offset
        slotHasContent = true
        sendOver.add(from.index)
        history.length = h
        i = from.index - 1
        continue
      }
    }
    const placing: Placed = { index: i, pushes: pushes.length, continuations: continuations.length, offset, slot, hadContent: slotHasContent }
    if (sendOver.has(i) && slotHasContent) pushBlockTo(u, slot + 1)

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

    // Run the page long or short — once for the slot, by the first paragraph that asks.
    if (u.pageAdjust && !adjust.has(slot)) {
      const line = lineHeightOf(u) || grid
      adjust.set(slot, Math.max(-1, Math.min(1, u.pageAdjust)) * line)
    }

    // On the grid, a paragraph starts on the next whole line.
    if (grid && u.kind === 'text' && slotHasContent) {
      const off = (u.top + offset - slotTop(slot)) % grid
      const lift = off > EPS && grid - off > EPS ? grid - off : 0
      if (lift) {
        pushBlock(u.pos, lift)
        if (u.top + offset >= slotBottom(slot) - EPS) {
          pushBlockTo(u, slot + 1)
          markSlot(slot, u.pos)
        }
      }
    }

    // Place the unit, splitting a paragraph across as many slots as it needs.
    let firstLine = 0
    const lineCount = u.lines?.length || 0
    for (;;) {
      // The foot, less the room the notes of what is left of the unit would take here.
      const bottom = slotBottom(slot) - reserved(slot, notesIn(u, firstLine, lineCount))
      if (u.bottom + offset <= bottom + EPS) {
        keepNotes(slot, u, firstLine, lineCount)
        break
      }

      const lines = u.kind === 'text' && u.split !== 'never' ? u.lines || [] : []
      const remaining = lines.length - firstLine

      if (u.split === 'sentences' && remaining > 1) {
        // Dialogue: break at the last sentence that fits above a (MORE).
        const more = u.continuation ? lineHeightOf(u) : 0
        let fit = firstLine
        while (fit < lines.length && lines[fit].bottom + offset + more <= bottom + EPS) fit += 1
        let k = -1
        for (let c = fit; c > firstLine; c -= 1) {
          if (c - firstLine >= SPEECH_MIN_LINES && lines.length - c >= SPEECH_MIN_LINES && u.canBreakBefore?.(c)) {
            k = c
            break
          }
        }
        const atHead = firstLine > 0 || !slotHasContent
        if (k < 0 && !atHead) {
          pushBlockTo(u, slot + 1)
          markSlot(slot, u.pos)
          continue
        }
        // Nowhere a sentence ends and nowhere better to go: break between lines.
        if (k < 0) k = Math.max(firstLine + 1, Math.min(fit, lines.length - 1))
        if (k >= lines.length) {
          keepNotes(slot, u, firstLine, lineCount)
          break
        }
        keepNotes(slot, u, firstLine, k)
        // The next page opens with the speaker's name, a line above the speech.
        const height = slotTop(slot + 1) + more - (lines[k].top + offset)
        if (height > EPS) {
          pushes.push({ kind: 'line', pos: lines[k].pos, height })
          offset += height
          if (u.continuation) continuations.push({ pos: lines[k].pos, cue: u.continuation.cue })
        }
        slot += 1
        slotHasContent = true
        markSlot(slot, lines[k].pos)
        firstLine = k
        continue
      }

      if (remaining > 1) {
        // First line that does not fit — with its notes, and those of the lines above it.
        const foot = slotBottom(slot)
        let j = firstLine
        while (j < lines.length && lines[j].bottom + offset <= foot - reserved(slot, notesIn(u, firstLine, j + 1)) + EPS) j += 1
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
        if (j >= lines.length) {
          keepNotes(slot, u, firstLine, lineCount)
          break
        }
        keepNotes(slot, u, firstLine, j)
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
      keepNotes(slot, u, firstLine, lineCount)
      break
    }
    slotHasContent = true
    history.push(placing)
  }

  // A trailing manual break still opens its page, so the author sees it.
  if (forced) {
    const target = slotAfterBreak(forced)
    markSlot(target, null)
    slot = target
  }

  const slotCount = Math.max(slot + 1, slotStarts.length)
  const pageCount = Math.max(1, Math.ceil(slotCount / columns))
  return { pushes, slotCount, pageCount, slotStarts, chapterStartSlots, continuations }
}
