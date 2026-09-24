/**
 * pinterestScrape.js — scrapes pins from Pinterest boards the user can see.
 *
 * Used for boards the public widget API can't serve (private boards and
 * board sections). Opens a hidden webview that shares the logged-in
 * Pinterest session, injects a scraping script that scrolls the board and
 * collects pin images/links, and takes the result back over Tauri's IPC.
 * PinterestBoard.js consumes this via dynamic import.
 *
 * `eval_webview` throws the script's result away, so the injected script reports by
 * calling `pinterest_report_scrape` itself, and `waitForScrapeReport` receives it. The
 * slot is opened (`pinterest_begin_scrape`) before the script is injected, so a report
 * can never arrive before anything is listening. See
 * `src-tauri/crates/inkblot-models/src/scrape.rs` for why a remote page can make that
 * call at all.
 */
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { invoke } from '@tauri-apps/api/core'
import sessionScrapeBody from './pinterestScripts/sessionScrape.js?raw'

let scrapeWindow = null

const SCRAPE_LABEL = 'pinterest-scrape'
const SESSION_LABEL = 'pinterest'
const PINTEREST_LOGIN_PATH_RE = /\/login\b|\/accounts\b|\/signup\b/i

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const waitForWindowEvent = (win, eventName, { timeoutMs = 8000 } = {}) => {
  return new Promise((resolve) => {
    let done = false
    const t = setTimeout(() => {
      if (done) return
      done = true
      resolve({ ok: false, timeout: true })
    }, Math.max(250, Number(timeoutMs) || 8000))

    try {
      win.once(eventName, (event) => {
        if (done) return
        done = true
        clearTimeout(t)
        resolve({ ok: true, event })
      })
    } catch {
      if (done) return
      done = true
      clearTimeout(t)
      resolve({ ok: false, error: true })
    }
  })
}

const waitForCreatedAndFirstLoad = async (win) => {
  // Best-effort: on some platforms/events this can be racy.
  await waitForWindowEvent(win, 'tauri://created', { timeoutMs: 8000 })
  // Keep this short – Pinterest SPA pages rarely fire tauri://page-load
  // reliably, and the probe script will validate JS execution anyway.
  await waitForWindowEvent(win, 'tauri://page-load', { timeoutMs: 4000 })
}

const evalWithRetry = async (label, script, { attempts = 35, delayMs = 200 } = {}) => {
  const maxAttempts = Math.max(1, Math.min(100, Number(attempts) || 35))
  const d = Math.max(50, Math.min(1000, Number(delayMs) || 200))
  const requestIdMatch = script.match(/const requestId = "([^"]+)"/)
  const wrappedRequestId = requestIdMatch ? requestIdMatch[1] : ''
  // A script that throws while running reports the throw itself, so the caller gets a
  // reason instead of a timeout. A script that fails to PARSE cannot — which is what
  // the syntax pre-check below is for.
  const wrappedScript = `(() => {
    try {
      ${script}
    } catch (error) {
      try {
        const requestId = ${JSON.stringify(wrappedRequestId)};
        if (requestId) {
          window.__TAURI_INTERNALS__.invoke('pinterest_report_scrape', {
            report: {
              requestId,
              url: location.href,
              pins: [],
              reason: 'wrapper_eval_error',
              stage: String(error && error.message ? error.message : error).slice(0, 200),
              progress: false,
            },
          });
        }
      } catch (_) {
        // ignore secondary failures
      }
    }
  })();`

  let lastErr = null
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await invoke('eval_webview', { label, script: wrappedScript })
      return { ok: true }
    } catch (e) {
      lastErr = e
      const msg = String(e?.message || e || '')

      // Common first-run race: Rust can't find the label yet.
      if (/webview.*not found|label.*not found|not found/i.test(msg)) {
        await sleep(d)
        continue
      }

      return { ok: false, error: e }
    }
  }

  return { ok: false, error: lastErr, exhausted: true }
}

/**
 * Open a slot for this run, then wait for the page to fill it.
 *
 * `begin` has to happen before the script is injected — that ordering is the whole
 * reason the report cannot arrive before anything is listening for it.
 */
const openScrapeSlot = (requestId) => invoke('pinterest_begin_scrape', { requestId })

const waitForScrapeReport = async (requestId, timeoutMs) => {
  try {
    return await invoke('pinterest_await_scrape', {
      requestId,
      timeoutMs: Math.max(1000, Number(timeoutMs) || 15000),
    })
  } catch {
    return null
  }
}

const ensureScrapeWindow = async (url) => {
  if (scrapeWindow) {
    try {
      // Navigate existing window.
      // Attach the load listener before navigating to avoid missing the event.
      const loadPromise = waitForWindowEvent(scrapeWindow, 'tauri://page-load', { timeoutMs: 4000 })
      await invoke('navigate_webview', { label: SCRAPE_LABEL, url })
      await loadPromise
      return scrapeWindow
    } catch {
      try { await scrapeWindow.destroy() } catch { /* ignore */ }
      scrapeWindow = null
    }
  }

  scrapeWindow = new WebviewWindow(SCRAPE_LABEL, {
    url,
    title: 'Pinterest Scrape',
    // NOTE: A fully hidden webview can end up throttled/suspended.
    // Keep it offscreen but give it a realistic viewport so Pinterest
    // actually lays out and loads grid images.
    x: -10000,
    y: -10000,
    width: 1280,
    height: 1800,
    visible: true,
    focus: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnBottom: true,
    resizable: false,
    decorations: false,
  })

  scrapeWindow.once('tauri://destroyed', () => {
    scrapeWindow = null
  })

  // Reduce races where invoke('eval_webview') runs before the label exists.
  await waitForCreatedAndFirstLoad(scrapeWindow)

  return scrapeWindow
}

const ensureSessionWindow = async (url) => {
  const mod = await import('./openPinterest')
  if (mod && typeof mod.openPinterest === 'function') {
    // Use the real Pinterest session window so private boards/sections can
    // access the user's logged-in cookies, but keep it in the background so
    // previews render inside the editor instead of popping Pinterest open.
    await mod.openPinterest(url, { focus: false, waitForCreate: true })
  }

  const sessionWindow = mod && typeof mod.getPinterestWindow === 'function'
    ? await mod.getPinterestWindow({ waitForCreate: true, timeoutMs: 5000 })
    : await WebviewWindow.getByLabel(SESSION_LABEL)
  if (!sessionWindow) {
    throw new Error('Pinterest session window not available')
  }
  await invoke('navigate_webview', { label: SESSION_LABEL, url })

  // Don't block on page-load here. Pinterest can navigate as an SPA and skip
  // the event entirely; evalWithRetry below is the real readiness check.
  await sleep(1200)

  const currentUrl = await invoke('get_webview_url', { label: SESSION_LABEL }).catch(() => '')
  if (PINTEREST_LOGIN_PATH_RE.test(String(currentUrl || ''))) {
    if (mod && typeof mod.openPinterest === 'function') {
      await mod.openPinterest(currentUrl, { focus: true, waitForCreate: true })
    }
  }
  return sessionWindow
}

/**
 * Scrape pin thumbnails (and pin links) from a public Pinterest board/section URL.
 *
 * Returns: { pins: [{ pinHref, imageUrl }], finalUrl?: string, reason?: string, error?: string }
 */
export async function scrapePinterestPins(
  url,
  {
    maxPins = 50,
    timeoutMs = 15000,
    strategy = 'auto',
    allowWebviewFallback = true,
  } = {},
) {
  const targetUrl = String(url || '').trim()
  if (!targetUrl) return { pins: [], reason: 'no_url' }

  const reqMaxPins = Math.max(1, Math.min(200, Number(maxPins) || 50))
  const reqTimeoutMs = Math.max(2000, Math.min(60000, Number(timeoutMs) || 15000))
  const scrapeStrategy = strategy === 'session-only' ? 'session-only' : 'auto'
  const activeLabel = scrapeStrategy === 'session-only' ? SESSION_LABEL : SCRAPE_LABEL
  const payloadWaitBufferMs = scrapeStrategy === 'session-only' ? 5000 : 1500
  const shouldUseWebviewFallback = scrapeStrategy === 'session-only' || allowWebviewFallback !== false
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`

  // Prefer the existing public HTTP-based scrape first when allowed.
  if (scrapeStrategy !== 'session-only') {
    try {
      const scrapeResponse = await invoke('scrape_pinterest_html', {
        url: targetUrl,
        maxPins: reqMaxPins,
      })

      const directPins = Array.isArray(scrapeResponse?.pins) ? scrapeResponse.pins : []

      const normalizedDirectPins = directPins
        .map((p) => ({
          pinHref: String(p?.pinHref || ''),
          imageUrl: String(p?.imageUrl || ''),
        }))
        .filter((p) => p.pinHref && p.imageUrl)

      if (normalizedDirectPins.length) {
        return {
          pins: normalizedDirectPins,
          finalUrl: targetUrl,
          reason: 'direct_html',
        }
      }
    } catch (error) {
      void error
    }
  }

  if (!shouldUseWebviewFallback) {
    return {
      pins: [],
      finalUrl: targetUrl,
      reason: 'direct_html_empty',
    }
  }

  if (scrapeStrategy === 'session-only') {
    // Use the real Pinterest session webview for private boards/sections so
    // the scrape has the user's logged-in cookies. Do not pop the window open.
    await ensureSessionWindow(targetUrl)
  } else {
    await ensureScrapeWindow(targetUrl)
  }

  try {
    // Brief pause for the page to start loading its JS bundles.
    // The probe script will confirm execution works before we proceed.
    await sleep(scrapeStrategy === 'session-only' ? 250 : 150)

    // Probe whether injected JS actually executes in this remote page AND can reach
    // Rust. Both are the same question now, and answering it up front turns "the
    // channel is broken" from a fifteen-second timeout into an immediate reason.
    const probeRequestId = `${requestId}-probe`
    await openScrapeSlot(probeRequestId)
    const probeScript = buildPinterestProbeScript({ requestId: probeRequestId })
    const probeEval = await evalWithRetry(activeLabel, probeScript, { attempts: 20, delayMs: 150 })
    if (!probeEval.ok) {
      return {
        pins: [],
        finalUrl: targetUrl,
        reason: 'eval_probe_failed',
        error: String(probeEval?.error?.message || probeEval?.error || ''),
      }
    }

    const probePayload = await waitForScrapeReport(probeRequestId, scrapeStrategy === 'session-only' ? 2500 : 1500)
    if (!probePayload) {
      return {
        pins: [],
        finalUrl: targetUrl,
        reason: 'eval_noexec',
      }
    }

    // Budget the remaining time so the internal script timeout + poll wait
    // fit within the caller's overall timeout.
    const elapsedSoFar = Date.now() - parseInt(requestId.split('-')[0], 10)
    const scriptTimeout = Math.max(3000, reqTimeoutMs - elapsedSoFar)

    // One script for both strategies.
    const script = buildPinterestSessionScrapeScript({
      requestId,
      maxPins: reqMaxPins,
      timeoutMs: scriptTimeout,
      targetUrl,
    })
    {
      try {
        // Validate generated script syntax in our own app context before
        // sending it into the Pinterest page, where parse failures are opaque.
        new Function(script)
      } catch (error) {
        return {
          pins: [],
          finalUrl: targetUrl,
          reason: 'script_parse_failed',
          error: String(error?.message || error || ''),
        }
      }
    }
    await openScrapeSlot(requestId)
    const evalResult = await evalWithRetry(activeLabel, script, { attempts: 35, delayMs: 200 })
    if (!evalResult.ok) {
      return {
        pins: [],
        finalUrl: targetUrl,
        reason: 'eval_failed',
        error: String(evalResult?.error?.message || evalResult?.error || ''),
      }
    }
    const payload = await waitForScrapeReport(requestId, scriptTimeout + payloadWaitBufferMs)
    if (!payload) {
      return {
        pins: [],
        finalUrl: targetUrl,
        reason: 'timeout',
      }
    }

    const pins = Array.isArray(payload?.pins) ? payload.pins : []
    return {
      pins,
      finalUrl: String(payload?.url || targetUrl),
      reason: String(payload?.reason || (pins.length ? 'ok' : 'empty')),
    }
  } finally {
    if (activeLabel === SCRAPE_LABEL) {
      // Destroy helper scrape windows so macOS Mission Control does not keep
      // surfacing stale offscreen webviews as "ghost" windows.
      try {
        await scrapeWindow?.destroy?.()
      } catch {
        /* ignore */
      }
      scrapeWindow = null
    }
  }
}


/**
 * Lightweight probe script — proves that injected JS runs inside the Pinterest webview
 * AND that it can reach Rust, before the heavier scrape script is sent after it.
 */
const buildPinterestProbeScript = ({ requestId }) => {
  return `(() => {
  try {
    window.__TAURI_INTERNALS__.invoke('pinterest_report_scrape', {
      report: {
        requestId: ${JSON.stringify(String(requestId))},
        reason: 'probe',
        url: location.href,
        pins: [],
        stage: 'probe',
        progress: false,
      },
    });
  } catch (e) {
    // ignore
  }
})();`
}

const buildPinterestSessionScrapeScript = ({ requestId, maxPins, timeoutMs, targetUrl }) => {
  return `(() => {
  const requestId = ${JSON.stringify(String(requestId))};
  const maxPins = ${Number(maxPins) || 50};
  const timeoutMs = ${Number(timeoutMs) || 15000};
  const requestedUrl = ${JSON.stringify(String(targetUrl || ''))};
${sessionScrapeBody}})();`
}
