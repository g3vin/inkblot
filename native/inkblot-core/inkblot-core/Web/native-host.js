/**
 * native-host.js — `window.__inkblotNative`, the webview's end of the bridge wire.
 *
 * Injected at document start. `src/bridge/transport.ts` (`NativeHost`,
 * `createNativeHostTransports`) is the other half and documents the contract; this is
 * only the part that has to exist before the bundle does.
 *
 * `listen` drains a queue because Swift delivers as soon as it has something to say,
 * and the module graph that calls `listen` may not have evaluated yet.
 *
 * `window.__inkblotNativeChrome` is set by a one-line script `EditorWebView.swift`
 * injects just before this one: the parts of the chrome the shell draws itself. See
 * `src/lib/host.ts`.
 */
;(() => {
  if (window.__inkblotNative) return
  const queue = []
  let listener = null

  window.__inkblotNative = Object.freeze({
    chrome: Object.freeze([...(window.__inkblotNativeChrome || [])]),
    post: (json) => { window.webkit.messageHandlers.inkblotBridge.postMessage(json) },
    listen: (handler) => {
      listener = handler
      while (queue.length && listener === handler) handler(queue.shift())
      return () => { if (listener === handler) listener = null }
    },
    deliver: (json) => {
      if (listener) listener(json)
      else queue.push(json)
    },
  })
})()
