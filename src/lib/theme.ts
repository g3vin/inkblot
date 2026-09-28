/**
 * theme.ts — the root's data-theme attribute.
 *
 * The attribute is always set, to 'light' or 'dark'. 'System' is not a third theme:
 * it resolves to whichever of the two the OS reports, and is re-resolved when that
 * changes. So the stylesheets need only one dark rule and one light rule per surface,
 * keyed on [data-theme], never a prefers-color-scheme duplicate.
 */

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
