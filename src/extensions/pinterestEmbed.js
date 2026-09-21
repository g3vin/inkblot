/**
 * pinterestEmbed.js — Pinterest's own widget script, and the URLs it wants.
 *
 * The public pidgets endpoint serves boards that need no login; private boards
 * and sections fall back to the session scraper in lib/pinterestScrape.js.
 */
export const PINTEREST_SCRIPT_ID = 'inkblot-pinterest-pinit-js'
export const PINTEREST_SCRIPT_SRC = 'https://assets.pinterest.com/js/pinit.js'

export const PINTEREST_PIDGETS_BASE = 'https://widgets.pinterest.com/v3/pidgets/boards'

export const parsePinterestBoardParts = (pinterestUrl) => {
  if (!pinterestUrl) return null
  let url
  try {
    url = new URL(String(pinterestUrl))
  } catch {
    return null
  }

  const host = url.hostname.toLowerCase()
  if (!(host === 'pinterest.com' || host === 'www.pinterest.com')) return null

  const segments = url.pathname
    .split('/')
    .map(s => s.trim())
    .filter(Boolean)

  if (segments.length < 2) return null

  const [user, board] = segments
  const reservedThird = new Set(['pins', 'activity', 'ideas', 'more_ideas'])
  const third = segments[2]
  const section = third && !reservedThird.has(third.toLowerCase()) ? third : null

  return { user, board, section }
}

export const pidgetsPinsUrlFromPinterestUrl = (pinterestUrl) => {
  const parts = parsePinterestBoardParts(pinterestUrl)
  if (!parts) return null

  const base = `${PINTEREST_PIDGETS_BASE}/${encodeURIComponent(parts.user)}/${encodeURIComponent(parts.board)}/pins/`

  // NOTE: `?section=<slug>` appears accepted but is NOT reliably filtered.
  // We keep the base endpoint here and handle section-specific fetching elsewhere.
  return base
}

export const ensurePinterestScriptLoaded = (() => {
  let promise = null

  return () => {
    if (typeof window === 'undefined') return Promise.resolve(false)

    // Already loaded
    if (window.PinUtils && typeof window.PinUtils.build === 'function') {
      return Promise.resolve(true)
    }

    if (promise) return promise

    promise = new Promise(resolve => {
      const existing = document.getElementById(PINTEREST_SCRIPT_ID)
      if (existing) {
        existing.addEventListener('load', () => resolve(true), { once: true })
        existing.addEventListener('error', () => resolve(false), { once: true })
        return
      }

      const script = document.createElement('script')
      script.id = PINTEREST_SCRIPT_ID
      script.async = true
      script.defer = true
      script.src = PINTEREST_SCRIPT_SRC
      script.onload = () => resolve(true)
      script.onerror = () => resolve(false)
      document.head.appendChild(script)
    })

    return promise
  }
})()

export const buildPinterestEmbeds = (rootEl) => {
  try {
    if (window.PinUtils && typeof window.PinUtils.build === 'function') {
      // PinUtils.build() accepts an optional root element.
      try {
        window.PinUtils.build(rootEl)
      } catch {
        window.PinUtils.build()
      }
      return true
    }
  } catch {
    // ignore
  }
  return false
}
