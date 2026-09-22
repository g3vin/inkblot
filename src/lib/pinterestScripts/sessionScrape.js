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

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
      // Straight to Rust. This used to go out through `location.hash`, with the app
      // polling the webview's URL ten times a second to notice it; Tauri puts its IPC
      // on the main frame of every webview it creates, including this one showing
      // pinterest.com, so the page can just say what it found.
      window.__TAURI_INTERNALS__.invoke('pinterest_report_scrape', { report: payload });
    } catch {
      // A report that cannot be sent is not worth failing the scrape over: the caller
      // times out and says so, which is what it would have done anyway.
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

  const fetchPinsViaSessionApi = async () => {
    const parts = parsePinterestPath();
    if (!parts) return [];

    if (parts.section) {
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
      if (!sectionId) {
        throw new Error('BoardSectionResource returned no section id');
      }

      const pinsJson = await postPinterestResource('BoardSectionPinsResource', {
        section_id: sectionId,
        page_size: Math.min(maxPins, 50),
        bookmark: '',
      });
      return normalizePins(((((pinsJson || {}).resource_response || {}).data) || []));
    }

    const boardJson = await postPinterestResource('BoardFeedResource', {
      board_slug: parts.board,
      username: parts.user,
      page_size: Math.min(maxPins, 50),
    });
    return normalizePins(((((boardJson || {}).resource_response || {}).data) || []));
  };

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
      const urlOnly = part.split(' ')[0] || '';
      if (urlOnly && !bestUrl) bestUrl = urlOnly;
    }
    return bestUrl;
  };

  const normalizePinHref = (href) => {
    if (!href) return '';
    try {
      const u = new URL(href, location.origin);
      const m = u.pathname.match(/^\/pin\/(\d+)(?:\/)?$/);
      if (m) return 'https://www.pinterest.com/pin/' + m[1] + '/';
      return u.toString();
    } catch {
      return '';
    }
  };

  const collectDomPins = () => {
    const out = [];
    const seen = new Set();
    const anchors = Array.from(document.querySelectorAll('a[href*="/pin/"]'));
    for (const a of anchors) {
      if (out.length >= maxPins) break;
      const pinHref = normalizePinHref(a.getAttribute('href'));
      if (!pinHref) continue;

      const img = a.querySelector('img');
      let imageUrl = '';
      if (img) {
        imageUrl = pickFromSrcset(img.getAttribute('srcset')) || img.currentSrc || img.src || '';
      }

      if (!imageUrl || imageUrl.indexOf('i.pinimg.com') === -1) {
        const bgEl = a.querySelector('[style*="background-image"]') || a.querySelector('div') || a;
        const bg = (bgEl.style && bgEl.style.backgroundImage) || getComputedStyle(bgEl).backgroundImage;
        if (bg && bg !== 'none') {
          const match = bg.match(/url\((['"]?)(.*?)\1\)/i);
          const bgUrl = match && match[2];
          if (bgUrl && bgUrl.indexOf('i.pinimg.com') !== -1) imageUrl = bgUrl;
        }
      }

      if (!imageUrl || imageUrl.indexOf('i.pinimg.com') === -1) continue;
      const key = pinHref + '::' + imageUrl;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ pinHref, imageUrl });
    }

    if (out.length < Math.min(6, maxPins)) {
      const imgs = Array.from(document.querySelectorAll('img[srcset*="i.pinimg.com"], img[src*="i.pinimg.com"]'));
      for (const img of imgs) {
        if (out.length >= maxPins) break;
        const imageUrl = pickFromSrcset(img.getAttribute('srcset')) || img.currentSrc || img.src || '';
        if (!imageUrl || imageUrl.indexOf('i.pinimg.com') === -1) continue;
        const w = Number(img.naturalWidth || img.width || 0);
        const h = Number(img.naturalHeight || img.height || 0);
        if ((w && w < 110) || (h && h < 110)) continue;
        const pinHref = normalizePinHref(img.closest('a[href*="/pin/"]')?.getAttribute?.('href')) || location.href;
        const key = pinHref + '::' + imageUrl;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ pinHref, imageUrl });
      }
    }

    return out;
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

      while (Date.now() - start < timeoutMs) {
        const pins = collectDomPins();
        if (pins.length > best.length) best = pins;
        if (pins.length >= maxPins) {
          emit(pins, 'max', { stage: 'session-dom-max' });
          return;
        }
        if (pins.length === lastCount && pins.length > 0) {
          stableFor += 350;
          if (stableFor >= 1200) {
            emit(pins, 'stable', { stage: 'session-dom-stable' });
            return;
          }
        } else {
          stableFor = 0;
          lastCount = pins.length;
        }
        try {
          window.scrollBy(0, Math.max(600, window.innerHeight * 0.9));
        } catch {}
        await sleep(350);
      }

      emit(best, best.length ? 'timeout' : (debugState.sessionApiError ? 'session_api_error' : 'empty'), { stage: 'session-dom-timeout' });
    } catch (err) {
      emit([], 'script_error', {
        stage: 'script-error',
        debug: { thrownError: String(err && err.message ? err.message : err) },
      });
    }
  })();
