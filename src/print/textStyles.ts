/**
 * textStyles.ts — named text styles: a letter, a text message, verse, a sign.
 *
 * Fiction is full of text that is not narration — a letter read aloud, a phone's
 * messages, a poem, a notice on a door — and a book sets each kind the same way every
 * time it comes. So a paragraph carries only a style's name (`styleName`, set from the
 * Text Style menu in either mode), and the book says what the name looks like: the
 * app's look for it (`BUILTIN_TEXT_STYLES`), or the book's own (`BookSettings.textStyles`),
 * which may also add styles of its own.
 *
 * The looks become CSS (`textStylesCss`) for the Typeset pages and print — under the
 * page's `.has-print-type` — and for the EPUB, and paragraph styles in a DOCX. In Write,
 * a styled paragraph shows only a faint rule at its side, so the draft stays the
 * writer's.
 */
import { TextStyleAlign } from '../types'
import type { BookSettings, TextStyleLook } from '../types'

const SANS = '-apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif'

const look = (id: string, name: string, over: Partial<TextStyleLook>): TextStyleLook => ({
  id,
  name,
  size: 1,
  italic: false,
  smallCaps: false,
  align: TextStyleAlign.Inherit,
  indentEm: 0,
  flush: false,
  spaceLines: 0,
  boxed: false,
  ...over,
})

/** The app's own looks, in the order the menu lists them. */
export const BUILTIN_TEXT_STYLES: TextStyleLook[] = [
  look('letter', 'Letter', { indentEm: 2, spaceLines: 1, flush: true }),
  look('textMessage', 'Text message', { fontFamily: SANS, size: 0.88, indentEm: 2, spaceLines: 0.5, flush: true, align: TextStyleAlign.Left }),
  look('email', 'Email', { fontFamily: SANS, size: 0.9, indentEm: 1, spaceLines: 1, flush: true, align: TextStyleAlign.Left }),
  look('verse', 'Verse', { indentEm: 3, spaceLines: 1, flush: true, align: TextStyleAlign.Left }),
  look('blockQuote', 'Block quote', { size: 0.95, indentEm: 2, spaceLines: 1, flush: true }),
  look('journal', 'Journal entry', { italic: true, indentEm: 1, spaceLines: 1 }),
  look('sign', 'Sign', { smallCaps: true, align: TextStyleAlign.Center, spaceLines: 1, flush: true, boxed: true }),
  look('centered', 'Centered', { align: TextStyleAlign.Center, flush: true }),
  look('flushLeft', 'Flush left', { align: TextStyleAlign.Left, flush: true }),
]

const finite = (v: unknown, d: number, min: number, max: number) => {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d
}

/** A stored look, filled in and kept in range. */
export const normalizeTextStyle = (raw: unknown, base?: TextStyleLook): TextStyleLook | null => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : base?.id
  if (!id) return null
  const d = base || look(id, id, {})
  const family = typeof r.fontFamily === 'string' && r.fontFamily.trim() ? r.fontFamily.trim() : d.fontFamily
  return {
    id,
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : d.name,
    ...(family ? { fontFamily: family } : {}),
    size: finite(r.size, d.size, 0.5, 3),
    italic: typeof r.italic === 'boolean' ? r.italic : d.italic,
    smallCaps: typeof r.smallCaps === 'boolean' ? r.smallCaps : d.smallCaps,
    align: Object.values(TextStyleAlign).includes(r.align as TextStyleAlign) ? (r.align as TextStyleAlign) : d.align,
    indentEm: finite(r.indentEm, d.indentEm, 0, 12),
    flush: typeof r.flush === 'boolean' ? r.flush : d.flush,
    spaceLines: finite(r.spaceLines, d.spaceLines, 0, 4),
    boxed: typeof r.boxed === 'boolean' ? r.boxed : d.boxed,
  }
}

/** A book's styles: the built-in ones as it sets them, then its own. */
export const textStylesOf = (book: Partial<BookSettings> | null | undefined): TextStyleLook[] => {
  const own = Array.isArray(book?.textStyles) ? book!.textStyles : []
  const byId = new Map(own.filter((s) => s && typeof s.id === 'string').map((s) => [s.id, s]))
  const out = BUILTIN_TEXT_STYLES.map((b) => (byId.has(b.id) ? normalizeTextStyle(byId.get(b.id), b)! : b))
  for (const s of own) {
    if (!s || BUILTIN_TEXT_STYLES.some((b) => b.id === s.id)) continue
    const custom = normalizeTextStyle(s)
    if (custom) out.push(custom)
  }
  return out
}

export const isBuiltinTextStyle = (id: string): boolean => BUILTIN_TEXT_STYLES.some((b) => b.id === id)

const cssIdent = (id: string) => id.replace(/["\\]/g, '')

/**
 * The looks as CSS, each under `scope` — `.has-print-type .ProseMirror` on the pages,
 * nothing in an e-book. A run of paragraphs in one style (a letter's) is spaced as one.
 */
export const textStylesCss = (looks: TextStyleLook[], scope = ''): string => looks.map((s) => {
  const sel = `${scope ? `${scope} ` : ''}[data-style="${cssIdent(s.id)}"]`
  const rules: string[] = []
  if (s.fontFamily) rules.push(`font-family: ${s.fontFamily};`)
  if (s.size !== 1) rules.push(`font-size: ${s.size}em;`)
  if (s.italic) rules.push('font-style: italic;')
  if (s.smallCaps) rules.push('font-variant: small-caps; letter-spacing: 0.04em;')
  if (s.align !== TextStyleAlign.Inherit) rules.push(`text-align: ${s.align};`)
  if (s.indentEm) rules.push(`margin-left: ${s.indentEm}em; margin-right: ${s.indentEm}em;`)
  if (s.flush) rules.push('text-indent: 0;')
  if (s.boxed) rules.push('border: 1px solid currentColor; padding: 0.4em 0.8em;')
  const out = [`${sel} { ${rules.join(' ')} }`]
  if (s.spaceLines) {
    const space = `calc(var(--pt-leading, 1.4em) * ${s.spaceLines})`
    out.push(`${sel}:not([data-style="${cssIdent(s.id)}"] + *) { margin-top: ${space}; }`)
    out.push(`${sel}:not(:has(+ [data-style="${cssIdent(s.id)}"])) { margin-bottom: ${space}; }`)
    // The first paragraph after a run is not indented, as after a break.
    out.push(`${sel} + :not([data-style]) { text-indent: 0; }`)
  }
  return out.join('\n')
}).join('\n')

/* ---------------- the pages' stylesheet ---------------- */

const SHEET_ID = 'inkblot-text-styles'

/**
 * The book's looks on the page: one stylesheet in the document, for the Typeset pages,
 * the print job's layout and the printed pages alike. The book being typeset sets it.
 */
export const applyTextStyleSheet = (looks: TextStyleLook[]): void => {
  if (typeof document === 'undefined') return
  let sheet = document.getElementById(SHEET_ID) as HTMLStyleElement | null
  if (!sheet) {
    sheet = document.createElement('style')
    sheet.id = SHEET_ID
    document.head.appendChild(sheet)
  }
  const css = textStylesCss(looks, '.has-print-type .ProseMirror')
  if (sheet.textContent !== css) sheet.textContent = css
}
