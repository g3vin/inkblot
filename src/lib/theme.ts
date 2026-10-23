/**
 * theme.ts — the root's data-theme and data-accent attributes.
 *
 * data-theme is always set, to 'light' or 'dark'. 'System' is not a third theme:
 * it resolves to whichever of the two the OS reports, and is re-resolved when that
 * changes. So the stylesheets need only one dark rule and one light rule per surface,
 * keyed on [data-theme], never a prefers-color-scheme duplicate (docs/DESIGN.md → Themes).
 *
 * data-accent names a chrome ink from lib/palette.ts; absent means Sage. So does data-tray,
 * the window's colour behind the panels and the document card.
 */
import { DEFAULT_ACCENT, DEFAULT_TRAY, normalizeAccent, normalizeTray } from './palette'
import type { ChromeInkId } from './palette'

export type ThemeChoice = 'light' | 'dark' | 'system'

export function systemTheme(): 'light' | 'dark' {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

export function resolveTheme(choice: string | null | undefined): 'light' | 'dark' {
  return choice === 'light' || choice === 'dark' ? choice : systemTheme()
}

export function setThemeAttribute(choice: string | null | undefined): 'light' | 'dark' {
  const resolved = resolveTheme(choice)
  const root = document.documentElement
  root.setAttribute('data-theme', resolved)
  root.style.colorScheme = resolved
  return resolved
}

/** Call `onChange(resolved)` whenever the OS theme flips. Returns an unsubscribe. */
export function watchSystemTheme(onChange: (resolved: 'light' | 'dark') => void): () => void {
  const query = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : null
  if (!query) return () => {}
  const handler = () => onChange(query.matches ? 'dark' : 'light')
  query.addEventListener?.('change', handler)
  return () => query.removeEventListener?.('change', handler)
}

/** Put the accent on the root. Takes an ink id or a hex saved before the ink palette. */
export function setAccentAttribute(value: unknown): ChromeInkId {
  const id = normalizeAccent(value)
  const root = document.documentElement
  if (id === DEFAULT_ACCENT) root.removeAttribute('data-accent')
  else root.setAttribute('data-accent', id)
  // A hex left inline from before the ink palette would override the token.
  root.style.removeProperty('--accent-color')
  return id
}

/** Put the window (tray) colour on the root. Takes an ink id. */
export function setTrayAttribute(value: unknown): ChromeInkId {
  const id = normalizeTray(value)
  const root = document.documentElement
  if (id === DEFAULT_TRAY) root.removeAttribute('data-tray')
  else root.setAttribute('data-tray', id)
  return id
}
