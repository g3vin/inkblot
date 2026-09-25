/**
 * PaginationExtension.ts — breaks the live editor into pages, in place.
 *
 * Dormant until Print Layout hands it a frame (`setPaginationFrame`). Then, after
 * every change settles, it measures the laid-out document (measure.ts), decides the
 * breaks (paginate.ts) and draws them as decorations — never as content, so nothing
 * it does is saved, undone, copied or exported:
 *
 *   textblock pushed whole   node decoration: `.pg-push`, a ::before of the push's
 *                            height inside the block, so its lines move down
 *   paragraph split          inline widget `.pg-line-push` at the first line of the
 *                            new page: an inline-block as wide as the line and as
 *                            tall as the push. It cannot share a line, so the line
 *                            before stays a justified soft wrap and the line after
 *                            is not a first line (no indent)
 *   atom pushed              block widget `.pg-block-push` just before it — a ::before
 *                            would land inside the atom's own border and background
 *   table row pushed         widget `.pg-row-push`: an empty <tr> just before it
 *
 * Measuring the result changes nothing it measures (it subtracts the pushes it
 * finds), so a settled document measures to the same pushes and the loop stops.
 * Where a push moves content by a little more or less than its height (a margin
 * collapsing differently around a widget), the next pass sees the difference and
 * corrects for it; MAX_PASSES bounds that so a pathological case settles rather
 * than oscillating.
 *
 * Not while the author is composing (IME) or drag-selecting: moving text under a
 * composition cancels it, and moving it under a drag selects the wrong thing.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'

import { measureUnits } from './measure'
import { paginate } from './paginate'
import type { LayoutFrame, LayoutResult, Push } from './paginate'

export interface PaginationFrame extends LayoutFrame {
  /** Bumped by the caller whenever something outside the document changed layout. */
  revision?: number
  /** The print typography the text is set in (`typographyKey`): a change re-measures every line. */
  typeKey?: string
}

export interface PaginationState {
  frame: PaginationFrame | null
  pushes: Push[]
  decorations: DecorationSet
  result: LayoutResult | null
}

export const paginationKey = new PluginKey<PaginationState>('pagination')

const META_FRAME = 'paginationFrame'
const META_PUSHES = 'paginationPushes'

/** Passes allowed per change before the layout is taken as settled. */
const MAX_PASSES = 4
/** Pushes within this many px of each other are the same push. */
const PUSH_TOLERANCE = 0.75
/** Wait for typing to pause this long before re-measuring a long document. */
const SETTLE_MS = 30

const samePushes = (a: Push[], b: Push[]) => (
  a.length === b.length && a.every((p, i) => (
    p.kind === b[i].kind && p.pos === b[i].pos && Math.abs(p.height - b[i].height) < PUSH_TOLERANCE
  ))
)

const blockWidget = (height: number) => () => {
  const el = document.createElement('div')
  el.className = 'pg-block-push'
  el.style.height = `${height}px`
  el.setAttribute('contenteditable', 'false')
  el.setAttribute('aria-hidden', 'true')
  return el
}

/**
 * A table row is pushed by an empty row before it. Growing the row itself (padding,
 * a ::before in each cell) would stretch its cells — their backgrounds and borders —
 * down through the foot of the page it leaves.
 */
const rowWidget = (height: number) => () => {
  const el = document.createElement('tr')
  el.className = 'pg-row-push'
  el.style.height = `${height}px`
  el.setAttribute('contenteditable', 'false')
  el.setAttribute('aria-hidden', 'true')
  return el
}

const lineWidget = (height: number) => () => {
  const el = document.createElement('span')
  el.className = 'pg-line-push'
  el.style.height = `${height}px`
  el.setAttribute('contenteditable', 'false')
  el.setAttribute('aria-hidden', 'true')
  return el
}

const buildDecorations = (state: EditorState, pushes: Push[]): DecorationSet => {
  const decorations: Decoration[] = []
  const { doc } = state
  for (const push of pushes) {
    if (push.pos < 0 || push.pos > doc.content.size) continue
    const h = Math.round(push.height * 100) / 100
    if (push.kind === 'line') {
      decorations.push(Decoration.widget(push.pos, lineWidget(h), {
        side: -1,
        marks: [],
        ignoreSelection: true,
        key: `pg-l-${h}`,
      }))
      continue
    }
    const node = doc.nodeAt(push.pos)
    if (!node) continue
    const style = `--pg-push: ${h}px`
    if (node.type.name === 'tableRow') {
      decorations.push(Decoration.widget(push.pos, rowWidget(h), {
        side: -1,
        ignoreSelection: true,
        key: `pg-r-${h}`,
      }))
    } else if (node.isTextblock) {
      decorations.push(Decoration.node(push.pos, push.pos + node.nodeSize, { class: 'pg-push', style }))
    } else {
      decorations.push(Decoration.widget(push.pos, blockWidget(h), {
        side: -1,
        ignoreSelection: true,
        key: `pg-b-${h}`,
      }))
    }
  }
  return DecorationSet.create(doc, decorations)
}

const mapPushes = (pushes: Push[], tr: Transaction): Push[] => {
  const out: Push[] = []
  for (const p of pushes) {
    const mapped = tr.mapping.mapResult(p.pos, -1)
    if (mapped.deleted) continue
    out.push({ ...p, pos: mapped.pos })
  }
  return out
}

// Frames where there are frames; a timer where there are none (tests, a hidden
// document), so the plugin never throws for want of a renderer.
const nextFrame = (fn: () => void): number => (
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : (setTimeout(fn, 16) as unknown as number)
)
const cancelFrame = (id: number) => {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id)
  else clearTimeout(id as unknown as ReturnType<typeof setTimeout>)
}
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

class PaginationView {
  private view: EditorView
  private raf = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private passes = 0
  private pointerDown = false
  private destroyed = false
  private resizeObserver: ResizeObserver | null = null
  private lastDispatchAt = 0

  constructor(view: EditorView) {
    this.view = view
    view.dom.addEventListener('mousedown', this.onPointerDown)
    window.addEventListener('mouseup', this.onPointerUp)
    view.dom.addEventListener('compositionend', this.onCompositionEnd)
    // Images, fonts and node views change height without a transaction.
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        // A resize long after our last push is the content's own (an image decoded,
        // a board expanded): a fresh change, with a fresh pass budget. One right
        // after a push is that push landing, and spends the current budget.
        if (now() - this.lastDispatchAt > 250) this.passes = 0
        this.schedule(true)
      })
      this.resizeObserver.observe(view.dom)
    }
    this.schedule(true)
  }

  update(view: EditorView, prevState: EditorState) {
    this.view = view
    const state = paginationKey.getState(view.state)
    const prev = paginationKey.getState(prevState)
    if (!state?.frame) return
    const docChanged = view.state.doc !== prevState.doc
    if (docChanged || state.frame !== prev?.frame) {
      this.passes = 0
      this.schedule(false)
    } else if (state.pushes !== prev?.pushes) {
      // Our own pushes landed: check them once more.
      this.schedule(true)
    }
  }

  destroy() {
    this.destroyed = true
    cancelFrame(this.raf)
    if (this.timer) clearTimeout(this.timer)
    this.view.dom.removeEventListener('mousedown', this.onPointerDown)
    window.removeEventListener('mouseup', this.onPointerUp)
    this.view.dom.removeEventListener('compositionend', this.onCompositionEnd)
    this.resizeObserver?.disconnect()
  }

  private onPointerDown = () => { this.pointerDown = true }
  private onPointerUp = () => {
    if (!this.pointerDown) return
    this.pointerDown = false
    this.schedule(true)
  }
  private onCompositionEnd = () => this.schedule(true)

  /** `immediate` skips the typing debounce: a re-check, not a fresh edit. */
  schedule(immediate: boolean) {
    if (this.destroyed) return
    if (this.timer) clearTimeout(this.timer)
    cancelFrame(this.raf)
    const run = () => {
      this.raf = nextFrame(() => this.run())
    }
    if (immediate) run()
    else this.timer = setTimeout(run, SETTLE_MS)
  }

  private run() {
    const { view } = this
    if (this.destroyed || view.isDestroyed) return
    const state = paginationKey.getState(view.state)
    if (!state?.frame) return
    if (view.composing || this.pointerDown) return
    if (this.passes >= MAX_PASSES) return
    this.passes += 1

    const pushes = computePushes(view, state)
    if (!pushes) return
    if (samePushes(pushes.pushes, state.pushes) && state.result) return
    this.lastDispatchAt = now()
    view.dispatch(view.state.tr
      .setMeta(META_PUSHES, pushes)
      .setMeta('addToHistory', false))
  }
}

/**
 * The x a run of ↑/↓ presses aims for. Browsers keep this "goal column" natively;
 * the moves below replace theirs at page boundaries, so they keep their own.
 */
const goalX = new WeakMap<EditorView, number>()

/**
 * ↑/↓ in Print Layout.
 *
 * WebKit moves the caret line by line through the laid-out boxes, and between the
 * last line of one page and the first of the next there is a push — a widget or a
 * ::before a page's gap tall — which it will not step over: the caret stays where
 * it was, in both directions. So vertical moves are made here instead, the way the
 * browser makes them: step past the caret's line until a different line is under
 * the goal x, then land on that line at the goal x. A push region hit on the way
 * resolves to the line after it and is simply stepped through.
 */
const handleVerticalArrow = (view: EditorView, event: KeyboardEvent): boolean => {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
    goalX.delete(view)
    return false
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return false
  if (!paginationKey.getState(view.state)?.frame) return false

  const { selection } = view.state
  const down = event.key === 'ArrowDown'
  const head = selection.head
  const caret = view.coordsAtPos(head, down ? 1 : -1)
  const x = goalX.get(view) ?? caret.left
  const dom = view.dom as HTMLElement
  const bounds = dom.getBoundingClientRect()
  const scale = bounds.width / (dom.offsetWidth || 1) || 1
  const step = 6 * scale

  let target: number | null = null
  for (let y = down ? caret.bottom + 1 : caret.top - 1; y > bounds.top && y < bounds.bottom; y += down ? step : -step) {
    const hit = view.posAtCoords({ left: x, top: y })
    if (!hit || hit.pos === head) continue
    const at = view.coordsAtPos(hit.pos)
    const onNewLine = down ? at.top >= caret.bottom - 1 : at.bottom <= caret.top + 1
    if (!onNewLine) continue
    // Landed by way of a push: aim again at the goal x on the line it found.
    const again = view.posAtCoords({ left: x, top: (at.top + at.bottom) / 2 })
    target = again ? again.pos : hit.pos
    break
  }
  if (target == null) return false // first or last line of the document: nothing to do
  const $target = view.state.doc.resolve(target)
  if (!$target.parent.isTextblock) return false // an atom or a table edge: the browser's call

  goalX.set(view, x)
  const anchor = event.shiftKey ? selection.anchor : target
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, target)).scrollIntoView())
  return true
}

/** One measure → paginate pass over a live view. */
export const computePushes = (view: EditorView, state: PaginationState): { pushes: Push[]; result: LayoutResult } | null => {
  const frame = state.frame
  if (!frame) return null
  const dom = view.dom as HTMLElement
  if (!dom.isConnected || !dom.offsetWidth) return null
  const rect = dom.getBoundingClientRect()
  const scale = rect.width / dom.offsetWidth || 1
  const originOffset = parseFloat(getComputedStyle(dom).paddingTop) || 0
  const layoutKey = `${dom.offsetWidth}|${frame.slotHeight}|${frame.typeKey || ''}|${frame.revision || 0}`
  const units = measureUnits({ view, scale, applied: state.pushes, originOffset, layoutKey })
  const result = paginate(units, frame)
  return { pushes: result.pushes, result }
}

export interface PaginationStorage {
  /** Set by the mounted PrintLayoutView: scroll a page into view, fit the zoom. */
  goToPage: ((page: number) => void) | null
  fit: ((mode: 'width' | 'page') => void) | null
}

export const Pagination = Extension.create<Record<string, never>, PaginationStorage>({
  name: 'pagination',

  addStorage() {
    return { goToPage: null, fit: null }
  },

  addCommands() {
    return {
      setPaginationFrame: (frame: PaginationFrame | null) => ({ tr, dispatch }) => {
        if (dispatch) tr.setMeta(META_FRAME, frame).setMeta('addToHistory', false)
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<PaginationState>({
        key: paginationKey,
        state: {
          init: () => ({ frame: null, pushes: [], decorations: DecorationSet.empty, result: null }),
          apply(tr, value, _old, newState) {
            if (tr.getMeta(META_FRAME) !== undefined) {
              const frame = tr.getMeta(META_FRAME) as PaginationFrame | null
              if (!frame) return { frame: null, pushes: [], decorations: DecorationSet.empty, result: null }
              return { ...value, frame }
            }
            const next = tr.getMeta(META_PUSHES) as { pushes: Push[]; result: LayoutResult } | undefined
            if (next) {
              return { ...value, pushes: next.pushes, result: next.result, decorations: buildDecorations(newState, next.pushes) }
            }
            if (!tr.docChanged || !value.frame) return value
            const pushes = mapPushes(value.pushes, tr)
            return { ...value, pushes, decorations: value.decorations.map(tr.mapping, tr.doc) }
          },
        },
        props: {
          decorations: (state) => paginationKey.getState(state)?.decorations || DecorationSet.empty,
          handleKeyDown: handleVerticalArrow,
          handleClick: (view) => {
            goalX.delete(view)
            return false
          },
        },
        view: (view) => new PaginationView(view),
      }),
    ]
  },
})

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pagination: {
      /** Turn pagination on with a frame, or off with null. */
      setPaginationFrame: (frame: PaginationFrame | null) => ReturnType
    }
  }
}

export default Pagination

/**
 * Paginate a view to a settled layout right now, synchronously: measure, push,
 * re-measure until nothing moves. For an editor laid out off screen for printing,
 * where there is no one typing and no reason to wait for frames. Returns the result.
 */
export const settlePagination = (view: EditorView, maxPasses = 6): LayoutResult | null => {
  for (let i = 0; i < maxPasses; i += 1) {
    const state = paginationKey.getState(view.state)
    if (!state?.frame) return null
    const next = computePushes(view, state)
    if (!next) return state.result
    if (samePushes(next.pushes, state.pushes) && state.result) return state.result
    view.dispatch(view.state.tr.setMeta(META_PUSHES, next).setMeta('addToHistory', false))
  }
  return paginationKey.getState(view.state)?.result || null
}
