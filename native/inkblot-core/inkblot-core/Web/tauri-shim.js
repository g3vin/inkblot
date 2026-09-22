/**
 * tauri-shim.js — the Tauri IPC surface, answered by the Swift shell.
 *
 * Injected at document start, before any of the web bundle runs. The bundle was
 * written against Tauri and still is: `@tauri-apps/plugin-fs` persists every
 * document, `plugin-dialog` asks before every delete, `api/menu` builds every context
 * menu. All of those call `window.__TAURI_INTERNALS__`, and nothing else — so
 * implementing that one object is what lets the same `dist/` run under both shells
 * with no build flag and no fork.
 *
 * This is a compatibility layer, not the destination. Each piece of chrome that moves
 * to Swift stops calling through here; when the last one has, what is left is the
 * filesystem, and that belongs on the bridge protocol, not on Tauri's.
 *
 * **What is answered here and what crosses.** Callbacks, channels, event listeners
 * and the menu resource tree are pure bookkeeping, and they live here, because a
 * round trip per `MenuItem.new` would be forty round trips per right-click. Swift is
 * only asked for what needs the machine: the disk, a panel, a pasteboard, the window,
 * and the moment a menu is actually shown.
 *
 * **The wire.** `webkit.messageHandlers.tauri` is a `WKScriptMessageHandlerWithReply`,
 * so `postMessage` returns a promise. Requests and replies are JSON strings, for the
 * same reason the bridge's are (see `NativeHost` in `src/bridge/transport.ts`); bytes
 * travel as base64 inside them.
 *
 * Tested by `scripts/canvas-tests/shim.mjs`, against the wire formats the real
 * `@tauri-apps/*` packages produce.
 */
;(() => {
  if (window.__TAURI_INTERNALS__) return

  /* ---------------- talking to Swift ---------------- */

  const handler = () => window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.tauri

  // plugin-fs sends a file's contents as the whole argument, not as a field of it.
  // Checked by internal slot rather than `instanceof`, which is false for a buffer made
  // in another realm — an iframe's, or a worker's handed back.
  const isArrayBuffer = (value) => Object.prototype.toString.call(value) === '[object ArrayBuffer]'
  const isBytes = (value) => ArrayBuffer.isView(value) || isArrayBuffer(value)

  const toBase64 = (value) => {
    const bytes = isArrayBuffer(value)
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    let binary = ''
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
    }
    return btoa(binary)
  }

  const fromBase64 = (text) => {
    const binary = atob(text)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes.buffer
  }

  // A Channel's `toJSON` is `__CHANNEL__:<id>`, which is all Swift should ever see of one.
  const serialize = (value) => JSON.stringify(value)

  /**
   * Ask Swift. A reply is `{ ok, value }`, `{ ok, bytes }` or `{ ok: false, error }`.
   * A rejection carries the message as a string, as Tauri's own invoke does — callers
   * in the bundle `String(error)` it, and an `Error` would print its class name first.
   */
  const native = async (cmd, args, options) => {
    const target = handler()
    if (!target) throw `${cmd}: not running inside the Inkblot shell`
    const request = { cmd, args: isBytes(args) ? {} : (args ?? {}) }
    if (isBytes(args)) request.bytes = toBase64(args)
    if (options && options.headers) request.headers = options.headers
    const raw = await target.postMessage(serialize(request))
    const reply = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!reply || reply.ok === false) throw (reply && reply.error) || `${cmd} failed`
    if (typeof reply.bytes === 'string') return fromBase64(reply.bytes)
    return reply.value === undefined ? null : reply.value
  }

  /* ---------------- callbacks and channels ---------------- */

  const callbacks = new Map()
  let nextCallbackId = 1

  const transformCallback = (callback, once = false) => {
    const id = nextCallbackId++
    callbacks.set(id, (payload) => {
      if (once) callbacks.delete(id)
      return callback && callback(payload)
    })
    return id
  }

  const unregisterCallback = (id) => { callbacks.delete(id) }

  const runCallback = (id, payload) => {
    const callback = callbacks.get(id)
    if (callback) callback(payload)
  }

  // A Channel delivers `{ message, index }` and reorders by index, so each channel's
  // count has to be kept here, per channel, from zero.
  const channelIndex = new Map()
  const sendToChannel = (channelId, message) => {
    const index = channelIndex.get(channelId) ?? 0
    channelIndex.set(channelId, index + 1)
    runCallback(channelId, { message, index })
  }

  const channelIdOf = (value) => {
    if (value == null) return null
    if (typeof value === 'number') return value
    if (typeof value === 'object' && typeof value.id === 'number') return value.id
    const match = /^__CHANNEL__:(\d+)$/.exec(String(value))
    return match ? Number(match[1]) : null
  }

  /* ---------------- events ---------------- */

  // event -> Map<eventId, { callbackId, label }>. `label` is the window a listener was
  // aimed at (`win.once('tauri://destroyed', …)` targets that window), or null for any.
  const listeners = new Map()
  let nextEventId = 1

  const targetLabel = (target) =>
    target && typeof target === 'object' && target.kind !== 'Any' && typeof target.label === 'string'
      ? target.label
      : null

  const events = {
    listen({ event, target, handler: callbackId }) {
      const eventId = nextEventId++
      if (!listeners.has(event)) listeners.set(event, new Map())
      listeners.get(event).set(eventId, { callbackId, label: targetLabel(target) })
      return eventId
    },
    unlisten({ event, eventId }) {
      listeners.get(event)?.delete(eventId)
    },
    emit({ event, payload }) {
      dispatchEvent(event, payload)
    },
    emit_to({ target, event, payload }) {
      dispatchEvent(event, payload, targetLabel(target))
    },
  }

  /**
   * Deliver to every listener, or — for an event about one window — to the listeners
   * for any window and the ones aimed at that window. Two Pinterest windows' `destroyed`
   * handlers must not both fire when one of them closes.
   */
  const dispatchEvent = (event, payload, label = null) => {
    const registered = listeners.get(event)
    if (!registered) return
    for (const [eventId, listener] of [...registered]) {
      if (label != null && listener.label != null && listener.label !== label) continue
      runCallback(listener.callbackId, { event, id: eventId, payload })
    }
  }

  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (event, eventId) => { listeners.get(event)?.delete(eventId) },
  }

  /* ---------------- menus ----------------
     The whole resource tree lives here. Swift sees a menu only when it is shown, as a
     plain tree of `{ rid, kind, text, enabled, checked, accelerator, predefined,
     items }`, and answers with the rid that was chosen. */

  const resources = new Map()
  let nextRid = 1
  let appMenuRid = null

  const createItem = (kind, options = {}, handlerChannel = null) => {
    const rid = nextRid++
    const item = {
      rid,
      kind,
      id: options.id != null ? String(options.id) : `inkblot-menu-${rid}`,
      text: options.text != null ? String(options.text) : '',
      enabled: options.enabled !== false,
      checked: options.checked === true,
      accelerator: options.accelerator ?? null,
      predefined: null,
      items: [],
      channel: channelIdOf(handlerChannel ?? options.handler),
    }
    if (kind === 'Predefined') {
      const predefined = options.item
      item.predefined = typeof predefined === 'string'
        ? predefined
        : predefined && typeof predefined === 'object' ? Object.keys(predefined)[0] : null
      if (!item.text && item.predefined) item.text = item.predefined
    }
    resources.set(rid, item)
    for (const child of options.items || []) item.items.push(resolveChild(child))
    return item
  }

  // A child is either an existing resource (`[rid, kind]`) or inline options.
  const resolveChild = (child) => {
    if (Array.isArray(child)) return child[0]
    if (child && typeof child === 'object' && typeof child.rid === 'number') return child.rid
    const kind = child.items ? 'Submenu'
      : child.item ? 'Predefined'
        : child.checked !== undefined ? 'Check'
          : 'MenuItem'
    return createItem(kind, child, child.handler).rid
  }

  const describe = (rid) => {
    const item = resources.get(rid)
    if (!item) return null
    return {
      rid: item.rid,
      kind: item.kind,
      id: item.id,
      text: item.text,
      enabled: item.enabled,
      checked: item.checked,
      accelerator: item.accelerator,
      predefined: item.predefined,
      items: item.items.map(describe).filter(Boolean),
    }
  }

  const findById = (rid, id) => {
    const item = resources.get(rid)
    if (!item) return null
    for (const childRid of item.items) {
      const child = resources.get(childRid)
      if (!child) continue
      if (child.id === id) return child
      const nested = findById(childRid, id)
      if (nested) return nested
    }
    return null
  }

  const tuple = (item) => [item.rid, item.id, item.kind]

  const isInAppMenu = (rid, root = appMenuRid) => {
    if (root == null) return false
    if (root === rid) return true
    return (resources.get(root)?.items || []).some((child) => isInAppMenu(rid, child))
  }

  // An app-menu item's checkmark or label changing has to reach the menu bar.
  const publishAppMenu = () => {
    if (appMenuRid == null) return Promise.resolve(null)
    return native('menu.setApp', { menu: describe(appMenuRid) }).catch(() => null)
  }

  const touched = (rid) => { if (isInAppMenu(rid)) void publishAppMenu() }

  const menus = {
    new({ kind, options, handler: channel }) {
      const item = createItem(kind, options || {}, channel)
      return [item.rid, item.id]
    },
    create_default() {
      const item = createItem('Menu', {})
      return [item.rid, item.id]
    },
    append({ rid, items }) {
      resources.get(rid)?.items.push(...(items || []).map(resolveChild))
      touched(rid)
    },
    prepend({ rid, items }) {
      resources.get(rid)?.items.unshift(...(items || []).map(resolveChild))
      touched(rid)
    },
    insert({ rid, items, position }) {
      resources.get(rid)?.items.splice(position, 0, ...(items || []).map(resolveChild))
      touched(rid)
    },
    remove({ rid, item }) {
      const parent = resources.get(rid)
      if (!parent) return
      const childRid = Array.isArray(item) ? item[0] : item
      parent.items = parent.items.filter((existing) => existing !== childRid)
      touched(rid)
    },
    remove_at({ rid, position }) {
      const parent = resources.get(rid)
      if (!parent) return null
      const [removed] = parent.items.splice(position, 1)
      touched(rid)
      const item = resources.get(removed)
      return item ? tuple(item) : null
    },
    items({ rid }) {
      return (resources.get(rid)?.items || []).map((child) => resources.get(child)).filter(Boolean).map(tuple)
    },
    get({ rid, id }) {
      const found = findById(rid, id)
      return found ? tuple(found) : null
    },
    text({ rid }) { return resources.get(rid)?.text ?? '' },
    set_text({ rid, text }) { const item = resources.get(rid); if (item) item.text = String(text); touched(rid) },
    is_enabled({ rid }) { return resources.get(rid)?.enabled ?? false },
    set_enabled({ rid, enabled }) { const item = resources.get(rid); if (item) item.enabled = Boolean(enabled); touched(rid) },
    is_checked({ rid }) { return resources.get(rid)?.checked ?? false },
    set_checked({ rid, checked }) { const item = resources.get(rid); if (item) item.checked = Boolean(checked); touched(rid) },
    set_accelerator({ rid, accelerator }) { const item = resources.get(rid); if (item) item.accelerator = accelerator ?? null; touched(rid) },
    set_icon() {},
    set_as_window_menu() { return null },
    set_as_help_menu_for_nsapp() {},
    set_as_windows_menu_for_nsapp() {},
    async set_as_app_menu({ rid }) {
      const previous = appMenuRid
      appMenuRid = rid
      await publishAppMenu()
      const item = previous != null ? resources.get(previous) : null
      return item ? [item.rid, item.id] : null
    },
    async popup({ rid, at }) {
      const chosen = await native('menu.popup', { menu: describe(rid), at: at ?? null })
      if (chosen != null) activate(chosen)
    },
  }

  /** A menu item was chosen — from a popup, or from the menu bar. */
  const activate = (rid) => {
    const item = resources.get(Number(rid))
    if (!item) return
    if (item.kind === 'Check') {
      // NSMenu does not toggle a checkmark by itself and neither does Tauri's JS; the
      // Rust side of Tauri flips it before the handler runs, so this has to as well.
      item.checked = !item.checked
      touched(item.rid)
    }
    if (item.channel != null) sendToChannel(item.channel, item.id)
  }

  /* ---------------- windows ---------------- */

  // A detached document window is told its label before this runs; the main window is
  // `main`, as it is under Tauri.
  const WINDOW_LABEL = window.__inkblotWindowLabel || 'main'

  const isOwn = (args) => args == null || args.label == null || args.label === WINDOW_LABEL

  const windows = {
    // The shell draws no titlebar row, so the page's top strip is what the window is
    // dragged by — and only the shell can move a window.
    start_dragging() { return native('window.startDrag') },
    get_all_windows() { return native('window.list') },
    is_fullscreen() { return native('window.isFullscreen') },
    set_title(args) {
      return isOwn(args)
        ? native('window.setTitle', { title: args.value })
        : native('window.op', { label: args.label, op: 'set_title', value: args.value })
    },
  }

  /** Any other window verb — `show`, `hide`, `set_focus`, `destroy` — on any window, by label. */
  const windowOp = (name) => (args) =>
    native('window.op', { label: args?.label ?? WINDOW_LABEL, op: name, value: args?.value ?? null })

  const webviews = {
    // `new WebviewWindow(label, options)`: a detached document, or a Pinterest page.
    create_webview_window({ options }) { return native('window.create', { options }) },
  }

  /* ---------------- dispatch ---------------- */

  const local = (cmd) => {
    const [plugin, name] = cmd.startsWith('plugin:') ? cmd.slice(7).split('|') : [null, cmd]
    if (plugin === 'event') return events[name]
    if (plugin === 'menu') return menus[name]
    if (plugin === 'window') return windows[name] || windowOp(name)
    if (plugin === 'webview') return webviews[name] || (() => null)
    if (plugin === 'resources' && name === 'close') return () => null
    return null
  }

  const invoke = async (cmd, args = {}, options) => {
    const handle = local(cmd)
    if (handle) return handle(args || {})
    return native(cmd, args, options)
  }

  window.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback,
    unregisterCallback,
    runCallback,
    callbacks,
    convertFileSrc: (filePath, protocol = 'asset') =>
      `${protocol}://localhost/${encodeURIComponent(filePath)}`,
    metadata: {
      currentWindow: { label: WINDOW_LABEL },
      currentWebview: { windowLabel: WINDOW_LABEL, label: WINDOW_LABEL },
    },
    plugins: { path: { sep: '/', delimiter: ':' } },
  }

  /** What Swift calls into. Everything else on this page is the bundle's. */
  window.__inkblotTauri = Object.freeze({
    emit: dispatchEvent,
    activateMenuItem: activate,
  })
})()
