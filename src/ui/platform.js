/**
 * platform.js — the one platform distinction the design language makes.
 *
 * Every platform wears the same Inkblot styling. On iOS and iPadOS only, floating
 * toolbars and floating action buttons (src/ui/FloatingToolbar, FloatingActionButton)
 * switch to a Liquid Glass surface, to sit comfortably beside the system's own glass.
 * Nothing else changes per platform. See docs/DESIGN.md → Platforms.
 *
 * Exposed to CSS as `data-platform="ios"` on <html>.
 */

/** True on iPhone and iPad (including iPadOS, which reports itself as a Mac). */
export const isTouchApplePlatform = () => {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod/.test(ua)) return true
  return /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1
}

export const applyPlatformAttribute = () => {
  if (typeof document === 'undefined') return
  if (isTouchApplePlatform()) document.documentElement.setAttribute('data-platform', 'ios')
}
