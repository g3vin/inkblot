
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const pickFromSrcset = (srcset) => {
    if (!srcset) return '';
    const parts = String(srcset).split(',').map(s => s.trim()).filter(Boolean);
    let bestUrl = '';
    let bestScale = 0;

    for (const part of parts) {
      const m = part.match(/^(S+)s+(d+(?:.d+)?)x$/);
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
      const m = u.pathname.match(/^\/pin\/(\d+)(?:\/)?$/);
      if (m) return 'https://www.pinterest.com/pin/' + m[1] + '/';
      return u.toString();
    } catch {
      return '';
    }
  };

  const decodeEscapedUrl = (value) => {
    if (!value) return '';
    return String(value)
      .replace(/\u002F/g, '/')
      .replace(/\//g, '/')
      .replace(/\"/g, '"');
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
      if (/^d{6,}$/.test(s)) return 'https://www.pinterest.com/pin/' + s + '/';
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
      const pairRegex = /"url"s*:s*"(?:\/|/)pin(?:\/|/)s*(d+)s*(?:\/|/)"[sS]{0,1800}?"url"s*:s*"(https:(?:\\/\\/|\/\/|\/|//)?i.pinimg.com[^"
]+)"/g;
      let match;
      while ((match = pairRegex.exec(raw)) && out.length < maxPins) {
        const id = String(match[1] || '').trim();
        const imageUrl = decodeEscapedUrl(match[2]);
        if (!/^d+$/.test(id)) continue;
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
        const match = bg.match(/url\((['"]?)(.*?)\1\)/i);
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
