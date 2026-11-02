/**
 * SelectionHighlight.js — the selection drawn as rounded bands, one per line.
 *
 * The browser's highlight can't be rounded, and WebKit leaves it out behind what isn't
 * editable text (a note's dot, a bubble's chip). So it is hidden
 * (`.has-drawn-selection` in Editor.prose.css) and drawn here instead: a band a line
 * tall behind each line's selected text and indicators, and the bands of a paragraph's
 * lines one shape, its corners rounded inside and out, as a code editor draws one.
 *
 * Only blocks near the viewport are measured, so selecting a whole book stays cheap;
 * a scroll draws the rest as it comes into view.
 */
import { Extension } from '@tiptap/core'
import { AllSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'

export const SELECTION_HIGHLIGHT_PLUGIN_KEY = new PluginKey('selectionHighlight')

/** How far past the viewport a block is still measured, in pixels. */
const OVERSCAN = 400
/** Lines this many pixels apart or less are one run: the same paragraph's, not the next's. */
const JOIN_GAP = 2
/** Neighbouring line ends this many pixels apart or less are drawn as one edge. */
const ALIGN_SPAN = 16
/** The room the band leaves either side of the text, in font sizes. */
const PAD_EM = 0.15
/** The band shown for a selected empty line, in font sizes. */
const EMPTY_LINE_EM = 0.4

const lineHeightOf = (element) => {
  const style = getComputedStyle(element)
  const lineHeight = parseFloat(style.lineHeight)
  return Number.isFinite(lineHeight) ? lineHeight : parseFloat(style.fontSize) * 1.2
}

/**
 * Each text node's and indicator's rects within `range`, the text ones with their line's
 * height. Rects are on screen, so the styles' lengths are taken onto it by `scale`.
 */
const measureRange = (range, root, scale) => {
  const pieces = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => (range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  })
  let atom = null
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    // An indicator or other inline atom is covered whole, never looked inside.
    if (atom?.contains(node)) continue
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.getAttribute('contenteditable') !== 'false') continue
      atom = node
      const rect = node.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) pieces.push({ rect, lineHeight: 0 })
      continue
    }
    if (!node.data.length) continue
    const from = node === range.startContainer ? range.startOffset : 0
    const to = node === range.endContainer ? range.endOffset : node.data.length
    if (from >= to) continue
    const style = getComputedStyle(node.parentElement)
    const lineHeight = (parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2) * scale
    const pad = parseFloat(style.fontSize) * PAD_EM * scale
    const push = (start, end) => {
      const part = document.createRange()
      part.setStart(node, start)
      part.setEnd(node, end)
      for (const rect of part.getClientRects()) {
        if (rect.width > 0) pieces.push({ rect, lineHeight, pad })
      }
    }
    // Word by word, so a wrapped line's trailing space isn't measured: the band ends at
    // the last letter, as it starts at the first, and pads both sides alike.
    const words = node.data.slice(from, to).matchAll(/\S+/g)
    let any = false
    for (const word of words) {
      any = true
      push(from + word.index, from + word.index + word[0].length)
    }
    if (!any) push(from, to)
  }
  return pieces
}

/** The pieces gathered into lines: text sets a line's band, indicators only widen it. */
const toLines = (pieces) => {
  const lines = []
  const text = pieces.filter((piece) => piece.lineHeight > 0).sort((a, b) => a.rect.top - b.rect.top)
  for (const { rect, lineHeight, pad } of text) {
    const middle = (rect.top + rect.bottom) / 2
    const line = lines.find((l) => middle >= l.textTop && middle <= l.textBottom)
    if (line) {
      line.left = Math.min(line.left, rect.left)
      line.right = Math.max(line.right, rect.right)
      line.pad = Math.max(line.pad, pad)
      if (lineHeight > line.lineHeight) {
        line.lineHeight = lineHeight
        line.middle = middle
      }
    } else {
      lines.push({ left: rect.left, right: rect.right, textTop: rect.top, textBottom: rect.bottom, middle, lineHeight, pad })
    }
  }
  for (const { rect } of pieces.filter((piece) => piece.lineHeight === 0)) {
    const middle = (rect.top + rect.bottom) / 2
    const line = lines.find((l) => middle >= l.middle - l.lineHeight / 2 && middle <= l.middle + l.lineHeight / 2)
    if (line) {
      line.left = Math.min(line.left, rect.left)
      line.right = Math.max(line.right, rect.right)
    }
  }
  // The line's leading sits evenly around its text: a band a line tall, centred on it.
  return lines
    .map((l) => ({ left: l.left - l.pad, right: l.right + l.pad, top: l.middle - l.lineHeight / 2, bottom: l.middle + l.lineHeight / 2 }))
    .sort((a, b) => a.top - b.top)
}

/**
 * Lines that touch and overlap, gathered into runs that are drawn as one shape. Their
 * shared edges are made one edge: two bands meeting a fraction of a pixel apart would
 * leave a hairline, or a darker one where they overlap.
 */
const toRuns = (lines, radius) => {
  const runs = []
  for (const line of lines) {
    const run = runs[runs.length - 1]
    const last = run?.[run.length - 1]
    const touches = last && Math.abs(line.top - last.bottom) <= JOIN_GAP
    const overlaps = last && Math.min(line.right, last.right) - Math.max(line.left, last.left) >= radius * 2
    if (touches && overlaps) {
      const edge = (last.bottom + line.top) / 2
      last.bottom = edge
      run.push({ ...line, top: edge })
    } else {
      runs.push([{ ...line }])
    }
  }
  for (const run of runs) {
    alignEdges(run, 'right', Math.max)
    alignEdges(run, 'left', Math.min)
  }
  return runs
}

/**
 * Line ends that nearly line up are lined up: neighbouring lines whose edges lie within
 * ALIGN_SPAN of each other all take the farthest, so a ragged right reads as one edge
 * and not a stair of little steps. No line grows past its text by more than the span.
 */
const alignEdges = (run, side, farthest) => {
  let start = 0
  while (start < run.length) {
    let lo = run[start][side]
    let hi = lo
    let end = start + 1
    while (end < run.length) {
      const edge = run[end][side]
      if (Math.max(hi, edge) - Math.min(lo, edge) > ALIGN_SPAN) break
      lo = Math.min(lo, edge)
      hi = Math.max(hi, edge)
      end += 1
    }
    const to = farthest(lo, hi)
    for (let i = start; i < end; i += 1) run[i][side] = to
    start = end
  }
}

const n = (value) => Math.round(value * 100) / 100

/**
 * A run's outline as an SVG path, clockwise: every corner rounded, the outer ones
 * convex and the ones where a line steps in or out concave, as a code editor draws a
 * selection. A step narrower than two radii takes the radius it has room for.
 */
const runPath = (run, radius) => {
  const first = run[0]
  const last = run[run.length - 1]
  const cap = (line) => Math.min(radius, (line.right - line.left) / 2, (line.bottom - line.top) / 2)
  const out = []
  const arc = (r, sweep, x, y) => out.push(`A${n(r)} ${n(r)} 0 0 ${sweep} ${n(x)} ${n(y)}`)
  const to = (x, y) => out.push(`L${n(x)} ${n(y)}`)

  const r0 = cap(first)
  out.push(`M${n(first.left + r0)} ${n(first.top)}`)
  to(first.right - r0, first.top)
  arc(r0, 1, first.right, first.top + r0)

  // Down the right side.
  for (let i = 0; i < run.length - 1; i += 1) {
    const y = run[i].bottom
    const a = run[i].right
    const b = run[i + 1].right
    const r = Math.min(radius, Math.abs(b - a) / 2, cap(run[i]), cap(run[i + 1]))
    if (Math.abs(b - a) < 0.5) continue
    if (b > a) {
      to(a, y - r)
      arc(r, 0, a + r, y)
      to(b - r, y)
      arc(r, 1, b, y + r)
    } else {
      to(a, y - r)
      arc(r, 1, a - r, y)
      to(b + r, y)
      arc(r, 0, b, y + r)
    }
  }

  const rn = cap(last)
  to(last.right, last.bottom - rn)
  arc(rn, 1, last.right - rn, last.bottom)
  to(last.left + rn, last.bottom)
  arc(rn, 1, last.left, last.bottom - rn)

  // Up the left side.
  for (let i = run.length - 1; i > 0; i -= 1) {
    const y = run[i].top
    const a = run[i].left
    const b = run[i - 1].left
    const r = Math.min(radius, Math.abs(b - a) / 2, cap(run[i]), cap(run[i - 1]))
    if (Math.abs(b - a) < 0.5) continue
    if (b < a) {
      to(a, y + r)
      arc(r, 0, a - r, y)
      to(b + r, y)
      arc(r, 1, b, y - r)
    } else {
      to(a, y + r)
      arc(r, 1, a + r, y)
      to(b - r, y)
      arc(r, 0, b, y - r)
    }
  }

  to(first.left, first.top + r0)
  arc(r0, 1, first.left + r0, first.top)
  return `${out.join('')}Z`
}

const SVG = 'http://www.w3.org/2000/svg'

class SelectionHighlightView {
  constructor(view) {
    this.view = view
    this.frame = 0
    this.layer = document.createElement('div')
    this.layer.className = 'selection-highlight'
    this.layer.setAttribute('aria-hidden', 'true')
    this.mount()

    this.schedule = this.schedule.bind(this)
    view.dom.addEventListener('focus', this.schedule)
    view.dom.addEventListener('blur', this.schedule)
    window.addEventListener('resize', this.schedule)
    document.addEventListener('scroll', this.schedule, true)
    this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(this.schedule) : null
    this.resizeObserver?.observe(view.dom)
    this.schedule()
  }

  /** Before the editor in its parent: both are positioned, so the text paints over the bands. */
  mount() {
    const parent = this.view.dom.parentElement
    if (parent && this.layer.nextSibling !== this.view.dom) parent.insertBefore(this.layer, this.view.dom)
  }

  update(view) {
    this.view = view
    this.mount()
    this.schedule()
  }

  schedule() {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.draw()
    })
  }

  clear() {
    if (this.layer.firstChild) this.layer.replaceChildren()
  }

  /** The bands for the selection, in screen pixels; `scale` is the page's on screen. */
  measure(scale) {
    const { view } = this
    const { selection, doc } = view.state
    const { from, to } = selection
    const lines = []
    const top = -OVERSCAN
    const bottom = window.innerHeight + OVERSCAN
    doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true
      const block = view.nodeDOM(pos)
      if (!(block instanceof Element)) return false
      const box = block.getBoundingClientRect()
      if (box.bottom < top || box.top > bottom) return false
      const start = Math.max(from, pos + 1)
      const end = Math.min(to, pos + 1 + node.content.size)
      if (node.content.size === 0 || start >= end) {
        // A selected empty line, or a line the selection only passes the end of.
        if (node.content.size === 0 || end === pos + 1 + node.content.size) {
          try {
            const at = view.coordsAtPos(start)
            const lineHeight = lineHeightOf(block) * scale
            const middle = (at.top + at.bottom) / 2
            const width = parseFloat(getComputedStyle(block).fontSize) * EMPTY_LINE_EM * scale
            lines.push({ left: at.left, right: at.left + width, top: middle - lineHeight / 2, bottom: middle + lineHeight / 2 })
          } catch {
            // Not laid out.
          }
        }
        return false
      }
      try {
        const range = document.createRange()
        const a = view.domAtPos(start)
        const b = view.domAtPos(end)
        range.setStart(a.node, a.offset)
        range.setEnd(b.node, b.offset)
        lines.push(...toLines(measureRange(range, block, scale)))
      } catch {
        // A position the view can't map to the DOM right now; the next draw has it.
      }
      return false
    })
    return lines.sort((a, b) => a.top - b.top)
  }

  draw() {
    const { view, layer } = this
    const { selection } = view.state
    const drawn = selection instanceof TextSelection || selection instanceof AllSelection
    if (!drawn || selection.empty || !layer.offsetParent) {
      this.clear()
      return
    }
    const parent = layer.offsetParent
    const box = parent.getBoundingClientRect()
    // The page may be scaled (the canvas, Typeset's zoom): rects are on screen, the
    // shape is in the parent's own pixels.
    const scale = parent.offsetWidth ? box.width / parent.offsetWidth : 1
    const radius = parseFloat(getComputedStyle(layer).getPropertyValue('--selection-radius')) || 4
    // Into the parent's own pixels, where the shape is drawn.
    const lines = this.measure(scale).map((line) => ({
      left: (line.left - box.left) / scale - parent.clientLeft + parent.scrollLeft,
      right: (line.right - box.left) / scale - parent.clientLeft + parent.scrollLeft,
      top: (line.top - box.top) / scale - parent.clientTop + parent.scrollTop,
      bottom: (line.bottom - box.top) / scale - parent.clientTop + parent.scrollTop,
    }))
    if (!lines.length) {
      this.clear()
      return
    }
    const svg = document.createElementNS(SVG, 'svg')
    svg.setAttribute('class', 'selection-highlight-shape')
    for (const run of toRuns(lines, radius)) {
      const path = document.createElementNS(SVG, 'path')
      path.setAttribute('d', runPath(run, radius))
      svg.appendChild(path)
    }
    layer.classList.toggle('is-inactive', !view.hasFocus())
    layer.replaceChildren(svg)
  }

  destroy() {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.view.dom.removeEventListener('focus', this.schedule)
    this.view.dom.removeEventListener('blur', this.schedule)
    window.removeEventListener('resize', this.schedule)
    document.removeEventListener('scroll', this.schedule, true)
    this.resizeObserver?.disconnect()
    this.layer.remove()
  }
}

export const SelectionHighlight = Extension.create({
  name: 'selectionHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: SELECTION_HIGHLIGHT_PLUGIN_KEY,
        view: (view) => new SelectionHighlightView(view),
        props: {
          attributes: { class: 'has-drawn-selection' },
        },
      }),
    ]
  },
})
