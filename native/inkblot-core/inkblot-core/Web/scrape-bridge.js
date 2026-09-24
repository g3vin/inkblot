/**
 * scrape-bridge.js — the one Tauri call a Pinterest page may make.
 *
 * The scrape scripts `pinterestScrape.js` injects into a Pinterest window answer with
 * `window.__TAURI_INTERNALS__.invoke('pinterest_report_scrape', { report })`. Under
 * Tauri that works because app commands reach every webview. Here the page is
 * pinterest.com, so it gets this instead of `tauri-shim.js`: an `invoke` that knows
 * exactly one command, and a message handler (`AuxiliaryWindow`) that accepts exactly
 * one. A remote page with the full shim could read and write the user's files.
 */
;(() => {
  if (window.__TAURI_INTERNALS__) return

  const invoke = (cmd, args) => {
    if (cmd !== 'pinterest_report_scrape') {
      return Promise.reject(`${cmd}: not available to this page`)
    }
    try {
      window.webkit.messageHandlers.inkblotScrape.postMessage(JSON.stringify((args && args.report) || {}))
      return Promise.resolve(null)
    } catch (error) {
      return Promise.reject(String(error))
    }
  }

  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    value: Object.freeze({ invoke }),
    configurable: false,
    writable: false,
  })
})()
