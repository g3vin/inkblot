import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { invoke } from '@tauri-apps/api/core'

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
  const wrappedScript = `(() => {
    try {
      ${script}
    } catch (error) {
      try {
        const message = String(error && error.message ? error.message : error);
        const stack = String(error && error.stack ? error.stack : '');
        const requestId = ${JSON.stringify(wrappedRequestId)};
        if (requestId) {
          const payload = {
            requestId,
            url: location.href,
            pins: [],
            reason: 'wrapper_eval_error',
            stage: 'wrapper-eval-error',
            progress: false,
            debug: {
              wrapperError: message,
              wrapperStack: stack.slice(0, 1200),
              locationHref: location.href,
              pathname: location.pathname,
            },
          };
          location.hash = 'inkblot-scrape-' + requestId + '=' + encodeURIComponent(JSON.stringify(payload));
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

const readScrapePayloadFromUrl = (url, requestId) => {
  if (!url) return null
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  const hash = String(parsed.hash || '').replace(/^#/, '')
  const prefix = `inkblot-scrape-${requestId}=`
  if (!hash.startsWith(prefix)) return null

  const encoded = hash.slice(prefix.length)
  if (!encoded) return null

  try {
    const payload = JSON.parse(decodeURIComponent(encoded))
    if (!payload || typeof payload !== 'object') return null
    return payload
  } catch {
    return null
  }
}

const waitForScrapePayload = async (label, requestId, timeoutMs) => {
  const started = Date.now()
  const deadline = started + Math.max(1000, Number(timeoutMs) || 15000)

  while (Date.now() < deadline) {
    try {
      const currentUrl = await invoke('get_webview_url', { label })
      const payload = readScrapePayloadFromUrl(currentUrl, requestId)
      if (payload) {
        if (payload?.progress) {
          await sleep(220)
          continue
        }
        return payload
      }
    } catch {
      // ignore and retry
    }

    await sleep(220)
  }

  return null
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
    await mod.openPinterest(url, { focus: false, visible: false, waitForCreate: true })
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
  await sleep(700)

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
    await ensureSessionWindow(targetUrl)
  } else {
    await ensureScrapeWindow(targetUrl)
  }

  try {
    // Brief pause for the page to start loading its JS bundles.
    // The probe script will confirm execution works before we proceed.
    await sleep(scrapeStrategy === 'session-only' ? 250 : 150)

    // Probe whether injected JS actually executes in this remote page.
    const probeRequestId = `${requestId}-probe`
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

    const probePayload = await waitForScrapePayload(activeLabel, probeRequestId, scrapeStrategy === 'session-only' ? 2500 : 1500)
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

    const script = scrapeStrategy === 'session-only'
      ? buildPinterestSessionScrapeScript({
        requestId,
        maxPins: reqMaxPins,
        timeoutMs: scriptTimeout,
        targetUrl,
      })
      : buildPinterestScrapeScript({
        requestId,
        maxPins: reqMaxPins,
        timeoutMs: scriptTimeout,
        targetUrl,
      })
    if (scrapeStrategy === 'session-only') {
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
    const evalResult = await evalWithRetry(activeLabel, script, { attempts: 35, delayMs: 200 })
    if (!evalResult.ok) {
      return {
        pins: [],
        finalUrl: targetUrl,
        reason: 'eval_failed',
        error: String(evalResult?.error?.message || evalResult?.error || ''),
      }
    }
    const payload = await waitForScrapePayload(activeLabel, requestId, scriptTimeout + payloadWaitBufferMs)
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

/* eslint-disable no-useless-escape */

/**
 * Lightweight probe script – sets the URL hash to prove JS execution works
 * inside the Pinterest webview before we inject the heavier scrape script.
 */
const buildPinterestProbeScript = ({ requestId }) => {
  return `(() => {
  try {
    var payload = { requestId: ${JSON.stringify(String(requestId))}, reason: 'probe', url: location.href, pins: [], debug: { locationHref: location.href, pathname: location.pathname } };
    var encoded = encodeURIComponent(JSON.stringify(payload));
    location.hash = 'inkblot-scrape-' + ${JSON.stringify(String(requestId))} + '=' + encoded;
  } catch (e) {
    // ignore
  }
})();`
}

const buildPinterestSessionScrapeScript = ({ requestId, maxPins, targetUrl }) => {
  return `(() => {
  const requestId = ${JSON.stringify(String(requestId))};
  const maxPins = ${Number(maxPins) || 50};
  const requestedUrl = ${JSON.stringify(String(targetUrl || ''))};
  const debugState = {
    requestedUrl,
    initialLocationHref: location.href,
    initialPathname: location.pathname,
    cookieNames: [],
    csrfCookiePresent: false,
    parsedPath: null,
    sectionResource: null,
    pinsResource: null,
    boardResource: null,
    sessionApiError: '',
  };

  const getRequestedUrl = () => {
    try {
      return requestedUrl ? new URL(requestedUrl) : new URL(location.href);
    } catch {
      try {
        return new URL(location.href);
      } catch {
        return null;
      }
    }
  };

  const emit = (pins, reason, extra = {}) => {
    try {
      const payload = {
        requestId,
        url: location.href,
        pins,
        reason,
        stage: extra.stage || '',
        progress: Boolean(extra.progress),
        debug: {
          ...debugState,
          finalLocationHref: location.href,
          finalPathname: location.pathname,
          ...(extra.debug || {}),
        },
      };
      location.hash = 'inkblot-scrape-' + requestId + '=' + encodeURIComponent(JSON.stringify(payload));
    } catch {
      // ignore
    }
  };

  const emitProgress = (stage, debug) => {
    emit([], 'progress', { progress: true, stage, debug: debug || {} });
  };

  const readCookie = (name) => {
    try {
      const parts = String(document.cookie || '').split(';');
      debugState.cookieNames = parts
        .map((part) => {
          const trimmed = part.trim();
          const eq = trimmed.indexOf('=');
          return eq === -1 ? trimmed : trimmed.slice(0, eq);
        })
        .filter(Boolean)
        .slice(0, 20);
      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const eq = trimmed.indexOf('=');
        const key = eq === -1 ? trimmed : trimmed.slice(0, eq);
        if (key === name) {
          return eq === -1 ? '' : decodeURIComponent(trimmed.slice(eq + 1));
        }
      }
    } catch {}
    return '';
  };

  const parsePinterestPath = () => {
    const requested = getRequestedUrl();
    const pathname = requested ? requested.pathname : location.pathname;
    const segments = String(pathname || '')
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);

    if (segments.length === 2) {
      const parsed = { user: segments[0], board: segments[1], section: '' };
      debugState.parsedPath = parsed;
      return parsed;
    }
    if (segments.length >= 3) {
      const parsed = { user: segments[0], board: segments[1], section: segments[2] };
      debugState.parsedPath = parsed;
      return parsed;
    }
    return null;
  };

  const normalizePins = (items) => {
    const out = [];
    const seen = new Set();
    for (const pin of Array.isArray(items) ? items : []) {
      if (out.length >= maxPins) break;
      const pinId = String(pin && pin.id ? pin.id : '').trim();
      if (!pinId) continue;
      const imageUrl =
        (((pin || {}).images || {})['736x'] || {}).url ||
        (((pin || {}).images || {})['564x'] || {}).url ||
        (((pin || {}).images || {})['474x'] || {}).url ||
        (((pin || {}).images || {})['236x'] || {}).url ||
        (((pin || {}).images || {})['orig'] || {}).url ||
        String(pin && pin.image_large_url ? pin.image_large_url : '');
      if (!imageUrl || imageUrl.indexOf('i.pinimg.com') === -1) continue;
      const pinHref = 'https://www.pinterest.com/pin/' + pinId + '/';
      const key = pinHref + '::' + imageUrl;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ pinHref, imageUrl });
    }
    return out;
  };

  const postPinterestResource = async (endpoint, options) => {
    const csrf = readCookie('csrftoken');
    debugState.csrfCookiePresent = Boolean(csrf);
    const requested = getRequestedUrl();
    const params = new URLSearchParams();
    params.set('source_url', (requested && requested.pathname) || location.pathname || '/');
    params.set('data', JSON.stringify({ options, context: {} }));

    const res = await fetch('https://www.pinterest.com/resource/' + endpoint + '/get/', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'X-Pinterest-AppState': 'active',
        'X-APP-VERSION': 'unknown',
        ...(csrf ? { 'X-CSRFToken': csrf } : {}),
      },
      body: params.toString(),
    });

    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}

    const summary = {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      bodyPreview: String(text || '').slice(0, 300),
      topLevelKeys: Object.keys(json || {}).slice(0, 10),
      resourceResponseKeys: Object.keys((((json || {}).resource_response) || {})).slice(0, 10),
    };

    if (endpoint === 'BoardSectionResource') {
      debugState.sectionResource = summary;
    } else if (endpoint === 'BoardSectionPinsResource') {
      debugState.pinsResource = summary;
    } else if (endpoint === 'BoardFeedResource') {
      debugState.boardResource = summary;
    }

    if (!res.ok) {
      throw new Error(endpoint + ' failed: ' + res.status + ' ' + res.statusText);
    }

    return json || {};
  };

  const simpleDomFallback = () => {
    const out = [];
    const seen = new Set();
    const anchors = Array.from(document.querySelectorAll('a[href*="/pin/"]'));
    for (const a of anchors) {
      if (out.length >= maxPins) break;
      let pinHref = '';
      try {
        pinHref = new URL(a.getAttribute('href') || '', location.origin).toString();
      } catch {
        continue;
      }
      const img = a.querySelector('img');
      const imageUrl = String(img && (img.currentSrc || img.src) ? (img.currentSrc || img.src) : '');
      if (!imageUrl || imageUrl.indexOf('i.pinimg.com') === -1) continue;
      const key = pinHref + '::' + imageUrl;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ pinHref, imageUrl });
    }
    return out;
  };

  (async () => {
    try {
      emitProgress('script-start');
      const parts = parsePinterestPath();
      emitProgress('parsed-path', { parsedPath: parts });

      if (!parts) {
        emit([], 'bad_path', { stage: 'bad-path' });
        return;
      }

      let pins = [];
      if (parts.section) {
        emitProgress('section-resource-start');
        const sectionJson = await postPinterestResource('BoardSectionResource', {
          board_slug: parts.board,
          section_slug: parts.section,
          username: parts.user,
        });
        const sectionId = ((((sectionJson || {}).resource_response || {}).data || {}).id) || '';
        debugState.sectionResource = {
          ...(debugState.sectionResource || {}),
          sectionId,
        };
        emitProgress('section-resource-done', { sectionId });

        if (!sectionId) {
          emit([], 'session_api_no_section_id', { stage: 'session-api-no-section-id' });
          return;
        }

        emitProgress('section-pins-start');
        const pinsJson = await postPinterestResource('BoardSectionPinsResource', {
          section_id: sectionId,
          page_size: Math.min(maxPins, 50),
          bookmark: '',
        });
        const items = ((((pinsJson || {}).resource_response || {}).data) || []);
        pins = normalizePins(items);
      } else {
        emitProgress('board-feed-start');
        const boardJson = await postPinterestResource('BoardFeedResource', {
          board_slug: parts.board,
          username: parts.user,
          page_size: Math.min(maxPins, 50),
        });
        const items = ((((boardJson || {}).resource_response || {}).data) || []);
        pins = normalizePins(items);
      }

      if (pins.length) {
        emit(pins, 'session_api', { stage: 'session-api-success' });
        return;
      }

      emitProgress('dom-fallback-start');
      const domPins = simpleDomFallback();
      if (domPins.length) {
        emit(domPins, 'dom_fallback', { stage: 'dom-fallback-success' });
        return;
      }

      emit([], 'session_api_empty', { stage: 'session-api-empty' });
    } catch (err) {
      debugState.sessionApiError = String(err && err.message ? err.message : err);
      emit([], 'session_api_error', {
        stage: 'session-api-error',
        debug: { sessionApiError: debugState.sessionApiError },
      });
    }
  })();
})();`
}

const buildPinterestScrapeScript = ({ requestId, maxPins, timeoutMs, targetUrl }) => {
  // IMPORTANT: This string is evaluated inside the Pinterest page.
  // Avoid template-literals inside this script.
  return `(() => {
  const requestId = ${JSON.stringify(String(requestId))};
  const maxPins = ${Number(maxPins) || 50};
  const timeoutMs = ${Number(timeoutMs) || 15000};
  const requestedUrl = ${JSON.stringify(String(targetUrl || ''))};
  const debugState = {
    requestedUrl,
    initialLocationHref: location.href,
    initialPathname: location.pathname,
    cookieNames: [],
    csrfCookiePresent: false,
    parsedPath: null,
    sectionResource: null,
    pinsResource: null,
    boardResource: null,
    sessionApiError: '',
  };

  const getRequestedUrl = () => {
    try {
      return requestedUrl ? new URL(requestedUrl) : new URL(location.href);
    } catch {
      try {
        return new URL(location.href);
      } catch {
        return null;
      }
    }
  };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const pickFromSrcset = (srcset) => {
    if (!srcset) return '';
    const parts = String(srcset).split(',').map(s => s.trim()).filter(Boolean);
    let bestUrl = '';
    let bestScale = 0;

    for (const part of parts) {
      const m = part.match(/^(\S+)\s+(\d+(?:\.\d+)?)x$/);
      if (m) {
        const url = m[1] || '';
        const scale = Number(m[2] || 0);
        if (url && scale >= bestScale) {
          bestScale = scale;
          bestUrl = url;
        }
        continue;
      }

      // Fallback when descriptor is missing.
      const urlOnly = part.split(' ')[0] || '';
      if (urlOnly && !bestUrl) bestUrl = urlOnly;
    }

    return bestUrl;
  };

  const normalizePinHref = (href) => {
    if (!href) return '';
    try {
      const u = new URL(href, location.origin);
      const m = u.pathname.match(/^\\/pin\\/(\\d+)(?:\\/)?$/);
      if (m) return 'https://www.pinterest.com/pin/' + m[1] + '/';
      return u.toString();
    } catch {
      return '';
    }
  };

  const decodeEscapedUrl = (value) => {
    if (!value) return '';
    return String(value)
      .replace(/\\u002F/g, '/')
      .replace(/\\\//g, '/')
      .replace(/\\"/g, '"');
  };

  const readCookie = (name) => {
    try {
      const parts = String(document.cookie || '').split(';');
      debugState.cookieNames = parts
        .map((part) => {
          const trimmed = part.trim();
          const eq = trimmed.indexOf('=');
          return eq === -1 ? trimmed : trimmed.slice(0, eq);
        })
        .filter(Boolean)
        .slice(0, 20);
      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const eq = trimmed.indexOf('=');
        const key = eq === -1 ? trimmed : trimmed.slice(0, eq);
        if (key === name) {
          return eq === -1 ? '' : decodeURIComponent(trimmed.slice(eq + 1));
        }
      }
    } catch {}
    return '';
  };

  const parsePinterestPath = () => {
    const requested = getRequestedUrl();
    const pathname = requested ? requested.pathname : location.pathname;
    const segments = String(pathname || '')
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);

    if (segments.length === 2) {
      const parsed = { user: segments[0], board: segments[1], section: '' };
      debugState.parsedPath = parsed;
      return parsed;
    }
    if (segments.length >= 3) {
      const parsed = { user: segments[0], board: segments[1], section: segments[2] };
      debugState.parsedPath = parsed;
      return parsed;
    }
    return null;
  };

  const extractPinsFromApiItems = (items) => {
    const out = [];
    const seen = new Set();
    for (const pin of Array.isArray(items) ? items : []) {
      if (out.length >= maxPins) break;

      const pinId = String(pin && pin.id ? pin.id : '').trim();
      if (!pinId) continue;

      const imageUrl =
        (((pin || {}).images || {})['736x'] || {}).url ||
        (((pin || {}).images || {})['564x'] || {}).url ||
        (((pin || {}).images || {})['474x'] || {}).url ||
        (((pin || {}).images || {})['236x'] || {}).url ||
        (((pin || {}).images || {})['orig'] || {}).url ||
        String(pin && pin.image_large_url ? pin.image_large_url : '');

      if (!imageUrl || imageUrl.indexOf('i.pinimg.com') === -1) continue;

      const pinHref = 'https://www.pinterest.com/pin/' + pinId + '/';
      const key = pinHref + '::' + imageUrl;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ pinHref, imageUrl });
    }
    return out;
  };

  const postPinterestResource = async (endpoint, data) => {
    const csrf = readCookie('csrftoken');
    debugState.csrfCookiePresent = Boolean(csrf);
    const requested = getRequestedUrl();
    const params = new URLSearchParams();
    params.set('source_url', (requested && requested.pathname) || location.pathname || '/');
    params.set('data', JSON.stringify({ options: data, context: {} }));

    const res = await fetch('https://www.pinterest.com/resource/' + endpoint + '/get/', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'X-Pinterest-AppState': 'active',
        'X-APP-VERSION': 'unknown',
        ...(csrf ? { 'X-CSRFToken': csrf } : {}),
      },
      body: params.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      if (endpoint === 'BoardSectionResource') {
        debugState.sectionResource = { ok: false, status: res.status, statusText: res.statusText, bodyPreview: text.slice(0, 300) };
      } else if (endpoint === 'BoardSectionPinsResource') {
        debugState.pinsResource = { ok: false, status: res.status, statusText: res.statusText, bodyPreview: text.slice(0, 300) };
      } else if (endpoint === 'BoardFeedResource') {
        debugState.boardResource = { ok: false, status: res.status, statusText: res.statusText, bodyPreview: text.slice(0, 300) };
      }
      throw new Error(endpoint + ' failed: ' + res.status + ' ' + res.statusText);
    }

    const json = await res.json();
    const summary = {
      ok: true,
      status: res.status,
      topLevelKeys: Object.keys(json || {}).slice(0, 10),
      resourceResponseKeys: Object.keys((((json || {}).resource_response) || {})).slice(0, 10),
    };
    if (endpoint === 'BoardSectionResource') {
      debugState.sectionResource = summary;
    } else if (endpoint === 'BoardSectionPinsResource') {
      debugState.pinsResource = summary;
    } else if (endpoint === 'BoardFeedResource') {
      debugState.boardResource = summary;
    }
    return json;
  };

  const fetchPinsViaSessionApi = async () => {
    const parts = parsePinterestPath();
    if (!parts) return [];

    if (parts.section) {
      const sectionJson = await postPinterestResource('BoardSectionResource', {
        board_slug: parts.board,
        section_slug: parts.section,
        username: parts.user,
      });

      const sectionId =
        ((((sectionJson || {}).resource_response || {}).data || {}).id) ||
        '';
      if (!sectionId) {
        throw new Error('BoardSectionResource returned no section id');
      }
      debugState.sectionResource = {
        ...(debugState.sectionResource || {}),
        sectionId,
      };

      const pinsJson = await postPinterestResource('BoardSectionPinsResource', {
        section_id: sectionId,
        page_size: Math.min(maxPins, 50),
        bookmark: '',
      });

      const items = ((((pinsJson || {}).resource_response || {}).data) || []);
      return extractPinsFromApiItems(items);
    }

    const boardJson = await postPinterestResource('BoardFeedResource', {
      board_slug: parts.board,
      username: parts.user,
      page_size: Math.min(maxPins, 50),
    });

    const items = ((((boardJson || {}).resource_response || {}).data) || []);
    return extractPinsFromApiItems(items);
  };

  const pinHrefFromElement = (el) => {
    if (!el) return '';

    try {
      const a = el.closest('a[href*="/pin/"]') || el.querySelector?.('a[href*="/pin/"]');
      const fromHref = normalizePinHref(a?.getAttribute?.('href'));
      if (fromHref) return fromHref;
    } catch {}

    const candidates = [
      el.getAttribute?.('data-pin-id'),
      el.getAttribute?.('data-id'),
      el.dataset?.pinId,
      el.dataset?.id,
      el.parentElement?.getAttribute?.('data-pin-id'),
      el.parentElement?.dataset?.pinId,
    ];

    for (const c of candidates) {
      const s = String(c || '').trim();
      if (/^\d{6,}$/.test(s)) return 'https://www.pinterest.com/pin/' + s + '/';
    }

    return '';
  };

  const extractFromPwsData = () => {
    const out = [];
    const seen = new Set();
    try {
      const script = document.querySelector('script#__PWS_DATA__');
      const raw = script?.textContent || '';
      if (!raw) return out;

      // Pair pin URL and nearby image URL from the same serialized object chunk.
      const pairRegex = /"url"\s*:\s*"(?:\\\/|\/)pin(?:\\\/|\/)\s*(\d+)\s*(?:\\\/|\/)"[\s\S]{0,1800}?"url"\s*:\s*"(https:(?:\\\\\/\\\\\/|\\\/\\\/|\\\/|\/\/)?i\.pinimg\.com[^"\n]+)"/g;
      let match;
      while ((match = pairRegex.exec(raw)) && out.length < maxPins) {
        const id = String(match[1] || '').trim();
        const imageUrl = decodeEscapedUrl(match[2]);
        if (!/^\d+$/.test(id)) continue;
        if (!imageUrl || imageUrl.indexOf('i.pinimg.com') === -1) continue;

        const pinHref = 'https://www.pinterest.com/pin/' + id + '/';
        const key = pinHref + '::' + imageUrl;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ pinHref, imageUrl });
      }
    } catch {}

    return out;
  };

  const collect = () => {
    const out = [];
    const seen = new Set();

    const anchors = Array.from(document.querySelectorAll('a[href*="/pin/"]'));
    for (const a of anchors) {
      const pinHref = normalizePinHref(a.getAttribute('href'));
      if (!pinHref) continue;

      const img = a.querySelector('img');
      let imageUrl = '';
      if (img) {
        imageUrl =
          pickFromSrcset(img.getAttribute('srcset')) ||
          img.currentSrc ||
          img.src ||
          '';
      }

      // Pinterest sometimes uses background-image tiles instead of <img>.
      if (!imageUrl || imageUrl.indexOf('i.pinimg.com') === -1) {
        const bgEl =
          a.querySelector('[style*="background-image"]') ||
          a.querySelector('div') ||
          a;
        const bg = (bgEl.style && bgEl.style.backgroundImage) || getComputedStyle(bgEl).backgroundImage;
        if (bg && bg !== 'none') {
          const match = bg.match(/url\\((['"]?)(.*?)\\1\\)/i);
          const bgUrl = match && match[2];
          if (bgUrl && bgUrl.indexOf('i.pinimg.com') !== -1) imageUrl = bgUrl;
        }
      }

      if (!imageUrl || imageUrl.indexOf('i.pinimg.com') === -1) continue;

      const key = pinHref + '::' + imageUrl;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ pinHref, imageUrl });
      if (out.length >= maxPins) break;
    }

    // Fallback: collect Pinterest CDN images even if links are not direct /pin/ anchors.
    if (out.length < Math.min(6, maxPins)) {
      const imgs = Array.from(document.querySelectorAll('img[srcset*="i.pinimg.com"], img[src*="i.pinimg.com"]'));
      for (const img of imgs) {
        const imageUrl =
          pickFromSrcset(img.getAttribute('srcset')) ||
          img.currentSrc ||
          img.src ||
          '';
        if (!imageUrl || imageUrl.indexOf('i.pinimg.com') === -1) continue;

        // Ignore tiny assets (icons/avatars).
        const w = Number(img.naturalWidth || img.width || 0);
        const h = Number(img.naturalHeight || img.height || 0);
        if ((w && w < 110) || (h && h < 110)) continue;

        let pinHref = pinHrefFromElement(img);
        if (!pinHref) pinHref = location.href;

        const key = pinHref + '::' + imageUrl;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ pinHref, imageUrl });
        if (out.length >= maxPins) break;
      }
    }

    if (out.length < Math.min(6, maxPins)) {
      const spans = Array.from(document.querySelectorAll('span[data-pin-href]'));
      for (const el of spans) {
        const pinHref = normalizePinHref(el.getAttribute('data-pin-href'));
        if (!pinHref) continue;

        const bg = (el.style && el.style.backgroundImage) || getComputedStyle(el).backgroundImage;
        if (!bg || bg === 'none') continue;
        const match = bg.match(/url\\((['"]?)(.*?)\\1\\)/i);
        const imageUrl = match && match[2];
        if (!imageUrl || imageUrl.indexOf('i.pinimg.com') === -1) continue;

        const key = pinHref + '::' + imageUrl;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ pinHref, imageUrl });
        if (out.length >= maxPins) break;
      }
    }

    // Final fallback: parse serialized Pinterest data blob for pin/image pairs.
    if (out.length < Math.min(6, maxPins)) {
      const pwsPins = extractFromPwsData();
      for (const item of pwsPins) {
        const key = item.pinHref + '::' + item.imageUrl;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
        if (out.length >= maxPins) break;
      }
    }

    return out;
  };

  const emit = (pins, reason, extra = {}) => {
    try {
      const payload = {
        requestId,
        url: location.href,
        pins,
        reason,
        stage: extra.stage || '',
        progress: Boolean(extra.progress),
        debug: {
          ...debugState,
          finalLocationHref: location.href,
          finalPathname: location.pathname,
          ...(extra.debug || {}),
        },
      };
      const encoded = encodeURIComponent(JSON.stringify(payload));
      location.hash = 'inkblot-scrape-' + requestId + '=' + encoded;
    } catch {
      // ignore
    }
  };

  const emitProgress = (stage, debug) => {
    emit([], 'progress', {
      progress: true,
      stage,
      debug: debug || {},
    });
  };

  (async () => {
    try {
      emitProgress('script-start');
      try {
        emitProgress('session-api-start');
        const apiPins = await fetchPinsViaSessionApi();
        if (apiPins.length) {
          emit(apiPins, 'session_api', { stage: 'session-api-success' });
          return;
        }
        emitProgress('session-api-empty');
      } catch (err) {
        debugState.sessionApiError = String(err && err.message ? err.message : err);
        emitProgress('session-api-error', { sessionApiError: debugState.sessionApiError });
      }

      emitProgress('dom-fallback-start');
      const start = Date.now();
      let best = [];
      let lastCount = 0;
      let stableFor = 0;
      let iterations = 0;

      const scrollStep = async () => {
        try {
          window.scrollBy(0, Math.max(600, window.innerHeight * 0.9));
        } catch {}
        await sleep(350);
      };

      while (Date.now() - start < timeoutMs) {
        iterations += 1;
        const pins = collect();
        if (pins.length > best.length) best = pins;

        if (iterations <= 2 || iterations % 5 === 0) {
          emitProgress('dom-loop', {
            iterations,
            loopPins: pins.length,
            bestPins: best.length,
            elapsedMs: Date.now() - start,
          });
        }

        if (pins.length >= maxPins) {
          emit(pins, 'max', { stage: 'dom-max' });
          return;
        }

        if (pins.length === lastCount && pins.length > 0) {
          stableFor += 350;
          if (stableFor >= 1200) {
            emit(pins, 'stable', { stage: 'dom-stable' });
            return;
          }
        } else {
          stableFor = 0;
          lastCount = pins.length;
        }

        await scrollStep();
      }

      emit(best, best.length ? 'timeout' : 'empty', { stage: 'dom-timeout' });
    } catch (err) {
      emit([], 'script_error', {
        stage: 'script-error',
        debug: { thrownError: String(err && err.message ? err.message : err) },
      });
    }
  })();
})();`
}
/* eslint-enable no-useless-escape */
