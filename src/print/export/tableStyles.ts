/**
 * tableStyles.ts — a table's cell fills and borders (extensions/TableStyles.js) in the
 * exported files.
 *
 * An exported file carries no design tokens, and it is read on paper or a white page,
 * so the inks are the paper theme's (tokens.css, `[data-theme='light']`) as literal
 * colours, and a fill is the same wash of its ink the editor draws.
 */
const PAPER_INKS: Record<string, string> = {
  blue: '#2f4a8a',
  teal: '#25717a',
  green: '#3b7550',
  amber: '#94660f',
  rust: '#a6541f',
  red: '#a23b32',
  violet: '#664a98',
  slate: '#56606b',
}

/** How much of its ink a filled cell takes (the editor's `--cell-ink` wash). */
const FILL_STRENGTH = 0.16

/** The colour a cell filled with `ink` is, as six hex digits without '#', or null. */
export function fillHex(ink: unknown): string | null {
  const hex = typeof ink === 'string' ? PAPER_INKS[ink] : undefined
  if (!hex) return null
  const channel = (at: number) => {
    const value = parseInt(hex.slice(at, at + 2), 16)
    return Math.round(255 + (value - 255) * FILL_STRENGTH).toString(16).padStart(2, '0')
  }
  return `${channel(1)}${channel(3)}${channel(5)}`.toUpperCase()
}

export type TableBorders = 'all' | 'outer' | 'inner' | 'none'

/** Which edges a table draws: its outside, and the lines between its cells. */
export function tableEdges(borders: unknown): { outer: boolean; inner: boolean } {
  if (borders === 'outer') return { outer: true, inner: false }
  if (borders === 'inner') return { outer: false, inner: true }
  if (borders === 'none') return { outer: false, inner: false }
  return { outer: true, inner: true }
}

/** The stylesheet rules for fills and borders, for the HTML and EPUB exports. */
export const TABLE_STYLES_CSS = [
  ...Object.keys(PAPER_INKS).map((ink) => `th[data-fill="${ink}"], td[data-fill="${ink}"] { background: #${fillHex(ink)}; }`),
  'table[data-borders="none"] th, table[data-borders="none"] td, table[data-borders="outer"] th, table[data-borders="outer"] td { border: 0; }',
  'table[data-borders="outer"] { border: 1px solid #bbb; }',
  'table[data-borders="inner"] tr:first-child > th, table[data-borders="inner"] tr:first-child > td { border-top: 0; }',
  'table[data-borders="inner"] tr:last-child > th, table[data-borders="inner"] tr:last-child > td { border-bottom: 0; }',
  'table[data-borders="inner"] th:first-child, table[data-borders="inner"] td:first-child { border-left: 0; }',
  'table[data-borders="inner"] th:last-child, table[data-borders="inner"] td:last-child { border-right: 0; }',
].join('\n')
