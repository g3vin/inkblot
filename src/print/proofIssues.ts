/**
 * proofIssues.ts — reading the typeset pages as a proofreader reads them, for what a
 * typesetter fixes: loose lines, widows and orphans, runts, ladders of hyphens, a
 * chapter's last page with a line or two on it.
 *
 * It reads the laid-out lines themselves — every word's boxes, grouped into lines by
 * where they sit — because that is the only place a line exists: a hyphenated word is
 * a word with a box on two lines; a loose line is one whose words are further apart
 * than a space. Which page a line is on comes from the pagination frame: the flow is
 * cut into slots `stride` apart.
 *
 * `analyzeLines` is the judgement, pure over lines, so the tests can check it without
 * a layout; `readParagraphLines` measures the DOM for it. The marks are drawn by
 * `ProofMarks`, as decorations that do not change a line's width.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'

import { ProofFix, ProofKind } from '../types'

export interface ProofWord {
  text: string
  from: number
  to: number
  left: number
  right: number
  /** Continues on the next line: the line ends in a hyphen. */
  broken?: boolean
}

export interface ProofLine {
  page: number
  top: number
  left: number
  right: number
  words: ProofWord[]
}

export interface ProofParagraph {
  pos: number
  justified: boolean
  /** The type size, px: what a space is measured against. */
  fontSize: number
  lines: ProofLine[]
}

export interface FoundIssue {
  id: string
  kind: ProofKind
  page: number
  from: number
  to: number
  text: string
  fixes: ProofFix[]
}

export interface ProofOptions {
  /** More lines in a row than this ending in a hyphen is a ladder. */
  hyphenLimit: number
  /** A word space wider than this share of the type size is loose. */
  looseSpace?: number
  /** A last line of one word shorter than this many letters is a runt. */
  runtLetters?: number
  /** A chapter's last page with this many lines or fewer is short. */
  shortPageLines?: number
}

const range = (words: ProofWord[]) => ({
  from: words[0].from,
  to: words[words.length - 1].to,
  text: words.map((w) => w.text).join(' '),
})

/** The judgement: what a proofreader would mark on these paragraphs' lines. */
export const analyzeLines = (paragraphs: ProofParagraph[], options: ProofOptions): FoundIssue[] => {
  const looseSpace = options.looseSpace ?? 0.55
  const runtLetters = options.runtLetters ?? 7
  const shortPageLines = options.shortPageLines ?? 2
  const out: FoundIssue[] = []
  const add = (kind: ProofKind, page: number, words: ProofWord[], fixes: ProofFix[]) => {
    if (!words.length) return
    const r = range(words)
    out.push({ id: `${kind}-${r.from}`, kind, page, ...r, fixes })
  }

  let hyphenRun: ProofLine[] = []
  const endRun = () => {
    if (hyphenRun.length > options.hyphenLimit) {
      const words = hyphenRun.map((l) => l.words[l.words.length - 1])
      add(ProofKind.StackedHyphens, hyphenRun[0].page, words, [ProofFix.Loosen, ProofFix.Tighten])
    }
    hyphenRun = []
  }

  for (const para of paragraphs) {
    const { lines } = para
    if (!lines.length) continue
    const n = lines.length
    lines.forEach((line, i) => {
      // Ladders run across paragraphs' lines only while each ends broken.
      const last = line.words[line.words.length - 1]
      if (last?.broken) hyphenRun.push(line)
      else endRun()
      // Loose: a justified line, not a paragraph's last, whose spaces stand wide.
      if (para.justified && i < n - 1 && line.words.length > 1) {
        const inked = line.words.reduce((sum, w) => sum + (w.right - w.left), 0)
        const space = (line.right - line.left - inked) / (line.words.length - 1)
        if (space > para.fontSize * looseSpace) add(ProofKind.Loose, line.page, line.words, [ProofFix.Tighten, ProofFix.Loosen])
      }
    })
    endRun()
    if (n > 1) {
      const lastLine = lines[n - 1]
      // Widow: the last line alone at the head of a page.
      if (lastLine.page > lines[n - 2].page) add(ProofKind.Widow, lastLine.page, lastLine.words, [ProofFix.Tighten, ProofFix.RunLong])
      // Orphan: the first line alone at the foot of one.
      if (lines[1].page > lines[0].page) add(ProofKind.Orphan, lines[0].page, lines[0].words, [ProofFix.KeepTogether, ProofFix.RunShort])
      // Runt: a last line of one short word.
      const only = lastLine.words.length === 1 ? lastLine.words[0] : null
      if (only && only.text.replace(/[^\p{L}\p{N}]/gu, '').length < runtLetters && lastLine.page === lines[n - 2].page) {
        add(ProofKind.Runt, lastLine.page, lastLine.words, [ProofFix.Tighten, ProofFix.Loosen])
      }
    }
  }

  // The chapter's last page: lines on it.
  const all = paragraphs.flatMap((p) => p.lines.map((line) => ({ line, para: p })))
  const lastPage = all.length ? all[all.length - 1].line.page : 0
  const onLast = all.filter((x) => x.line.page === lastPage)
  if (lastPage > 1 && onLast.length && onLast.length <= shortPageLines) {
    // The fix goes on the paragraph that ran onto it, or the one before, which starts
    // on the page before: run that page long, or tighten, to take the lines back.
    const first = onLast[0]
    const crossing = first.para.lines[0].page < lastPage
    const owner = crossing ? first.para : paragraphs[paragraphs.indexOf(first.para) - 1] || first.para
    const words = crossing ? first.line.words : owner.lines[owner.lines.length - 1].words
    add(ProofKind.ShortPage, lastPage, words, [ProofFix.Tighten, ProofFix.RunLong])
  }
  return out
}

/* ---------------- reading the lines off the page ---------------- */

export interface PageFrame {
  stride: number
  columns: number
}

/**
 * Every paragraph's lines, as laid out now: words by the boxes they are drawn in, lines
 * by where those boxes sit, pages by the slot each line falls in.
 */
export const readParagraphLines = (view: EditorView, frame: PageFrame): ProofParagraph[] => {
  const dom = view.dom as HTMLElement
  const rect = dom.getBoundingClientRect()
  const scale = rect.width / (dom.offsetWidth || 1) || 1
  const origin = parseFloat(getComputedStyle(dom).paddingTop) || 0
  const columns = Math.max(1, frame.columns || 1)
  const pageOf = (clientY: number) => {
    const flowY = (clientY - rect.top) / scale - origin
    return Math.floor(Math.max(0, flowY) / frame.stride / columns) + 1
  }
  const out: ProofParagraph[] = []
  const doc = dom.ownerDocument
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'paragraph') return true
    if (!node.textContent.trim()) return false
    const el = view.nodeDOM(pos) as HTMLElement | null
    if (!el || !el.getClientRects) return false
    const style = getComputedStyle(el)
    const fontSize = parseFloat(style.fontSize) || 16
    const words: Array<ProofWord & { rects: DOMRect[] }> = []
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let text = walker.nextNode() as Text | null; text; text = walker.nextNode() as Text | null) {
      // Text the page draws but the document does not hold: a widget's.
      const widget = text.parentElement?.closest('[contenteditable="false"]')
      if (widget && widget !== el && el.contains(widget)) continue
      const value = text.data
      for (const match of value.matchAll(/\S+/g)) {
        const r = doc.createRange()
        r.setStart(text, match.index as number)
        r.setEnd(text, (match.index as number) + match[0].length)
        const rects = [...r.getClientRects()].filter((b) => b.width > 0.5)
        if (!rects.length) continue
        let from: number
        let to: number
        try {
          from = view.posAtDOM(text, match.index as number)
          to = view.posAtDOM(text, (match.index as number) + match[0].length)
        } catch {
          continue
        }
        words.push({ text: match[0], from, to, left: rects[0].left, right: rects[0].right, rects })
      }
    }
    if (!words.length) return false
    // Lines: word boxes grouped by their top, within a few px.
    const tol = 3 * scale
    const lines: Array<ProofLine & { y: number }> = []
    const lineAt = (b: DOMRect) => {
      let line = lines.find((l) => Math.abs(l.y - b.top) < tol)
      if (!line) {
        line = { y: b.top, top: b.top, page: pageOf(b.top + b.height / 2), left: b.left, right: b.right, words: [] }
        lines.push(line)
      }
      return line
    }
    for (const w of words) {
      w.rects.forEach((b, i) => {
        const line = lineAt(b)
        line.left = Math.min(line.left, b.left)
        line.right = Math.max(line.right, b.right)
        // A word's part on each line counts on that line; a part before another is broken.
        line.words.push({ text: w.text, from: w.from, to: w.to, left: b.left, right: b.right, broken: i < w.rects.length - 1 })
      })
    }
    lines.sort((a, b) => a.y - b.y)
    out.push({
      pos,
      justified: style.textAlign === 'justify',
      fontSize: fontSize * scale,
      lines: lines.map(({ y: _y, ...line }) => line),
    })
    return false
  })
  return out
}

/* ---------------- the marks on the page ---------------- */

export const proofMarksKey = new PluginKey<DecorationSet>('proofMarks')

/** Show `issues` on the page, the one `focused` outlined. None clears them. */
export const setProofMarks = (view: EditorView, issues: Array<{ id: string; kind: string; from: number; to: number }>, focused?: string | null) => {
  const doc = view.state.doc
  const decorations = issues
    .filter((i) => i.from >= 0 && i.to <= doc.content.size && i.from < i.to)
    .map((i) => Decoration.inline(i.from, i.to, {
      class: `proof-mark is-${i.kind}${i.id === focused ? ' is-focused' : ''}`,
      'data-proof': i.id,
    }))
  view.dispatch(view.state.tr
    .setMeta(proofMarksKey, DecorationSet.create(doc, decorations))
    .setMeta('addToHistory', false)
    .setMeta('typeset', true))
}

export const ProofMarks = Extension.create({
  name: 'proofMarks',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: proofMarksKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => {
            const next = tr.getMeta(proofMarksKey)
            if (next) return next
            return tr.docChanged ? set.map(tr.mapping, tr.doc) : set
          },
        },
        props: {
          decorations: (state) => proofMarksKey.getState(state),
        },
      }),
    ]
  },
})
