/**
 * bleed.ts — pictures to a page's edges, and the bleed a printer needs for them.
 *
 * A picture set to `bleed` has a page to itself and fills it past the trimmed edges.
 * In the flow it keeps its place, unseen (PrintTypography.css); the page draws it,
 * over the whole page. And a book with one prints with bleed — as KDP and IngramSpark
 * ask: an eighth of an inch more at the top, the bottom and the outside edge of every
 * page, which the picture runs into and the printer trims away.
 */
import type { EditorView } from '@tiptap/pm/view'

import { mmToPx } from './pageSizes'
import { BLEED_MM } from './coverWrap'

/** The pictures set to bleed in a laid-out document: where each is, and what it shows. */
export const bleedPicturesOf = (view: EditorView): Array<{ pos: number; src: string }> => {
  const out: Array<{ pos: number; src: string }> = []
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'image' || node.attrs.layout !== 'bleed') return true
    const dom = view.nodeDOM(pos) as HTMLElement | null
    const img = dom?.querySelector?.('img') || (dom instanceof HTMLImageElement ? dom : null)
    const src = img?.currentSrc || img?.src || String(node.attrs.src || '')
    if (src) out.push({ pos, src })
    return false
  })
  return out
}

/** The bleed, in px, for a print that has pictures to the edge; none otherwise. */
export const bleedPxFor = (hasBleed: boolean): number => (hasBleed ? mmToPx(BLEED_MM) : 0)

/**
 * A page with bleed round it: the trimmed page set inside a larger one, at the top
 * and bottom and on its outside — the left of a verso, the right of a recto.
 */
export const withBleed = (page: HTMLElement, physical: number, bleedPx: number): HTMLElement => {
  const width = parseFloat(page.style.width)
  const height = parseFloat(page.style.height)
  const outer = page.ownerDocument.createElement('div')
  outer.className = 'print-page has-bleed'
  for (const key of Object.keys(page.dataset)) outer.dataset[key] = page.dataset[key] as string
  Object.assign(outer.style, {
    width: `${width + bleedPx}px`,
    height: `${height + bleedPx * 2}px`,
    position: 'relative',
    overflow: 'hidden',
    background: '#ffffff',
  })
  page.classList.add('is-trim')
  Object.assign(page.style, {
    position: 'absolute',
    left: `${physical % 2 === 0 ? bleedPx : 0}px`,
    top: `${bleedPx}px`,
    overflow: 'visible',
  })
  outer.appendChild(page)
  return outer
}
