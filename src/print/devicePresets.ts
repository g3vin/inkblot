/**
 * devicePresets.ts — the screens an e-book is read on, for the Digital preview.
 *
 * Each is the reading area in CSS pixels, upright, and how many of those pixels make an
 * inch on the device, so the preview can say how big the page really is. E-ink readers
 * are given at 100 px to the inch (their 300 ppi panels at a third), which sets their
 * type about as large as it looks in the hand; phones and tablets at their own points.
 */

export interface DevicePreset {
  id: string
  name: string
  /** Portrait width and height, in CSS px. */
  width: number
  height: number
  /** CSS px to the device's inch. */
  ppi: number
  kind: 'eink' | 'phone' | 'tablet' | 'desktop'
}

export const DEVICE_PRESETS: DevicePreset[] = [
  { id: 'kindle-paperwhite', name: 'Kindle Paperwhite', width: 412, height: 549, ppi: 100, kind: 'eink' },
  { id: 'kindle-scribe', name: 'Kindle Scribe', width: 620, height: 827, ppi: 100, kind: 'eink' },
  { id: 'kobo-clara', name: 'Kobo Clara', width: 357, height: 483, ppi: 100, kind: 'eink' },
  { id: 'iphone', name: 'iPhone', width: 393, height: 852, ppi: 153, kind: 'phone' },
  { id: 'iphone-se', name: 'iPhone SE', width: 375, height: 667, ppi: 163, kind: 'phone' },
  { id: 'android', name: 'Android Phone', width: 412, height: 915, ppi: 163, kind: 'phone' },
  { id: 'ipad-mini', name: 'iPad mini', width: 744, height: 1133, ppi: 163, kind: 'tablet' },
  { id: 'ipad-pro', name: 'iPad Pro', width: 1032, height: 1376, ppi: 132, kind: 'tablet' },
  { id: 'books-mac', name: 'Apple Books on Mac', width: 1024, height: 720, ppi: 110, kind: 'desktop' },
]

export const DEFAULT_DEVICE = 'kindle-paperwhite'

/** The smallest and largest a viewport can be dragged to. */
export const VIEWPORT_MIN = { width: 240, height: 320 }
export const VIEWPORT_MAX = { width: 2000, height: 1600 }

export const devicePreset = (id: string | null | undefined): DevicePreset | null => (
  DEVICE_PRESETS.find((d) => d.id === id) || null
)

export const clampViewport = (width: number, height: number): { width: number; height: number } => ({
  width: Math.round(Math.min(VIEWPORT_MAX.width, Math.max(VIEWPORT_MIN.width, width))),
  height: Math.round(Math.min(VIEWPORT_MAX.height, Math.max(VIEWPORT_MIN.height, height))),
})

/**
 * Two pages side by side, as reading systems set a wide screen held landscape.
 */
export const isSpreadViewport = (width: number, height: number): boolean => width >= 900 && width > height

/* ---------------- the reader's own settings ---------------- */

export type ReaderTheme = 'white' | 'sepia' | 'gray' | 'night'
export type ReaderSpacing = 'publisher' | 'tight' | 'loose'
export type ReaderMargins = 'narrow' | 'normal' | 'wide'
export type ReaderAlign = 'publisher' | 'left' | 'justify'

export interface ReaderSettings {
  /** Type size, as a multiple of the book's. */
  scale: number
  theme: ReaderTheme
  /** The book's own font, or the reader's. */
  publisherFont: boolean
  spacing: ReaderSpacing
  margins: ReaderMargins
  align: ReaderAlign
}

export const DEFAULT_READER: ReaderSettings = {
  scale: 1,
  theme: 'white',
  publisherFont: true,
  spacing: 'publisher',
  margins: 'normal',
  align: 'publisher',
}

/** Type size steps, as readers offer them. */
export const READER_SCALES = [0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2]

export const READER_THEMES: Record<ReaderTheme, { name: string; background: string; color: string; dark: boolean }> = {
  white: { name: 'White', background: '#ffffff', color: '#1b1b1b', dark: false },
  sepia: { name: 'Sepia', background: '#f6ecd9', color: '#4b3a28', dark: false },
  gray: { name: 'Gray', background: '#48484a', color: '#e5e5e7', dark: true },
  night: { name: 'Night', background: '#000000', color: '#b8b8b8', dark: true },
}

/** The reader's settings, from stored JSON; the defaults where it says nothing sensible. */
export const normalizeReader = (value: unknown): ReaderSettings => {
  const r = (value && typeof value === 'object' ? value : {}) as Partial<ReaderSettings>
  const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d)
  return {
    scale: READER_SCALES.includes(r.scale as number) ? (r.scale as number) : DEFAULT_READER.scale,
    theme: pick(r.theme, Object.keys(READER_THEMES) as ReaderTheme[], DEFAULT_READER.theme),
    publisherFont: typeof r.publisherFont === 'boolean' ? r.publisherFont : DEFAULT_READER.publisherFont,
    spacing: pick(r.spacing, ['publisher', 'tight', 'loose'] as const, DEFAULT_READER.spacing),
    margins: pick(r.margins, ['narrow', 'normal', 'wide'] as const, DEFAULT_READER.margins),
    align: pick(r.align, ['publisher', 'left', 'justify'] as const, DEFAULT_READER.align),
  }
}

/** Side margins, as a share of the screen's width; top and bottom a fixed share of its height. */
const MARGIN_SHARE: Record<ReaderMargins, number> = { narrow: 0.04, normal: 0.07, wide: 0.11 }
const MARGIN_TOP_SHARE = 0.05

/** The body text's size before the reader scales it. */
export const READER_BASE_PX = 18

/**
 * The CSS that lays the book out as a reading system does — in pages, as columns one
 * screen wide, turned by scrolling a screen at a time — with the reader's settings over
 * the book's own.
 */
export const readerCss = (reader: ReaderSettings, width: number, height: number): string => {
  const theme = READER_THEMES[reader.theme]
  const padX = Math.round(width * MARGIN_SHARE[reader.margins])
  const padY = Math.round(height * MARGIN_TOP_SHARE)
  const spread = isSpreadViewport(width, height)
  // A column and its gap are one screen (or half of one, in a spread), so a page turn
  // is a scroll of exactly the screen's width.
  const columnWidth = spread ? (width - padX * 4) / 2 : width - padX * 2
  const lines = [
    `html { height: ${height}px; overflow: hidden; background: ${theme.background}; }`,
    `body { margin: 0; padding: ${padY}px ${padX}px; box-sizing: border-box; height: ${height}px; width: ${width}px;
      -webkit-column-width: ${columnWidth}px; column-width: ${columnWidth}px;
      -webkit-column-gap: ${padX * 2}px; column-gap: ${padX * 2}px; column-fill: auto;
      background: ${theme.background}; color: ${theme.color}; font-size: ${Math.round(READER_BASE_PX * reader.scale * 10) / 10}px; }`,
    // Each of the book's files starts a page, as a reading system opens each one.
    '.ebook-item { -webkit-column-break-before: always; break-before: column; }',
    '.ebook-item:first-child { -webkit-column-break-before: auto; break-before: auto; }',
    `img { max-height: ${height - padY * 2}px; object-fit: contain; }`,
    '.cover { height: 100%; display: flex; align-items: center; justify-content: center; margin: 0; }',
    '.cover img { max-width: 100%; }',
    'a { color: inherit; }',
    'hr { border-color: currentColor; }',
    'blockquote { color: inherit; }',
  ]
  if (theme.dark) lines.push('th { background: rgba(255,255,255,0.08); }', 'mark { color: #1b1b1b; }')
  if (!reader.publisherFont) lines.push("body, body :not(pre, code, pre *) { font-family: Georgia, 'Iowan Old Style', serif !important; }")
  if (reader.spacing === 'tight') lines.push('body, body p { line-height: 1.3 !important; }')
  if (reader.spacing === 'loose') lines.push('body, body p { line-height: 1.85 !important; }')
  // Only the running text: a centred line, a head, a title page keep their own.
  const running = 'body p:not([style*="text-align"]):not(.chapter-head *):not(.front-matter *)'
  if (reader.align === 'left') lines.push(`${running} { text-align: left !important; }`)
  if (reader.align === 'justify') lines.push(`${running} { text-align: justify !important; }`)
  return lines.join('\n')
}
