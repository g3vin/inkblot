import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { invoke } from '@tauri-apps/api/core'

let scrapeWindow = null

const SCRAPE_LABEL = 'pinterest-scrape'
const SCRAPE_LOG = '[PinterestScrape]'

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
  const created = await waitForWindowEvent(win, 'tauri://created', { timeoutMs: 8000 })
  console.debug(SCRAPE_LOG, 'window created event', created)
  // Keep this short – Pinterest SPA pages rarely fire tauri://page-load
  // reliably, and the probe script will validate JS execution anyway.
  const loaded = await waitForWindowEvent(win, 'tauri://page-load', { timeoutMs: 4000 })
  console.debug(SCRAPE_LOG, 'first page-load event', loaded)
}

const evalWithRetry = async (script, { attempts = 35, delayMs = 200 } = {}) => {
  const maxAttempts = Math.max(1, Math.min(100, Number(attempts) || 35))
  const d = Math.max(50, Math.min(1000, Number(delayMs) || 200))

  let lastErr = null
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await invoke('eval_webview', { label: SCRAPE_LABEL, script })
      console.debug(SCRAPE_LOG, 'eval_webview success', { attempt: i + 1, maxAttempts })
      return { ok: true }
    } catch (e) {
      lastErr = e
      const msg = String(e?.message || e || '')
      console.debug(SCRAPE_LOG, 'eval_webview failed', { attempt: i + 1, maxAttempts, msg })

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

const waitForScrapePayload = async (requestId, timeoutMs) => {
  const started = Date.now()
  const deadline = started + Math.max(1000, Number(timeoutMs) || 15000)
  let polls = 0

  while (Date.now() < deadline) {
    polls += 1
    try {
      const currentUrl = await invoke('get_webview_url', { label: SCRAPE_LABEL })
      const payload = readScrapePayloadFromUrl(currentUrl, requestId)
      if (payload) {
        console.debug(SCRAPE_LOG, 'payload detected in webview URL hash', {
          polls,
          elapsedMs: Date.now() - started,
          reason: payload?.reason,
          finalUrl: payload?.url,
          pins: Array.isArray(payload?.pins) ? payload.pins.length : 0,
        })
        return payload
      }

      if (polls <= 3 || polls % 10 === 0) {
        console.debug(SCRAPE_LOG, 'polling scrape payload', {
          polls,
          elapsedMs: Date.now() - started,
          currentUrl: String(currentUrl || '').slice(0, 220),
        })
      }
    } catch {
      // ignore and retry
      if (polls <= 3 || polls % 10 === 0) {
        console.debug(SCRAPE_LOG, 'polling scrape payload failed to read webview URL', {
          polls,
          elapsedMs: Date.now() - started,
        })
      }
    }

    await sleep(220)
  }

  console.debug(SCRAPE_LOG, 'payload polling timed out', {
    requestId,
    waitedMs: Date.now() - started,
    timeoutMs,
    polls,
  })

  return null
}

const ensureScrapeWindow = async (url) => {
  if (scrapeWindow) {
    try {
      console.debug(SCRAPE_LOG, 'reusing scrape window; navigating', { url })
      // Navigate existing window.
      // Attach the load listener before navigating to avoid missing the event.
      const loadPromise = waitForWindowEvent(scrapeWindow, 'tauri://page-load', { timeoutMs: 4000 })
      await invoke('navigate_webview', { label: SCRAPE_LABEL, url })
      const loadResult = await loadPromise
      console.debug(SCRAPE_LOG, 'reused window page-load', loadResult)
      return scrapeWindow
    } catch {
      console.debug(SCRAPE_LOG, 'reused window failed; recreating')
      try { await scrapeWindow.destroy() } catch { /* ignore */ }
      scrapeWindow = null
    }
  }

  console.debug(SCRAPE_LOG, 'creating scrape window', { url })
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
    resizable: false,
    decorations: false,
  })

  scrapeWindow.once('tauri://destroyed', () => {
    console.debug(SCRAPE_LOG, 'scrape window destroyed')
    scrapeWindow = null
  })

  // Reduce races where invoke('eval_webview') runs before the label exists.
  await waitForCreatedAndFirstLoad(scrapeWindow)

  return scrapeWindow
}

/**
 * Scrape pin thumbnails (and pin links) from a public Pinterest board/section URL.
 *
 * Returns: { pins: [{ pinHref, imageUrl }], finalUrl?: string, reason?: string, error?: string }
 */
export async function scrapePinterestPins(url, { maxPins = 50, timeoutMs = 15000 } = {}) {
  const targetUrl = String(url || '').trim()
  if (!targetUrl) return { pins: [], reason: 'no_url' }

  const reqMaxPins = Math.max(1, Math.min(200, Number(maxPins) || 50))
  const reqTimeoutMs = Math.max(2000, Math.min(60000, Number(timeoutMs) || 15000))
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`

  console.debug(SCRAPE_LOG, 'starting scrape', {
    requestId,
    targetUrl,
    reqMaxPins,
    reqTimeoutMs,
  })

  // Prefer a Rust-side HTML scrape first (avoids fragile webview eval on remote pages).
  try {
    const scrapeResponse = await invoke('scrape_pinterest_html', {
      url: targetUrl,
      maxPins: reqMaxPins,
    })

    // Log the full fetched HTML for debugging.
    console.debug(SCRAPE_LOG, 'scraped Pinterest HTML', scrapeResponse?.html)

    const directPins = Array.isArray(scrapeResponse?.pins) ? scrapeResponse.pins : []

    const normalizedDirectPins = directPins
      .map((p) => ({
        pinHref: String(p?.pinHref || ''),
        imageUrl: String(p?.imageUrl || ''),
      }))
      .filter((p) => p.pinHref && p.imageUrl)

    console.debug(SCRAPE_LOG, 'direct html scrape result', {
      requestId,
      targetUrl,
      pinCount: normalizedDirectPins.length,
    })

    if (normalizedDirectPins.length) {
      return {
        pins: normalizedDirectPins,
        finalUrl: targetUrl,
        reason: 'direct_html',
      }
    }
  } catch (e) {
    console.debug(SCRAPE_LOG, 'direct html scrape failed; falling back to webview eval', {
      requestId,
      targetUrl,
      error: String(e?.message || e || ''),
    })
  }

  await ensureScrapeWindow(targetUrl)

  try {
    // Brief pause for the page to start loading its JS bundles.
    // The probe script will confirm execution works before we proceed.
    await sleep(400)

    // Probe whether injected JS actually executes in this remote page.
    const probeRequestId = `${requestId}-probe`
    const probeScript = buildPinterestProbeScript({ requestId: probeRequestId })
    const probeEval = await evalWithRetry(probeScript, { attempts: 20, delayMs: 150 })
    if (!probeEval.ok) {
      console.debug(SCRAPE_LOG, 'eval probe failed', {
        requestId,
        targetUrl,
        error: String(probeEval?.error?.message || probeEval?.error || ''),
      })
      return {
        pins: [],
        finalUrl: targetUrl,
        reason: 'eval_probe_failed',
        error: String(probeEval?.error?.message || probeEval?.error || ''),
      }
    }

    const probePayload = await waitForScrapePayload(probeRequestId, 3500)
    if (!probePayload) {
      console.debug(SCRAPE_LOG, 'eval probe did not execute', { requestId, targetUrl })
      return {
        pins: [],
        finalUrl: targetUrl,
        reason: 'eval_noexec',
      }
    }
    console.debug(SCRAPE_LOG, 'eval probe payload received', {
      requestId,
      targetUrl,
      probeReason: probePayload?.reason,
      probeUrl: probePayload?.url,
    })

    // Budget the remaining time so the internal script timeout + poll wait
    // fit within the caller's overall timeout.
    const elapsedSoFar = Date.now() - parseInt(requestId.split('-')[0], 10)
    const scriptTimeout = Math.max(3000, reqTimeoutMs - elapsedSoFar)
    console.debug(SCRAPE_LOG, 'scrape script timeout budget', {
      requestId,
      elapsedSoFar,
      reqTimeoutMs,
      scriptTimeout,
    })

    const script = buildPinterestScrapeScript({
      requestId,
      maxPins: reqMaxPins,
      timeoutMs: scriptTimeout,
    })

    const evalResult = await evalWithRetry(script, { attempts: 35, delayMs: 200 })
    if (!evalResult.ok) {
      console.debug(SCRAPE_LOG, 'eval failed', {
        requestId,
        targetUrl,
        error: String(evalResult?.error?.message || evalResult?.error || ''),
      })
      return {
        pins: [],
        finalUrl: targetUrl,
        reason: 'eval_failed',
        error: String(evalResult?.error?.message || evalResult?.error || ''),
      }
    }

    const payload = await waitForScrapePayload(requestId, scriptTimeout + 5000)
    if (!payload) {
      console.debug(SCRAPE_LOG, 'scrape timed out waiting for payload', { requestId, targetUrl })
      return {
        pins: [],
        finalUrl: targetUrl,
        reason: 'timeout',
      }
    }

    const pins = Array.isArray(payload?.pins) ? payload.pins : []
    console.debug(SCRAPE_LOG, 'scrape complete', {
      requestId,
      reason: payload?.reason,
      finalUrl: payload?.url,
      pinCount: pins.length,
    })
    return {
      pins,
      finalUrl: String(payload?.url || targetUrl),
      reason: String(payload?.reason || (pins.length ? 'ok' : 'empty')),
    }
  } finally {
    // Keep window around for re-use but ensure it stays hidden.
    try {
      await scrapeWindow?.hide?.()
    } catch {
      /* ignore */
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
    var payload = { requestId: ${JSON.stringify(String(requestId))}, reason: 'probe', url: location.href, pins: [] };
    var encoded = encodeURIComponent(JSON.stringify(payload));
    location.hash = 'inkblot-scrape-' + ${JSON.stringify(String(requestId))} + '=' + encoded;
  } catch (e) {
    // ignore
  }
})();`
}

const buildPinterestScrapeScript = ({ requestId, maxPins, timeoutMs }) => {
  // IMPORTANT: This string is evaluated inside the Pinterest page.
  // Avoid template-literals inside this script.
  return `(() => {
  const requestId = ${JSON.stringify(String(requestId))};
  const maxPins = ${Number(maxPins) || 50};
  const timeoutMs = ${Number(timeoutMs) || 15000};

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

  const emit = (pins, reason) => {
    try {
      const payload = {
        requestId,
        url: location.href,
        pins,
        reason,
      };
      console.debug('[PinterestScrapeInjected]', 'emit payload', {
        requestId,
        reason,
        pinCount: Array.isArray(pins) ? pins.length : 0,
        url: location.href,
      });
      const encoded = encodeURIComponent(JSON.stringify(payload));
      location.hash = 'inkblot-scrape-' + requestId + '=' + encoded;
    } catch {
      // ignore
    }
  };

  (async () => {
    try {
      const start = Date.now();
      let best = [];
      let lastCount = 0;
      let stableFor = 0;

      const scrollStep = async () => {
        try {
          window.scrollBy(0, Math.max(600, window.innerHeight * 0.9));
        } catch {}
        await sleep(350);
      };

      while (Date.now() - start < timeoutMs) {
        const pins = collect();
        if (pins.length > best.length) best = pins;

        if (pins.length >= maxPins) {
          emit(pins, 'max');
          return;
        }

        if (pins.length === lastCount && pins.length > 0) {
          stableFor += 350;
          if (stableFor >= 1200) {
            emit(pins, 'stable');
            return;
          }
        } else {
          stableFor = 0;
          lastCount = pins.length;
        }

        await scrollStep();
      }

      emit(best, best.length ? 'timeout' : 'empty');
    } catch (err) {
      try {
        console.debug('[PinterestScrapeInjected]', 'script error', String(err && err.message ? err.message : err));
      } catch {}
      emit([], 'script_error');
    }
  })();
})();`
}
/* eslint-enable no-useless-escape */
