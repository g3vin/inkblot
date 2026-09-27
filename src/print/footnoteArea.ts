/**
 * footnoteArea.ts — the notes at a page's foot: a short rule, then each note, in the
 * note size.
 *
 * One builder for every page that shows them — the Typeset pages and the printed ones —
 * and one measurer, which pagination asks how tall each note will be (measure.ts), so
 * the room it keeps at a page's foot is the room the notes take there. The area's
 * height is its rule's plus its notes', exactly: no margins collapse inside it.
 */

export interface AreaNote {
  mark: string
  text: string
}

/** The notes at one page's foot, as an element (placed by the caller). */
export const buildFootnoteArea = (notes: AreaNote[], doc: Document = document): HTMLElement => {
  const area = doc.createElement('div')
  area.className = 'pl-footnotes'
  for (const note of notes) {
    const p = doc.createElement('p')
    p.className = 'pl-footnote'
    const mark = doc.createElement('span')
    mark.className = 'pl-footnote-mark'
    mark.textContent = note.mark
    p.append(mark, doc.createTextNode(note.text))
    area.appendChild(p)
  }
  return area
}

export interface NoteMeasurer {
  /** The rule over the notes, and the space around it. */
  separator: number
  /** One note's height. */
  note: (mark: string, text: string) => number
}

const cache = new WeakMap<HTMLElement, { width: number; key: string; separator: number; heights: Map<string, number> }>()

/**
 * Measure notes in `host` — anything under the page's typography — at `width`. Kept
 * per host, and thrown away when the width or the type (`typeKey`) changes.
 */
export const noteMeasurer = (host: HTMLElement, width: number, typeKey = ''): NoteMeasurer => {
  let entry = cache.get(host)
  if (!entry || entry.width !== width || entry.key !== typeKey) {
    const probe = buildFootnoteArea([], host.ownerDocument)
    Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', left: '-100000px', top: '0', width: `${width}px` })
    host.appendChild(probe)
    const separator = probe.offsetHeight
    probe.remove()
    entry = { width, key: typeKey, separator, heights: new Map() }
    cache.set(host, entry)
  }
  const e = entry
  return {
    separator: e.separator,
    note: (mark, text) => {
      const key = `${mark}\u0000${text}`
      const known = e.heights.get(key)
      if (known != null) return known
      const probe = buildFootnoteArea([{ mark, text }], host.ownerDocument)
      Object.assign(probe.style, { position: 'absolute', visibility: 'hidden', left: '-100000px', top: '0', width: `${width}px` })
      host.appendChild(probe)
      const height = Math.max(0, probe.offsetHeight - e.separator)
      probe.remove()
      e.heights.set(key, height)
      return height
    },
  }
}
