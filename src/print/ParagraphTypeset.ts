/**
 * ParagraphTypeset.ts — what a typesetter sets on one paragraph to mend a page.
 *
 *   tracking      letter-spacing in thousandths of an em, −10 to +10: tight enough to
 *                 take a runt back up, loose enough to push a word over. Invisible at
 *                 that size; it is how a book's pages are made to come out even.
 *   keepTogether  the paragraph is never split across pages.
 *   keepWithNext  it never ends a page: it goes over with what follows.
 *   pageAdjust    the page it starts on runs a line long (+1) or short (−1) — the
 *                 typesetter's last resort for a widow — which pagination honours.
 *   styleName     a named text style — a letter, verse (textStyles.ts) — which, unlike
 *                 the rest, a paragraph split in two keeps in both halves.
 *
 * Print only: the rules that draw them hang off `.has-print-type`, and pagination
 * (measure.ts) reads them only on pages. Typeset attributes, so a block that gets one
 * gets a `typesetId` (TypesetAnchors.ts), and the change is typesetting, not writing.
 */
import { Extension } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'

import { anchorBlock } from './TypesetAnchors'
import { TYPESET_META } from './TypesetLock'

export const TRACKING_LIMIT = 10
export const TRACKING_STEP = 5

export interface ParagraphTypesetPatch {
  tracking?: number
  nudgeTracking?: number
  keepTogether?: boolean
  keepWithNext?: boolean
  pageAdjust?: number
  /** A named style, or null for none. */
  styleName?: string | null
}

export const clampTracking = (n: number): number => Math.max(-TRACKING_LIMIT, Math.min(TRACKING_LIMIT, Math.round(n)))

/** What is set on a paragraph, with nothing set as the defaults. */
export const paragraphTypesetOf = (node: PMNode | null | undefined) => ({
  tracking: Number(node?.attrs?.tracking) || 0,
  keepTogether: Boolean(node?.attrs?.keepTogether),
  keepWithNext: Boolean(node?.attrs?.keepWithNext),
  pageAdjust: Number(node?.attrs?.pageAdjust) || 0,
  styleName: typeof node?.attrs?.styleName === 'string' && node.attrs.styleName ? node.attrs.styleName as string : null,
})

/**
 * Set `patch` on every paragraph from `from` to `to` (or the one `from` is in), in `tr`.
 * A heading takes only keep-with-next, which it already has. Returns how many blocks
 * were changed.
 */
export const setParagraphTypeset = (tr: Transaction, from: number, to: number, patch: ParagraphTypesetPatch): number => {
  const targets: Array<{ pos: number; node: PMNode }> = []
  tr.doc.nodesBetween(from, Math.max(from, to), (node, pos) => {
    if (node.type.name === 'paragraph') {
      targets.push({ pos, node })
      return false
    }
    return true
  })
  if (!targets.length) {
    const $from = tr.doc.resolve(from)
    for (let d = $from.depth; d > 0; d -= 1) {
      const node = $from.node(d)
      if (node.type.name === 'paragraph') {
        targets.push({ pos: $from.before(d), node })
        break
      }
    }
  }
  let changed = 0
  for (const { pos, node } of targets) {
    const now = paragraphTypesetOf(node)
    const next = { ...now }
    if (patch.tracking != null) next.tracking = clampTracking(patch.tracking)
    if (patch.nudgeTracking) next.tracking = clampTracking(now.tracking + patch.nudgeTracking)
    if (patch.keepTogether != null) next.keepTogether = patch.keepTogether
    if (patch.keepWithNext != null) next.keepWithNext = patch.keepWithNext
    if (patch.pageAdjust != null) next.pageAdjust = Math.max(-1, Math.min(1, Math.round(patch.pageAdjust)))
    if (patch.styleName !== undefined) next.styleName = patch.styleName || null
    const keys = (Object.keys(next) as Array<keyof typeof next>).filter((k) => next[k] !== now[k])
    if (!keys.length) continue
    anchorBlock(tr, pos)
    for (const key of keys) {
      const value = next[key]
      // Nothing set is stored as nothing.
      tr.setNodeAttribute(pos, key, value === 0 || value === false || value === '' ? null : value)
    }
    changed += 1
  }
  if (changed) tr.setMeta(TYPESET_META, true)
  return changed
}

export const ParagraphTypeset = Extension.create({
  name: 'paragraphTypeset',

  addGlobalAttributes() {
    // Kept in the document's JSON; in HTML only what the page draws with.
    const jsonOnly = { parseHTML: () => null }
    return [
      {
        types: ['paragraph'],
        attributes: {
          styleName: {
            default: null,
            // A letter goes on being a letter after Enter.
            keepOnSplit: true,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-style') || null,
            renderHTML: (attrs: Record<string, unknown>) => (attrs.styleName ? { 'data-style': String(attrs.styleName) } : {}),
          },
          tracking: {
            default: null,
            keepOnSplit: false,
            ...jsonOnly,
            renderHTML: (attrs: Record<string, unknown>) => {
              const n = Number(attrs.tracking) || 0
              return n ? { 'data-tracking': String(n), style: `--pt-tracking: ${n / 1000}em` } : {}
            },
          },
          keepTogether: {
            default: null,
            keepOnSplit: false,
            ...jsonOnly,
            renderHTML: (attrs: Record<string, unknown>) => (attrs.keepTogether ? { 'data-keep-together': '' } : {}),
          },
          keepWithNext: {
            default: null,
            keepOnSplit: false,
            ...jsonOnly,
            renderHTML: (attrs: Record<string, unknown>) => (attrs.keepWithNext ? { 'data-keep-with-next': '' } : {}),
          },
          pageAdjust: {
            default: null,
            keepOnSplit: false,
            ...jsonOnly,
            renderHTML: (attrs: Record<string, unknown>) => {
              const n = Number(attrs.pageAdjust) || 0
              return n ? { 'data-page-adjust': String(n) } : {}
            },
          },
        },
      },
    ]
  },
})
