/**
 * pinterestCache.js — the local cache of scraped pins, and refresh bookkeeping.
 *
 * Scraping a board is slow and rate-limited, so results are cached per board URL
 * and refreshed at most once per project-open. The "project open" identity lives
 * in per-launch memory, the pins in the preference store — see lib/preferences.ts, and
 * survives into a native shell.
 */
import { normalizePinterestBoardUrl } from '../lib/pinterestBoard'
import { getSessionValue, setSessionValue } from '../lib/preferences'
import { getProjectOpenId as readProjectOpenId } from '../lib/projectContext'

export const PINTEREST_CACHE_PREFIX = 'inkblot:pinterest-preview:'
export const PINTEREST_PROJECT_REFRESH_PREFIX = 'inkblot:pinterest-project-refresh:'
export const PINTEREST_PROJECT_OPEN_ID_KEY = 'inkblot:project-open-id'
export const PINTEREST_CACHE_VERSION = 1
export const PINTEREST_CACHE_MAX_ITEMS = 80

export const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

export const getPinterestCacheKey = (url) => {
  const normalized = normalizePinterestBoardUrl(url)
  if (!normalized) return null
  return `${PINTEREST_CACHE_PREFIX}${normalized}`
}

/**
 * Which open of which project this is.
 *
 * Was `window.__inkblotProjectOpenId`, set by Editor.jsx and read from here — a node
 * view, with no React path back to the component that knows. It is still ambient for
 * that reason, but it is `lib/projectContext` now rather than a property anything can
 * assign, and that module keeps the same fall-through to the session store.
 */
export const getProjectOpenId = () => readProjectOpenId()

export const getProjectRefreshKey = (url) => {
  const cacheKey = getPinterestCacheKey(url)
  if (!cacheKey) return null
  return `${PINTEREST_PROJECT_REFRESH_PREFIX}${getProjectOpenId()}:${cacheKey}`
}

export const hasRefreshedForCurrentProjectOpen = (url) => {
  if (typeof window === 'undefined') return false
  const key = getProjectRefreshKey(url)
  if (!key) return false
  return getSessionValue(key) === 'true'
}

export const markRefreshedForCurrentProjectOpen = (url) => {
  if (typeof window === 'undefined') return
  const key = getProjectRefreshKey(url)
  if (!key) return
  setSessionValue(key, 'true')
}
