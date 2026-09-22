/**
 * pinterestBoardPreview.js — getting pins onto the screen, by whichever route works.
 *
 * Four sources, tried in order, because no single one covers every board:
 *
 *   1. the localStorage cache, rendered immediately so a reopened board is not blank
 *      while the network is asked — and the only thing that works offline
 *   2. the pidgets JSON API, which is cheap and handles `?section=`
 *   3. Pinterest's own pinit.js embed, scraped back out of the DOM it builds
 *   4. the logged-in session, scraped through the webview bridge — the only route to
 *      a private board or section, so a section URL skips straight to it
 *
 * Each step either renders and returns, or falls through. Landing at the end is not
 * an error state so much as "this board is private and you are not signed in", which
 * is what getScrapeHint() turns the scrape metadata into.
 *
 * Two guards make the fall-through safe to run concurrently:
 *
 *   refreshRunId   every refresh takes a number; a slow route that resolves after a
 *                  newer refresh started sees the number has moved and drops its
 *                  result rather than painting stale pins over fresh ones
 *   inFlightForUrl a second refresh for the same URL is ignored outright, so the
 *                  refresh button cannot stack scrapes
 *
 * `preserveCurrent` is what stops a refresh from flashing: with cached pins already
 * on screen, the fallback text stays hidden and the masonry is left alone until
 * something better arrives.
 *
 * A factory, not a module of functions: currentUrl, showingCachedPreview and the run
 * bookkeeping are all reassigned from callbacks and timers, and a parameter cannot
 * carry a write back out to the node view.
 */
import {
  normalizePins as normalizeCachedPins,
  readPinterestCache,
  writePinterestCache,
} from '../lib/pinterestBoard'
import {
  hasRefreshedForCurrentProjectOpen,
  isOffline,
  markRefreshedForCurrentProjectOpen,
} from './pinterestCache'
import {
  buildPinterestEmbeds,
  ensurePinterestScriptLoaded,
  parsePinterestBoardParts,
  pidgetsPinsUrlFromPinterestUrl,
} from './pinterestEmbed'

const SECTION_PRIVATE_PREVIEW_TIMEOUT_MS = 15000

export function createPinterestBoardPreview({
  attachResizeObserver,
  container,
  fallback,
  initialUrl,
  inner,
  link,
  masonry,
  resetExpansion,
  updateCollapseState,
}) {
  let currentUrl = initialUrl
  let showingCachedPreview = false

  // Avoid restarting expensive async refreshes (scrape/fetch) repeatedly.
  let refreshRunId = 0
  let inFlightForUrl = null
  let destroyed = false
  let initialRefreshTimer = null
  let initialRetryTimer = null
  let initialRefreshAttempts = 0

  const clearMasonry = () => {
    masonry.innerHTML = ''
    masonry.style.display = 'none'
    showingCachedPreview = false
    updateCollapseState()
  }

  const renderMasonry = (items, { cache = false, fromCache = false } = {}) => {
    clearMasonry()
    if (!items?.length) return false

    const normalizedItems = normalizeCachedPins(items)
    if (!normalizedItems.length) return false

    if (cache) {
      writePinterestCache(currentUrl, normalizedItems)
    }

    showingCachedPreview = fromCache
    masonry.style.display = 'block'
    attachResizeObserver()
    for (const item of normalizedItems) {
      const a = document.createElement('a')
      a.className = 'pinterest-board-masonry-item'
      a.href = item.pinHref
      a.target = '_blank'
      a.rel = 'noreferrer'

      const img = document.createElement('img')
      img.loading = 'lazy'
      img.decoding = 'async'
      img.alt = ''

      // Recompute collapse after images load (masonry height changes).
      // Attach listener before setting src to avoid missing cached-load cases.
      img.addEventListener('load', () => updateCollapseState(), { once: true })
      img.src = item.imageUrl

      a.appendChild(img)
      masonry.appendChild(a)
    }

    // Remove Pinterest embed DOM so it doesn't compete visually.
    inner.innerHTML = ''
    inner.appendChild(masonry)

    // Measure after layout.
    requestAnimationFrame(() => updateCollapseState())
    setTimeout(() => updateCollapseState(), 250)
    setTimeout(() => updateCollapseState(), 1200)

    return true
  }

  const renderCachedMasonry = () => {
    const cached = readPinterestCache(currentUrl)
    if (!cached?.pins?.length) return false

    const ok = renderMasonry(cached.pins, { fromCache: true })
    if (ok) {
      fallback.style.display = 'none'
      container.dataset.scrapeReason = 'cache'
    }
    return ok
  }

  const extractPinsFromEmbedDom = () => {
    const spans = Array.from(
      container.querySelectorAll('span[data-pin-href]')
    )

    const items = []
    const seen = new Set()

    for (const el of spans) {
      const pinHref = el.getAttribute('data-pin-href')
      if (!pinHref) continue

      // Only collect actual pins.
      // Examples:
      //  - https://www.pinterest.com/pin/807199933259231008
      //  - https://www.pinterest.com/pin/807199933259231008/
      let pinUrl
      try {
        pinUrl = new URL(pinHref)
      } catch {
        continue
      }

      const isPinterestPin =
        (pinUrl.hostname === 'www.pinterest.com' || pinUrl.hostname === 'pinterest.com') &&
        /^\/pin\/(\d+)(\/)?$/i.test(pinUrl.pathname)

      if (!isPinterestPin) continue

      // Pinterest embed uses background-image; get the computed style if needed.
      const bg = el.style?.backgroundImage || getComputedStyle(el).backgroundImage
      if (!bg || bg === 'none') continue

      const match = bg.match(/url\((['"]?)(.*?)\1\)/i)
      const imageUrl = match?.[2]
      if (!imageUrl) continue

      // Only accept Pinterest CDN images (prevents picking up logo/PFPs that may be embedded).
      let imgUrl
      try {
        imgUrl = new URL(imageUrl)
      } catch {
        continue
      }

      const isPinImg = imgUrl.hostname === 'i.pinimg.com'
      if (!isPinImg) continue

      const key = `${pinHref}::${imageUrl}`
      if (seen.has(key)) continue
      seen.add(key)

      items.push({ pinHref: pinUrl.toString(), imageUrl: imgUrl.toString() })
    }

    // Some Pinterest embed layouts include a non-pin tile at the start/end
    // (often avatar / Pinterest branding). As a pragmatic guard, drop them.
    if (items.length >= 3) return items.slice(1, -1)
    return items
  }

  const ensureEmbedLinkPresent = () => {
    // Keep the Pinterest <a data-pin-do="embedBoard"> around only long enough
    // for PinUtils.build() to populate its DOM.
    if (!inner.contains(link)) {
      inner.innerHTML = ''
      inner.appendChild(link)
    }
  }

  const resetScrapeMeta = () => {
    container.dataset.scrapeFinalUrl = ''
    container.dataset.scrapeReason = ''
    container.dataset.scrapeError = ''
  }

  const storeScrapeMeta = (scrapeResult) => {
    container.dataset.scrapeFinalUrl = String(scrapeResult?.finalUrl || '')
    container.dataset.scrapeReason = String(scrapeResult?.reason || '')
    container.dataset.scrapeError = String(scrapeResult?.error || '')
  }

  const getScrapeHint = (kind) => {
    const finalUrl = container.dataset.scrapeFinalUrl || ''
    const reason = container.dataset.scrapeReason || ''

    if (finalUrl && finalUrl !== currentUrl && /\/login\b|\/accounts\b|\/signup\b/i.test(finalUrl)) {
      return ' Pinterest redirected to login. Sign in, then click the refresh icon.'
    }

    if (reason === 'eval_failed' || reason === 'eval_probe_failed' || reason === 'eval_noexec') {
      return ' Pinterest is still loading in the preview session. Click the refresh icon again in a moment.'
    }

    if (reason === 'timeout') {
      return ` ${kind} preview timed out. If it's private, sign in to Pinterest, then click the refresh icon.`
    }

    return ` If this ${kind} is private, sign in to Pinterest, then click the refresh icon.`
  }

  const showPreviewFallback = ({ message, kind, linkText = 'Open on Pinterest' }) => {
    fallback.innerHTML = ''

    const msg = document.createElement('div')
    msg.textContent = `${message}${getScrapeHint(kind)} `

    const a = document.createElement('a')
    a.href = currentUrl
    a.target = '_blank'
    a.rel = 'noreferrer'
    a.textContent = linkText

    const errText = container.dataset.scrapeError || ''
    if (errText) {
      a.title = errText
    }

    fallback.appendChild(msg)
    fallback.appendChild(a)
    fallback.style.display = ''
  }

  const attemptSessionPreview = async ({
    runId,
    strategy = 'session-only',
    maxPins = 30,
    timeoutMs = 30000,
    allowWebviewFallback = true,
  }) => {
    try {
      const mod = await import('../lib/pinterestScrape')
      if (!mod || typeof mod.scrapePinterestPins !== 'function') {
        return { ok: false }
      }

      const timeoutBufferMs = strategy === 'session-only' ? 3000 : 1500

      const scrapeResult = await Promise.race([
        mod.scrapePinterestPins(currentUrl, {
          maxPins,
          timeoutMs,
          strategy,
          allowWebviewFallback,
        }),
        new Promise(resolve => setTimeout(() => resolve({ pins: [], reason: 'timeout' }), timeoutMs + timeoutBufferMs)),
      ])

      if (runId !== refreshRunId) {
        return { ok: false, stale: true }
      }

      const pins = Array.isArray(scrapeResult)
        ? scrapeResult
        : (Array.isArray(scrapeResult?.pins) ? scrapeResult.pins : [])

      if (pins.length) {
        const okMasonry = renderMasonry(pins, { cache: true })
        if (okMasonry) {
          fallback.style.display = 'none'
          return { ok: true, scrapeResult }
        }
      }

      storeScrapeMeta(scrapeResult)
      return { ok: false, scrapeResult }
    } catch (error) {
      storeScrapeMeta({
        finalUrl: currentUrl,
        reason: 'session_scrape_failed',
        error: String(error?.message || error || ''),
      })
      return { ok: false }
    }
  }

  const tryPublicEmbedPreview = async (runId) => {
    const ok = await ensurePinterestScriptLoaded()
    if (!ok) {
      return { ok: false }
    }

    return await new Promise(resolve => {
      setTimeout(() => {
        const built = buildPinterestEmbeds(container)
        fallback.style.display = ''

        setTimeout(() => {
          if (runId !== refreshRunId) {
            resolve({ ok: false, stale: true })
            return
          }

          if (!container.querySelector('iframe')) {
            const extracted = extractPinsFromEmbedDom()
            if (extracted.length) {
              const okMasonry = renderMasonry(extracted, { cache: true })
              if (okMasonry) {
                fallback.style.display = 'none'
                resolve({ ok: true })
                return
              }
            }
          }

          const hasEmbed =
            container.querySelector('iframe') ||
            container.querySelector('[data-pin-href]') ||
            container.querySelector('.PIN_')

          if (built && hasEmbed) {
            fallback.style.display = 'none'
            resolve({ ok: true })
            return
          }

          resolve({ ok: false })
        }, 1200)
      }, 0)
    })
  }

  // Start with masonry hidden until we can extract.
  clearMasonry()

  const scheduleInitialRetry = () => {
    if (destroyed) return false
    if (initialRefreshAttempts >= 2) return false

    initialRefreshAttempts += 1
    if (!showingCachedPreview) {
      fallback.innerHTML = ''
      fallback.textContent = 'Loading Pinterest preview…'
    }
    initialRetryTimer = window.setTimeout(() => {
      initialRetryTimer = null
      if (destroyed) return
      refresh({ allowInitialRetry: false, preserveCurrent: showingCachedPreview })
    }, 900)
    return true
  }

  const refresh = async ({ allowInitialRetry = false, preserveCurrent = false } = {}) => {
    if (destroyed) return
    currentUrl = link.href

    // If we already have a refresh running for this URL, don't restart it.
    if (inFlightForUrl && inFlightForUrl === currentUrl) return
    inFlightForUrl = currentUrl

    const runId = ++refreshRunId
    const keepCurrentPreview = preserveCurrent && showingCachedPreview

    resetExpansion()
    if (!keepCurrentPreview) {
      clearMasonry()
      ensureEmbedLinkPresent()
    }
    resetScrapeMeta()

    if (isOffline()) {
      if (keepCurrentPreview || renderCachedMasonry()) {
        fallback.style.display = 'none'
      } else {
        fallback.innerHTML = ''
        fallback.textContent = 'Pinterest preview is offline and no cached images are available.'
        fallback.style.display = ''
      }
      inFlightForUrl = null
      return
    }

    // Default to showing the fallback while we work unless cached pins are already visible.
    fallback.style.display = keepCurrentPreview ? 'none' : ''

    const parts = parsePinterestBoardParts(currentUrl)

    // Board section (sub-board) preview.
    // Pinterest's embedBoard (and the board-pins pidgets endpoint) do not reliably
    // filter by section slug, and private sections require the logged-in Pinterest
    // session. Scrape the actual section page from the session webview first.
    if (parts?.section) {
      fallback.innerHTML = ''
      fallback.textContent = 'Loading section from your Pinterest session…'

      const sectionPreview = await attemptSessionPreview({
        runId,
        strategy: 'session-only',
        maxPins: 30,
        timeoutMs: SECTION_PRIVATE_PREVIEW_TIMEOUT_MS,
      })
      if (sectionPreview.stale) return
      if (sectionPreview.ok) {
        inFlightForUrl = null
        return
      }

      if (allowInitialRetry) {
        inFlightForUrl = null
        if (scheduleInitialRetry()) return
      }

      if (showingCachedPreview) {
        fallback.style.display = 'none'
        inFlightForUrl = null
        return
      }

      showPreviewFallback({
        message: 'Couldn\'t load section preview.',
        kind: 'section',
      })
      inFlightForUrl = null
      return
    }

    // 1) Prefer the Pinterest widgets JSON API (“pidgets”).
    // This supports board sections via `?section=...` and avoids accidentally
    // scraping non-pin tiles from the embed DOM.
    const pidgetsUrl = pidgetsPinsUrlFromPinterestUrl(currentUrl)
    if (pidgetsUrl) {
      try {
        const res = await fetch(pidgetsUrl)
        if (res.ok) {
          const json = await res.json()
          const pins = json?.data?.pins || []
          const items = pins
            .map(p => {
              const imageUrl =
                p?.images?.['236x']?.url ||
                p?.images?.['237x']?.url ||
                p?.images?.['564x']?.url
              if (!imageUrl || !p?.id) return null
              return {
                pinHref: `https://www.pinterest.com/pin/${p.id}/`,
                imageUrl,
              }
            })
            .filter(Boolean)

          if (items.length) {
            const okMasonry = renderMasonry(items, { cache: true })
            if (okMasonry) {
              fallback.style.display = 'none'
              inFlightForUrl = null
              return
            }
          }
        }
      } catch {
        // ignore; fall back to pinit.js widget path
      }
    }

    if (!keepCurrentPreview) {
      fallback.innerHTML = ''
      fallback.textContent = 'Loading Pinterest board…'
      ensureEmbedLinkPresent()

      const publicEmbedPreview = await tryPublicEmbedPreview(runId)
      if (publicEmbedPreview.stale) return
      if (publicEmbedPreview.ok) {
        inFlightForUrl = null
        return
      }
    }

    fallback.innerHTML = ''
    fallback.textContent = 'Trying your Pinterest session…'
    if (keepCurrentPreview) {
      fallback.style.display = 'none'
    }

    const privatePreview = await attemptSessionPreview({
      runId,
      strategy: 'session-only',
      maxPins: 30,
      timeoutMs: 30000,
    })
    if (privatePreview.stale) return
    if (privatePreview.ok) {
      inFlightForUrl = null
      return
    }

    if (allowInitialRetry) {
      inFlightForUrl = null
      if (scheduleInitialRetry()) return
    }

    if (showingCachedPreview) {
      fallback.style.display = 'none'
      inFlightForUrl = null
      return
    }

    showPreviewFallback({
      message: 'Couldn\'t load board preview.',
      kind: 'board',
    })
    inFlightForUrl = null
  }

  const onRefreshPreview = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!showingCachedPreview) {
      renderCachedMasonry()
    }
    refresh({ preserveCurrent: showingCachedPreview })
  }

  // First paint. Cached pins go up straight away; the network refresh is deferred a
  // beat so the document finishes rendering first, and runs at most once per
  // project-open per URL — reopening a document with twenty boards in it should not
  // fire twenty scrapes.
  const start = () => {
    const hasCachedPreview = renderCachedMasonry()
    const alreadyRefreshedForProjectOpen = hasRefreshedForCurrentProjectOpen(currentUrl)

    if (isOffline()) {
      markRefreshedForCurrentProjectOpen(currentUrl)
      if (hasCachedPreview) {
        fallback.style.display = 'none'
      } else {
        fallback.innerHTML = ''
        fallback.textContent = 'Pinterest preview is offline and no cached images are available.'
        fallback.style.display = ''
      }
    } else if (!alreadyRefreshedForProjectOpen) {
      markRefreshedForCurrentProjectOpen(currentUrl)
      initialRefreshAttempts = 1
      initialRefreshTimer = window.setTimeout(() => {
        initialRefreshTimer = null
        if (destroyed) return
        requestAnimationFrame(() => {
          if (destroyed) return
          refresh({
            allowInitialRetry: true,
            preserveCurrent: showingCachedPreview,
          })
        })
      }, hasCachedPreview ? 450 : 650)
    } else if (hasCachedPreview) {
      fallback.style.display = 'none'
    } else {
      fallback.innerHTML = ''
      fallback.textContent = 'No cached Pinterest preview yet. Click the refresh icon to load it.'
      fallback.style.display = ''
    }
  }

  // The node's URL changed under an existing view. Same rules as first paint.
  const onNodeUrlChanged = (nextUrl) => {
    currentUrl = nextUrl

    const hasUpdatedCachedPreview = renderCachedMasonry()
    if (!hasUpdatedCachedPreview) {
      clearMasonry()
    }
    if (isOffline()) {
      if (!hasUpdatedCachedPreview) {
        fallback.innerHTML = ''
        fallback.textContent = 'Pinterest preview is offline and no cached images are available.'
        fallback.style.display = ''
      }
    } else if (!hasRefreshedForCurrentProjectOpen(currentUrl)) {
      markRefreshedForCurrentProjectOpen(currentUrl)
      refresh({ preserveCurrent: showingCachedPreview })
    }
  }

  return {
    getUrl: () => currentUrl,
    onNodeUrlChanged,
    onRefreshPreview,
    start,

    destroy: () => {
      destroyed = true
      if (initialRefreshTimer) {
        window.clearTimeout(initialRefreshTimer)
        initialRefreshTimer = null
      }
      if (initialRetryTimer) {
        window.clearTimeout(initialRetryTimer)
        initialRetryTimer = null
      }
    },
  }
}
