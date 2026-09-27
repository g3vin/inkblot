/**
 * measure.ts — reading a laid-out editor back as the units `paginate` breaks.
 *
 * Everything is measured in **layout px** — client rects divided by the view's
 * scale, relative to the text flow's origin (the top of page 1's text block) — so
 * the answer is the same at every zoom. And everything is **natural**: the pushes
 * currently applied are subtracted back out, so what paginate sees never depends on
 * what it decided last time.
 *
 * A push at document position p moves everything at or after p. So a y measured
 * for content that starts at position q is made natural by subtracting every push
 * at a position ≤ q. That one rule covers the push mechanisms:
 *   · a block push on a textblock (a ::before inside it) moves its lines, which all
 *     start after the block's own position — but not the block's own top edge;
 *   · a block push on an atom (a widget just before it) moves the atom;
 *   · a line push (an inline widget at a line's first character) moves that line
 *     and everything after it.
 *   · a table row is pushed by an empty row inserted just before it.
 *
 * **Cost.** A 300-page manuscript is some 11,000 lines. Two things keep a pass
 * cheap enough to run after every pause in typing:
 *   · A textblock's line geometry *relative to its own top* depends only on the
 *     node and the width it is set in, and ProseMirror nodes are immutable — so it
 *     is cached by node identity, and only a block that changed is re-measured. The
 *     rest cost one getBoundingClientRect each.
 *   · A line's document position is only needed where a page actually breaks, so
 *     it is resolved lazily — by bisecting the block's positions with coordsAtPos,
 *     which measures a Range and, unlike posAtCoords, works off screen.
 */
import type { EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

import type { LayoutLine, LayoutUnit, ManualBreakKind, Push } from './paginate'

const HEADING = 'heading'
const SCRIPT = 'scriptElement'
/** A script's lines that are never the last on a page. */
const KEEP_WITH_NEXT = new Set(['sceneHeading', 'shot', 'character', 'parenthetical', 'actHeading', 'sceneTitle', 'stageCharacter'])

/** A character's name, less any extension already on it: "MARY (V.O.)" → "MARY". */
const speakerName = (text: string): string => text.replace(/\s*\(.*\)\s*$/, '').trim().toUpperCase()

export interface MeasureContext {
  view: EditorView
  /** The view's current CSS scale (1 at 100% zoom). */
  scale: number
  /** The pushes currently applied, so they can be subtracted. */
  applied: Push[]
  /** px from the editor root's border-box top to the flow origin (its padding-top). */
  originOffset: number
  /** Anything else that changes line breaking (the flow width): a new key drops the cache. */
  layoutKey: string
}

/** Sum of pushes at positions ≤ pos (or < pos). */
const makePushSum = (applied: Push[]) => {
  const sorted = [...applied].sort((a, b) => a.pos - b.pos)
  const prefix: number[] = []
  let total = 0
  for (const p of sorted) {
    total += p.height
    prefix.push(total)
  }
  return (pos: number, inclusive = true): number => {
    let lo = 0
    let hi = sorted.length - 1
    let found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const hit = inclusive ? sorted[mid].pos <= pos : sorted[mid].pos < pos
      if (hit) {
        found = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return found < 0 ? 0 : prefix[found]
  }
}

interface RawRect { top: number; bottom: number }

/**
 * Line boxes, from the rects of everything inside a block. Rects that overlap
 * vertically are one line — which is also what keeps a float, or a tall inline
 * image, and the lines beside it together as one unbreakable chunk.
 */
const clusterLines = (rects: RawRect[]): RawRect[] => {
  const sorted = rects.filter((r) => r.bottom - r.top > 0.01).sort((a, b) => a.top - b.top)
  const lines: RawRect[] = []
  for (const r of sorted) {
    const last = lines[lines.length - 1]
    if (last && r.top < last.bottom - 1) {
      last.bottom = Math.max(last.bottom, r.bottom)
    } else {
      lines.push({ ...r })
    }
  }
  return lines
}

/** A textblock's natural lines, relative to its border-box top, in layout px. */
interface TextGeometry {
  lines: RawRect[]
}

let cacheKey = ''
let geometryCache = new WeakMap<PMNode, TextGeometry>()

const measureTextGeometry = (dom: HTMLElement, scale: number, ownPush: number): TextGeometry => {
  const top = dom.getBoundingClientRect().top
  const range = document.createRange()
  range.selectNodeContents(dom)
  const widgets = Array.from(dom.querySelectorAll('.pg-line-push')).map((w) => w.getBoundingClientRect())
  const inWidget = (r: DOMRect) => widgets.some((w) => r.top >= w.top - 0.5 && r.bottom <= w.bottom + 0.5)

  const rects: RawRect[] = []
  for (const r of Array.from(range.getClientRects())) {
    if (r.height <= 0 || inWidget(r)) continue
    rects.push({ top: (r.top - top) / scale, bottom: (r.bottom - top) / scale })
  }
  // Floats are out of the inline flow: add image boxes explicitly, so a float joins
  // the lines it sits beside.
  dom.querySelectorAll('.image-node').forEach((el) => {
    const r = el.getBoundingClientRect()
    if (r.height > 0) rects.push({ top: (r.top - top) / scale, bottom: (r.bottom - top) / scale })
  })

  let lines = clusterLines(rects)
  if (!lines.length) {
    // An empty textblock is one line: its content box.
    const r = dom.getBoundingClientRect()
    const cs = getComputedStyle(dom)
    const padTop = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.borderTopWidth) || 0)
    const padBottom = (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.borderBottomWidth) || 0)
    const height = r.height / scale
    lines = [{ top: padTop + ownPush, bottom: Math.max(padTop + ownPush, height - padBottom) }]
  }

  // Natural: take out the block's own push (every line sits below it) and any line
  // pushes inside it (each moves the lines below it).
  const widgetTops = widgets.map((w) => ({ top: (w.top - top) / scale, height: w.height / scale })).sort((a, b) => a.top - b.top)
  return {
    lines: lines.map((line) => {
      let shift = ownPush
      for (const w of widgetTops) if (w.top < line.top - 0.5) shift += w.height
      return { top: line.top - shift, bottom: line.bottom - shift }
    }),
  }
}

/**
 * The document position of the first character on a line: the first position in
 * [start, end] whose caret box, made natural, starts at or below the line's natural
 * top. Natural by the same rule as everything else — the live y less the pushes at
 * or before that position — so the pushes already inside the block never confuse it.
 */
const resolveLineStart = (
  start: number,
  end: number,
  naturalTop: number,
  naturalAt: (pos: number) => number
): number => {
  let lo = start
  let hi = end
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (naturalAt(mid) >= naturalTop - 1) hi = mid
    else lo = mid + 1
  }
  return lo
}

/**
 * The client top of the character that starts at `pos`, from that character's own
 * box. Not coordsAtPos: at a soft wrap the position before a line's first letter is
 * also the position after the previous line's last space, and WebKit answers with
 * the end of the previous line whichever side is asked for — which put page breaks
 * one letter into the word.
 */
const charTopAt = (view: EditorView, pos: number): number => {
  const { node, offset } = view.domAtPos(pos, 1)
  let text: Node | null = null
  let index = 0
  if (node.nodeType === Node.TEXT_NODE && offset < (node.textContent || '').length) {
    text = node
    index = offset
  } else {
    // An element boundary: the first text inside what follows it.
    let next: Node | null = node.nodeType === Node.TEXT_NODE ? null : node.childNodes[offset] || null
    while (next && next.nodeType !== Node.TEXT_NODE) {
      if ((next as Element).classList?.contains('pg-line-push')) next = next.nextSibling
      else next = next.firstChild || next.nextSibling
    }
    if (next && (next.textContent || '').length) text = next
  }
  if (text) {
    const range = document.createRange()
    range.setStart(text, index)
    range.setEnd(text, index + 1)
    const rects = range.getClientRects()
    const rect = rects[rects.length - 1] || range.getBoundingClientRect()
    if (rect && rect.height > 0) return rect.top
  }
  return view.coordsAtPos(pos, 1).top
}

const isPushWidget = (el: Element) => (
  el.classList.contains('pg-line-push') || el.classList.contains('pg-block-push') || el.classList.contains('pg-row-push')
)

export const measureUnits = (ctx: MeasureContext): LayoutUnit[] => {
  const { view, scale, originOffset } = ctx
  if (ctx.layoutKey !== cacheKey) {
    cacheKey = ctx.layoutKey
    geometryCache = new WeakMap()
  }
  const pushSum = makePushSum(ctx.applied)
  const ownPushAt = new Map<number, number>()
  for (const p of ctx.applied) if (p.kind === 'block') ownPushAt.set(p.pos, (ownPushAt.get(p.pos) || 0) + p.height)

  const rootRect = view.dom.getBoundingClientRect()
  const toFlow = (clientY: number) => (clientY - rootRect.top) / scale - originOffset

  const units: LayoutUnit[] = []

  const measureText = (node: PMNode, pos: number, dom: HTMLElement) => {
    let geometry = geometryCache.get(node)
    if (!geometry) {
      geometry = measureTextGeometry(dom, scale, ownPushAt.get(pos) || 0)
      geometryCache.set(node, geometry)
    }
    // The block's natural top: its measured top, less the pushes above it (its own
    // ::before sits inside it, below its top edge).
    const blockTop = toFlow(dom.getBoundingClientRect().top) - pushSum(pos, false)
    const start = pos + 1
    const end = pos + node.nodeSize - 1

    const naturalAt = (p: number) => toFlow(charTopAt(view, p)) - pushSum(p, true)
    const lines: LayoutLine[] = geometry.lines.map((line, i) => {
      const top = blockTop + line.top
      const out = { top, bottom: blockTop + line.bottom } as LayoutLine
      if (i === 0) {
        out.pos = start
        return out
      }
      let cached: number | null = null
      Object.defineProperty(out, 'pos', {
        enumerable: true,
        get: () => {
          if (cached == null) cached = resolveLineStart(start, end, top, naturalAt)
          return cached
        },
      })
      return out
    })

    units.push({
      kind: 'text',
      pos,
      top: lines[0].top,
      bottom: lines[lines.length - 1].bottom,
      lines,
      keepWithNext: node.type.name === HEADING || Boolean(node.attrs.keepWithNext),
      // What a typesetter set on the paragraph (ParagraphTypeset.ts).
      ...(node.attrs.keepTogether ? { split: 'never' as const } : {}),
      ...(node.attrs.pageAdjust ? { pageAdjust: Number(node.attrs.pageAdjust) || 0 } : {}),
      ...(node.type.name === SCRIPT ? scriptRules(node, pos, lines) : {}),
    })
  }

  /** How a script's line may break (paginate.ts): its element decides. */
  const scriptRules = (node: PMNode, pos: number, lines: LayoutLine[]): Partial<LayoutUnit> => {
    const element = node.attrs.element as string
    if (KEEP_WITH_NEXT.has(element)) return { keepWithNext: true, ...(element === 'parenthetical' ? { split: 'never' as const } : {}) }
    if (element === 'transition') return { keepWithPrevious: true }
    if (element !== 'dialogue' && element !== 'stageDialogue') return {}
    const doc = view.state.doc
    const start = pos + 1
    return {
      split: 'sentences',
      // A line starts a sentence when what comes before it ends one.
      canBreakBefore: (index: number) => {
        const at = lines[index]?.pos
        if (at == null || at <= start) return false
        const before = doc.textBetween(Math.max(start, at - 4), at).trimEnd()
        return /[.?!…]["'”’)\]]*$/.test(before)
      },
      continuation: { cue: speakerBefore(pos) },
    }
  }

  /** The name over a speech: the character line above it, past any parenthetical. */
  const speakerBefore = (pos: number): string => {
    const $pos = view.state.doc.resolve(pos)
    const parent = $pos.parent
    for (let i = $pos.index() - 1; i >= 0; i -= 1) {
      const node = parent.child(i)
      if (node.type.name !== SCRIPT) break
      const element = node.attrs.element
      if (element === 'character' || element === 'stageCharacter') return speakerName(node.textContent)
      if (element !== 'parenthetical' && element !== 'dialogue' && element !== 'stageDialogue') break
    }
    return ''
  }

  const measureAtom = (pos: number, dom: HTMLElement) => {
    const r = dom.getBoundingClientRect()
    const shift = pushSum(pos)
    units.push({ kind: 'atom', pos, top: toFlow(r.top) - shift, bottom: toFlow(r.bottom) - shift })
  }

  // A row is pushed by an empty row just before it, so like an atom it moves whole.
  const measureRow = (pos: number, dom: HTMLElement) => {
    const r = dom.getBoundingClientRect()
    const shift = pushSum(pos)
    units.push({ kind: 'row', pos, top: toFlow(r.top) - shift, bottom: toFlow(r.bottom) - shift })
  }

  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'pageBreak') {
      const dom = view.nodeDOM(pos) as HTMLElement | null
      const y = dom?.getBoundingClientRect ? toFlow(dom.getBoundingClientRect().top) - pushSum(pos) : 0
      units.push({ kind: 'break', pos, top: y, bottom: y, breakKind: (node.attrs.kind || 'page') as ManualBreakKind })
      return false
    }
    if (node.type.name === 'tableRow') {
      const dom = view.nodeDOM(pos) as HTMLElement | null
      if (dom?.getBoundingClientRect) measureRow(pos, dom)
      return false
    }
    if (node.isTextblock) {
      const dom = view.nodeDOM(pos) as HTMLElement | null
      if (dom?.getBoundingClientRect && !isPushWidget(dom)) measureText(node, pos, dom)
      return false
    }
    if (node.isBlock && (node.isAtom || node.isLeaf)) {
      const dom = view.nodeDOM(pos) as HTMLElement | null
      if (dom?.getBoundingClientRect) measureAtom(pos, dom)
      return false
    }
    return true
  })

  return units
}
