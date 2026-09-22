/**
 * pinterestBoard.js — the data behind a Pinterest board, with no UI attached.
 *
 * Extracted from the TipTap extension so a board can live in two places: inline in a
 * document (extensions/PinterestBoard.js) and as a card on a canvas
 * (canvas/CanvasPinterestNode.jsx). Both read the SAME preference-store cache, so a board
 * scraped in a document renders instantly when you drop it on a canvas, and vice
 * versa — a board is one thing the app knows about, not two.
 *
 * Scraping is slow and can fail (private boards need a logged-in session). So the
 * cache is the primary source: render whatever is cached immediately, then refresh
 * once per project-open in the background.
 */
import { getPreference, setPreference, getSessionValue, setSessionValue } from './preferences'
import { getProjectOpenId } from './projectContext'

const CACHE_PREFIX = 'inkblot:pinterest-preview:'
const PROJECT_REFRESH_PREFIX = 'inkblot:pinterest-project-refresh:'
const PROJECT_OPEN_ID_KEY = 'inkblot:project-open-id'
const CACHE_VERSION = 1
const CACHE_MAX_ITEMS = 80

export const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

/**
 * A Pinterest BOARD url, normalized — or null if `text` is anything else (a pin, a
 * search, a different site). This is the gate everything else is behind: if it
 * returns null, there is no board here.
 *
 * Board *sections* (`/{user}/{board}/{section}/`) are preserved, so a card can point
 * at one section rather than the whole board.
 */
export function normalizePinterestBoardUrl(text) {
  if (!text) return null
  const trimmed = String(text).trim()
  if (!trimmed) return null

  // only consider pinterest.com URLs
  if (!/^https?:\/\//i.test(trimmed)) return null

  let url
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }

  const host = url.hostname.toLowerCase()
  if (!(host === 'pinterest.com' || host === 'www.pinterest.com')) return null

  // board URLs are typically: /{username}/{board}/
  const segments = url.pathname
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)

  if (segments.length < 2) return null

  const [first, second] = segments

  // ignore non-board routes.
  const blocked = new Set([
    'pin',
    'search',
    'ideas',
    'explore',
    'today',
    'topics',
    'settings',
    '_tools',
  ])

  if (blocked.has(first.toLowerCase())) return null

  const allowedThird = new Set(['pins', 'activity', 'ideas', 'more_ideas'])

  // Pinterest board sections look like /{user}/{board}/{section}/. Keep the section
  // so a card can show just that section — except for Pinterest's own sub-routes.
  if (segments.length >= 3) {
    const third = segments[2]
    if (allowedThird.has(third.toLowerCase())) {
      return `https://www.pinterest.com/${encodeURIComponent(first)}/${encodeURIComponent(second)}/`
    }
    return `https://www.pinterest.com/${encodeURIComponent(first)}/${encodeURIComponent(second)}/${encodeURIComponent(third)}/`
  }

  // Strip query/hash and normalize the trailing slash.
  return `https://www.pinterest.com/${encodeURIComponent(first)}/${encodeURIComponent(second)}/`
}

export const isPinterestBoardUrl = (text) => normalizePinterestBoardUrl(text) !== null

/* ---------------- cache ---------------- */

const cacheKey = (url) => {
  const normalized = normalizePinterestBoardUrl(url)
  return normalized ? `${CACHE_PREFIX}${normalized}` : null
}

// Was `window.__inkblotProjectOpenId`; see lib/projectContext for why it is still
// ambient and why it is no longer a window property.
const projectOpenId = () => getProjectOpenId()

const refreshKey = (url) => {
  const key = cacheKey(url)
  return key ? `${PROJECT_REFRESH_PREFIX}${projectOpenId()}:${key}` : null
}

/** True once a board has been refreshed during this project-open. */
export const hasRefreshedThisSession = (url) => {
  if (typeof window === 'undefined') return false
  const key = refreshKey(url)
  if (!key) return false
  return getSessionValue(key) === 'true'
}

export const markRefreshedThisSession = (url) => {
  if (typeof window === 'undefined') return
  const key = refreshKey(url)
  if (!key) return
  setSessionValue(key, 'true')
}

/** Drop anything that isn't a real {pinHref, imageUrl} pair, and de-duplicate. */
export function normalizePins(items) {
  const out = []
  const seen = new Set()

  for (const item of Array.isArray(items) ? items : []) {
    const pinHref = String(item?.pinHref || '').trim()
    const imageUrl = String(item?.imageUrl || '').trim()
    if (!pinHref || !imageUrl) continue
    if (!/^https?:\/\//i.test(pinHref) || !/^https?:\/\//i.test(imageUrl)) continue

    const key = `${pinHref}::${imageUrl}`
    if (seen.has(key)) continue
    seen.add(key)

    out.push({ pinHref, imageUrl })
    if (out.length >= CACHE_MAX_ITEMS) break
  }

  return out
}

export function readPinterestCache(url) {
  if (typeof window === 'undefined') return null
  const key = cacheKey(url)
  if (!key) return null

  try {
    const raw = getPreference(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.version !== CACHE_VERSION) return null

    const pins = normalizePins(parsed?.pins)
    if (!pins.length) return null
    return { pins, savedAt: Number(parsed?.savedAt || 0) }
  } catch {
    return null
  }
}

export function writePinterestCache(url, pins) {
  if (typeof window === 'undefined') return
  const key = cacheKey(url)
  if (!key) return

  const normalized = normalizePins(pins)
  if (!normalized.length) return

  setPreference(
    key,
    JSON.stringify({ version: CACHE_VERSION, savedAt: Date.now(), pins: normalized })
  )
}

/* ---------------- fetching ---------------- */

/**
 * Scrape a board's pins, caching whatever comes back.
 *
 * The scraper is imported lazily: it is heavy, and a canvas with no boards on it
 * should never pay for it.
 */
export async function fetchPinterestPins(url, { maxPins = 30, timeoutMs = 30000 } = {}) {
  const boardUrl = normalizePinterestBoardUrl(url)
  if (!boardUrl || isOffline()) return { pins: [], reason: 'unavailable' }

  try {
    const { scrapePinterestPins } = await import('./pinterestScrape')

    const result = await Promise.race([
      scrapePinterestPins(boardUrl, {
        maxPins,
        timeoutMs,
        strategy: 'session-only',
        allowWebviewFallback: true,
      }),
      // The scraper drives a hidden webview; without an outer bound a board that
      // never resolves would leave the card spinning forever.
      new Promise((resolve) =>
        setTimeout(() => resolve({ pins: [], reason: 'timeout' }), timeoutMs + 3000)
      ),
    ])

    const pins = normalizePins(Array.isArray(result) ? result : result?.pins)
    if (pins.length) writePinterestCache(boardUrl, pins)

    return { pins, reason: pins.length ? 'ok' : result?.reason || 'empty' }
  } catch (error) {
    console.warn('[pinterest] scrape failed:', error)
    return { pins: [], reason: 'error' }
  }
}
