/**
 * systemFonts.js — the font list backing the toolbar's font picker.
 *
 * Fonts are enumerated from the OS by the `list_system_fonts` Rust command, so
 * anything the user installs (Font Book, Adobe, Homebrew casks…) shows up on
 * the next launch with no code change. The Local Font Access API is not an
 * option here: Tauri renders in WKWebView on macOS and WebKit does not
 * implement `queryLocalFonts`.
 *
 * Outside Tauri (plain `vite` dev in a browser) the invoke fails, and we fall
 * back to the web-safe families that ship with every macOS install.
 */
import { invoke } from '@tauri-apps/api/core'

/** Pinned to the top of the picker so the common choices stay one click away. */
export const SUGGESTED_FONTS = [
  'Georgia',
  'Times New Roman',
  'Helvetica Neue',
  'Arial',
  'Verdana',
  'Courier New',
  'Menlo',
  'Optima',
  'Palatino',
  'Baskerville',
]

/** Used when the OS list is unavailable; every one of these ships with macOS. */
const FALLBACK_FONTS = [
  ...SUGGESTED_FONTS,
  'American Typewriter',
  'Andale Mono',
  'Avenir',
  'Avenir Next',
  'Big Caslon',
  'Bodoni 72',
  'Brush Script MT',
  'Chalkboard',
  'Cochin',
  'Copperplate',
  'Didot',
  'Futura',
  'Garamond',
  'Gill Sans',
  'Hoefler Text',
  'Impact',
  'Lucida Grande',
  'Marker Felt',
  'Monaco',
  'Papyrus',
  'Rockwell',
  'Snell Roundhand',
  'Tahoma',
  'Trebuchet MS',
]

const byName = (left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' })

const dedupeSorted = (fonts) => [...new Set(fonts)].sort(byName)

// A CSS <family-name> may go unquoted only if every space-separated token starts
// with a letter. "Bodoni 72" and "72 Sans" would otherwise parse as a number and
// break the declaration, so those get quoted.
const isSafeUnquotedFamily = (name) => /^[A-Za-z][A-Za-z0-9-]*( [A-Za-z][A-Za-z0-9-]*)*$/.test(name)

/**
 * Family name as it should be written into the `fontFamily` mark. Plain names
 * are left bare, which keeps documents written before this change byte-identical.
 */
export const toCssFontFamily = (name) => (
  isSafeUnquotedFamily(name) ? name : `"${name.replace(/"/g, '\\"')}"`
)

/** Inverse of {@link toCssFontFamily}: the stored mark back to a display name. */
export const fromCssFontFamily = (value) => {
  if (!value) return ''
  const trimmed = String(value).trim()
  const unquoted = /^(['"])(.*)\1$/.exec(trimmed)
  return (unquoted ? unquoted[2].replace(/\\(['"])/g, '$1') : trimmed).trim()
}

/* ---- Pinned & recent fonts -------------------------------------------------
   Both are persisted to localStorage (the same place the theme and accent live)
   and surfaced as sections at the top of the native font menu. */

const PINNED_STORAGE_KEY = 'inkblot.fonts.pinned'
const RECENT_STORAGE_KEY = 'inkblot.fonts.recent'

/** Recents past this point stop being "recent" and just crowd the menu. */
export const MAX_RECENT_FONTS = 5

const readStoredFonts = (key) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]')
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter(font => typeof font === 'string' && font.trim()))]
  } catch {
    return []
  }
}

const writeStoredFonts = (key, fonts) => {
  try {
    localStorage.setItem(key, JSON.stringify(fonts))
  } catch {
    // A full or unavailable localStorage must not take the font picker down.
  }
}

export const loadPinnedFonts = () => readStoredFonts(PINNED_STORAGE_KEY)

/** Pin or unpin `font`, returning the new pinned list (kept alphabetical). */
export const togglePinnedFont = (font) => {
  const pinned = loadPinnedFonts()
  const next = pinned.includes(font)
    ? pinned.filter(entry => entry !== font)
    : dedupeSorted([...pinned, font])

  writeStoredFonts(PINNED_STORAGE_KEY, next)
  return next
}

export const loadRecentFonts = () => readStoredFonts(RECENT_STORAGE_KEY)

/** Move `font` to the front of the recents, returning the new list. */
export const rememberRecentFont = (font) => {
  const next = [font, ...loadRecentFonts().filter(entry => entry !== font)]
    .slice(0, MAX_RECENT_FONTS)

  writeStoredFonts(RECENT_STORAGE_KEY, next)
  return next
}

/**
 * Group the font list into the sections shown in the native menu, top to bottom:
 * Pinned, Recent, Suggested, then everything else.
 *
 * A font lands in exactly one section, so the `<select>` value always maps to a
 * single `<option>`. Pinned and recent entries that are no longer installed
 * (a font removed in Font Book, or a note authored on another machine) are
 * dropped rather than offered as choices that would not render.
 *
 * `systemFonts` may be empty while the OS list is still loading; until it
 * arrives every font is treated as installed so the picker is never blank.
 *
 * @returns {{ sections: {label: string, fonts: string[]}[], missingCurrentFont: boolean }}
 *   `missingCurrentFont` is true when the document's font is not installed here;
 *   the caller should still offer it, so opening the menu does not silently
 *   reassign the font.
 */
export const buildFontSections = ({
  systemFonts = [],
  pinnedFonts = [],
  recentFonts = [],
  currentFont = '',
} = {}) => {
  const isInstalled = (font) => systemFonts.length === 0 || systemFonts.includes(font)

  const pinned = pinnedFonts.filter(isInstalled)
  const recent = recentFonts.filter(font => isInstalled(font) && !pinned.includes(font))
  const claimed = new Set([...pinned, ...recent])
  const suggested = SUGGESTED_FONTS.filter(font => isInstalled(font) && !claimed.has(font))
  const rest = systemFonts.filter(font => !claimed.has(font) && !suggested.includes(font))

  const sections = [
    { label: 'Pinned', fonts: pinned },
    { label: 'Recent', fonts: recent },
    { label: 'Suggested', fonts: suggested },
    { label: 'All fonts', fonts: rest },
  ].filter(section => section.fonts.length > 0)

  const missingCurrentFont = Boolean(currentFont)
    && !sections.some(section => section.fonts.includes(currentFont))

  return { sections, missingCurrentFont }
}

let cachedFontsPromise = null

/**
 * Every installed font family, sorted. Resolves once and is cached for the
 * session — the OS list does not change while the app is open, and re-invoking
 * on every toolbar mount would be wasteful.
 */
export const loadSystemFonts = () => {
  if (cachedFontsPromise) return cachedFontsPromise

  cachedFontsPromise = invoke('list_system_fonts')
    .then((fonts) => (
      Array.isArray(fonts) && fonts.length > 0
        ? dedupeSorted(fonts)
        : dedupeSorted(FALLBACK_FONTS)
    ))
    .catch(() => dedupeSorted(FALLBACK_FONTS))

  return cachedFontsPromise
}
