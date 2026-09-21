/**
 * pinterestCache.js — the local cache of scraped pins, and refresh bookkeeping.
 *
 * Scraping a board is slow and rate-limited, so results are cached per board URL
 * and refreshed at most once per project-open. The "project open" identity lives
 * in sessionStorage, the pins in localStorage — both per-webview, so none of it
 * survives into a native shell.
 */
import { normalizePinterestBoardUrl } from '../lib/pinterestBoard'

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

export const getProjectOpenId = () => {
  if (typeof window === 'undefined') return 'default'
  return String(
    window.__inkblotProjectOpenId ||
    window.sessionStorage?.getItem(PINTEREST_PROJECT_OPEN_ID_KEY) ||
    'default'
  )
}

export const getProjectRefreshKey = (url) => {
  const cacheKey = getPinterestCacheKey(url)
  if (!cacheKey) return null
  return `${PINTEREST_PROJECT_REFRESH_PREFIX}${getProjectOpenId()}:${cacheKey}`
}

export const hasRefreshedForCurrentProjectOpen = (url) => {
  if (typeof window === 'undefined') return false
  const key = getProjectRefreshKey(url)
  if (!key) return false
  try {
    return window.sessionStorage?.getItem(key) === 'true'
  } catch {
    return false
  }
}

export const markRefreshedForCurrentProjectOpen = (url) => {
  if (typeof window === 'undefined') return
  const key = getProjectRefreshKey(url)
  if (!key) return
  try {
    window.sessionStorage?.setItem(key, 'true')
  } catch {
    // Session refresh markers are best-effort.
  }
}
