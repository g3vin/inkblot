/**
 * theme.js — puts the theme and accent on <html>.
 *
 * `data-theme` is always the RESOLVED theme, 'light' or 'dark': "System" is decided
 * here against the OS and re-decided when the OS flips. Stylesheets therefore write
 * each theme once and never need a prefers-color-scheme block (docs/DESIGN.md → Themes).
 *
 * `data-accent` names an ink from src/lib/palette.ts; absent means Ink Blue.
 */
import { DEFAULT_ACCENT, normalizeAccent } from './palette'

export const THEME_PREFERENCES = ['system', 'light', 'dark']

const systemQuery = () => (typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null)

/** 'system' | 'light' | 'dark' → 'light' | 'dark'. */
export const resolveTheme = (preference) => {
  if (preference === 'light' || preference === 'dark') return preference
  return systemQuery()?.matches === false ? 'light' : 'dark'
}

/** Write the resolved theme onto <html>. Returns what it resolved to. */
export const applyThemeAttribute = (preference) => {
  const resolved = resolveTheme(preference)
  const root = document.documentElement
  root.setAttribute('data-theme', resolved)
  root.style.colorScheme = resolved
  return resolved
}

/** Call `onChange(resolved)` whenever the OS theme flips. Returns an unsubscribe. */
export const watchSystemTheme = (onChange) => {
  const query = systemQuery()
  if (!query) return () => {}
  const handler = () => onChange(query.matches ? 'dark' : 'light')
  query.addEventListener?.('change', handler)
  return () => query.removeEventListener?.('change', handler)
}

/** Write the accent onto <html>. Accepts an ink id or a legacy hex; returns the id used. */
export const applyAccentAttribute = (value) => {
  const id = normalizeAccent(value)
  const root = document.documentElement
  if (id === DEFAULT_ACCENT) root.removeAttribute('data-accent')
  else root.setAttribute('data-accent', id)
  // Anything left over from the hex era would override the token; clear it.
  root.style.removeProperty('--accent-color')
  return id
}
