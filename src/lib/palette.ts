/**
 * palette.ts — the ink palette: Inkblot's one set of categorical colours.
 *
 * Notes, canvas cards and edges, part-of-speech tags, map layers and the accent
 * presets all draw from these eight hues. The values live in src/styles/tokens.css
 * (one per theme); code refers to a hue by id and renders it as `var(--ink-<id>)`, so
 * every colour follows the theme with no JS. See docs/DESIGN.md → Colour.
 *
 * Saved documents are never rewritten: older notes and cards stored hex values from
 * earlier palettes, and `inkColor` maps those to the nearest ink when drawing.
 */

export type InkId = 'blue' | 'teal' | 'green' | 'amber' | 'rust' | 'red' | 'violet' | 'slate'

export interface Ink {
  id: InkId
  label: string
}

/** In display order: cool to warm, then the neutral. */
export const INKS: readonly Ink[] = [
  { id: 'blue', label: 'Ink Blue' },
  { id: 'teal', label: 'Teal' },
  { id: 'green', label: 'Green' },
  { id: 'amber', label: 'Amber' },
  { id: 'rust', label: 'Rust' },
  { id: 'red', label: 'Red' },
  { id: 'violet', label: 'Violet' },
  { id: 'slate', label: 'Slate' },
]

const INK_IDS = new Set<string>(INKS.map((ink) => ink.id))

export const isInkId = (value: unknown): value is InkId =>
  typeof value === 'string' && INK_IDS.has(value)

/** The CSS value for an ink, e.g. `var(--ink-teal)`. */
export const inkVar = (id: InkId): string => `var(--ink-${id})`

/**
 * Hex values written by palettes before the ink palette, mapped to the ink that took
 * each one's place. Lower-case keys.
 */
const LEGACY_HEX_TO_INK: Record<string, InkId> = {
  // Note colours
  '#ffd54f': 'amber',
  '#ff9aa2': 'red',
  '#9ad0f5': 'blue',
  '#9ee493': 'green',
  '#c7a8ff': 'violet',
  '#ffb86b': 'rust',
  '#007aff': 'blue',
  // Canvas presets as hex
  '#e5534b': 'red',
  '#e8873c': 'rust',
  '#e0b341': 'amber',
  '#4fb477': 'green',
  '#3fa9c4': 'teal',
  '#a07cd4': 'violet',
  // Accent presets
  '#7aaef7': 'blue',
  '#58cbb3': 'teal',
  '#ff8c73': 'rust',
  '#f47ca3': 'red',
  '#f0be57': 'amber',
  '#47b8d6': 'teal',
}

/** The ink a legacy hex value maps to, or null for a hex from outside every old palette. */
export const legacyInkFor = (value: unknown): InkId | null => {
  if (typeof value !== 'string') return null
  return LEGACY_HEX_TO_INK[value.trim().toLowerCase()] ?? null
}

/**
 * Any stored colour → a CSS colour.
 *  - an ink id ('teal')                 → var(--ink-teal)
 *  - a hex from an earlier palette      → its ink
 *  - any other CSS colour (a custom hex) → passed through untouched
 *  - nothing                            → `fallback`
 */
export const inkColor = (value: unknown, fallback: string = inkVar('blue')): string => {
  if (isInkId(value)) return inkVar(value)
  const legacy = legacyInkFor(value)
  if (legacy) return inkVar(legacy)
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

/**
 * The hex an ink currently renders as, for the few APIs that need a literal colour
 * (an <input type="color">, a canvas 2D context). Reads the live token, so it follows
 * the theme; falls back to `fallback` outside a DOM.
 */
export const resolveInkHex = (value: unknown, fallback = '#000000'): string => {
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim())) return value.trim()
  const id = isInkId(value) ? value : legacyInkFor(value)
  if (!id || typeof document === 'undefined') return fallback
  const hex = getComputedStyle(document.documentElement).getPropertyValue(`--ink-${id}`).trim()
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex : fallback
}

/* ---- Per-feature assignments -------------------------------------------- */

/** Accent presets. Keep in sync with the [data-accent] rules in tokens.css. */
export const ACCENT_PRESETS: readonly Ink[] = INKS.filter((ink) =>
  ['blue', 'teal', 'green', 'amber', 'rust', 'violet'].includes(ink.id))

export const DEFAULT_ACCENT: InkId = 'blue'

/** A stored accent (an ink id, or a hex from before the ink palette) → a preset id. */
export const normalizeAccent = (value: unknown): InkId => {
  const id = isInkId(value) ? value : legacyInkFor(value)
  return id && ACCENT_PRESETS.some((preset) => preset.id === id) ? id : DEFAULT_ACCENT
}

/** Note colours, in picker order. Amber reads as "a note" at a glance. */
export const NOTE_INKS: readonly InkId[] = ['amber', 'red', 'blue', 'green', 'violet', 'rust', 'teal', 'slate']
export const DEFAULT_NOTE_INK: InkId = 'amber'

/**
 * JSON Canvas colour presets. The spec's ids '1'–'6' mean red, orange, yellow, green,
 * cyan and purple; they stay the stored value so files round-trip with Obsidian.
 */
export const CANVAS_PRESET_INKS: Readonly<Record<string, InkId>> = {
  1: 'red',
  2: 'rust',
  3: 'amber',
  4: 'green',
  5: 'teal',
  6: 'violet',
}

/** Part-of-speech tags in the Workbench. */
export const POS_INKS: Readonly<Record<string, string>> = {
  Noun: inkVar('blue'),
  Verb: inkVar('green'),
  Adjective: inkVar('rust'),
  Adverb: inkVar('red'),
  Number: inkVar('teal'),
  Pronoun: inkVar('violet'),
  Determiner: inkVar('amber'),
  Conjunction: inkVar('slate'),
  Preposition: 'var(--text-muted)',
  Unknown: 'var(--text-subtle)',
}

/**
 * The writer's text colour and highlighter, as stored in the document's marks. They are
 * the document's own colours (like a printed page's), so they stay literal.
 */
export const DEFAULT_TEXT_COLOR = '#000000'
export const DEFAULT_HIGHLIGHT_COLOR = '#ffff00'
