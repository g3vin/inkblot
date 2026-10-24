/**
 * tauri-mock.js — the Tauri bridge, faked for showcase captures (showcase/capture.mjs).
 *
 * Grown from scripts/dev/tauri-mock.js. Where that one pattern-matches a few paths, this
 * one keeps a small in-memory filesystem seeded from showcase/fixtures/, so the app
 * opens, reads, saves and lists a real-looking project. capture.mjs sets
 * `window.__SHOWCASE__ = { files, prefs }` before this runs:
 *
 *   files  { '/mock/<project>/<file>': '<text>' | { base64, type } } — everything under the
 *          projects folder; a binary file (a voice memo) is base64 with its media type
 *   prefs  what preferences_load answers (the theme, the accent, the editor session, …)
 *   ipc    fixed answers for native commands a shot needs, by name (get_synonyms, …)
 *
 * Commands it doesn't know answer null, as in the dev mock. Set `__SHOWCASE__.log` to
 * print every call (for writing a new shot).
 */
(() => {
  const ROOT = '/mock'
  const setup = window.__SHOWCASE__ || {}
  // Text stays a string; a binary file becomes { data: Uint8Array, type }.
  const decodeBinary = ({ base64, type }) => ({ data: Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)), type })
  const files = new Map(Object.entries(setup.files || {}).map(([p, v]) => [p, typeof v === 'string' ? v : decodeBinary(v)]))
  const dirs = new Set([ROOT])
  const prefs = { ...(setup.prefs || {}) }
  const log = !!setup.log

  const norm = (p) => {
    const parts = []
    for (const part of String(p).split('/')) {
      if (!part || part === '.') continue
      if (part === '..') parts.pop()
      else parts.push(part)
    }
    return '/' + parts.join('/')
  }
  const parent = (p) => norm(p).split('/').slice(0, -1).join('/') || '/'
  const addDirs = (p) => {
    for (let d = parent(p); d !== '/' && !dirs.has(d); d = parent(d)) dirs.add(d)
  }
  for (const p of files.keys()) addDirs(p)

  // A path relative to a base directory (AppData, Document, …) lives under the root.
  const resolve = (path) => {
    const p = String(path ?? '')
    if (p.startsWith('/')) return norm(p)
    return norm(`${ROOT}/${p}`)
  }
  const fromHeaders = (opts) => resolve(decodeURIComponent(opts?.headers?.path || ''))
  const raw = (content) => (typeof content === 'string' ? new TextEncoder().encode(content) : content.data)
  const bytes = (content) => Array.from(raw(content))
  const decode = (data) => new TextDecoder().decode(data instanceof Uint8Array ? data : Uint8Array.from(data || []))
  const missing = (p) => { throw new Error(`No such file or directory (os error 2): ${p}`) }

  const children = (dir) => {
    const prefix = dir === '/' ? '/' : `${dir}/`
    const names = new Map()
    for (const p of files.keys()) if (p.startsWith(prefix) && !p.slice(prefix.length).includes('/')) names.set(p.slice(prefix.length), 'file')
    for (const p of dirs) if (p.startsWith(prefix) && p !== dir && !p.slice(prefix.length).includes('/')) names.set(p.slice(prefix.length), 'dir')
    return [...names].map(([name, kind]) => ({ name, isFile: kind === 'file', isDirectory: kind === 'dir', isSymlink: false }))
  }
  const stat = (p) => {
    const isFile = files.has(p)
    if (!isFile && !dirs.has(p)) missing(p)
    const t = Date.parse(setup.now || '2026-10-21T09:00:00Z')
    return { isFile, isDirectory: !isFile, isSymlink: false, size: isFile ? raw(files.get(p)).length : 0, mtime: t, atime: t, birthtime: t, readonly: false }
  }

  const fs = {
    exists: (a) => { const p = resolve(a.path, a.options); return files.has(p) || dirs.has(p) },
    read_dir: (a) => { const p = resolve(a.path, a.options); if (!dirs.has(p)) missing(p); return children(p) },
    read_text_file: (a) => { const p = resolve(a.path, a.options); if (!files.has(p)) missing(p); return bytes(files.get(p)) },
    read_file: (a) => { const p = resolve(a.path, a.options); if (!files.has(p)) missing(p); return bytes(files.get(p)) },
    write_text_file: (data, opts) => { const p = fromHeaders(opts); addDirs(p); files.set(p, decode(data)) },
    write_file: (data, opts) => { const p = fromHeaders(opts); addDirs(p); files.set(p, decode(data)) },
    mkdir: (a) => { const p = resolve(a.path, a.options); addDirs(`${p}/x`); dirs.add(p) },
    remove: (a) => {
      const p = resolve(a.path, a.options)
      files.delete(p); dirs.delete(p)
      for (const k of [...files.keys()]) if (k.startsWith(`${p}/`)) files.delete(k)
      for (const k of [...dirs]) if (k.startsWith(`${p}/`)) dirs.delete(k)
    },
    rename: (a) => {
      const from = resolve(a.oldPath)
      const to = resolve(a.newPath)
      addDirs(to)
      if (files.has(from)) { files.set(to, files.get(from)); files.delete(from) }
      for (const k of [...files.keys()]) if (k.startsWith(`${from}/`)) { files.set(to + k.slice(from.length), files.get(k)); files.delete(k) }
      for (const k of [...dirs]) if (k === from || k.startsWith(`${from}/`)) { dirs.delete(k); dirs.add(to + k.slice(from.length)) }
    },
    copy_file: (a) => { const from = resolve(a.fromPath, a.options); const to = resolve(a.toPath, a.options); addDirs(to); files.set(to, files.get(from) ?? '') },
    stat: (a) => stat(resolve(a.path, a.options)),
    lstat: (a) => stat(resolve(a.path, a.options)),
    size: (a) => stat(resolve(a.path, a.options)).size,
    watch: () => nextId++,
    unwatch: () => null,
  }

  const path = {
    resolve_directory: () => ROOT,
    resolve: (a) => norm((a.paths || []).join('/')),
    normalize: (a) => norm(a.path),
    join: (a) => norm((a.paths || []).join('/')),
    dirname: (a) => parent(a.path),
    basename: (a) => { const name = norm(a.path).split('/').pop(); return a.ext && name.endsWith(a.ext) ? name.slice(0, -a.ext.length) : name },
    extname: (a) => { const m = /\.([^./]+)$/.exec(a.path); return m ? m[1] : '' },
    is_absolute: (a) => String(a.path).startsWith('/'),
  }

  /**
   * The macOS traffic lights, drawn where the app puts them. In the shell AppKit draws
   * them, in the window's own top-left corner, beside the project title (there is no
   * title bar); here they are three dots on top of the page, placed from the same
   * window_traffic_lights call (src/lib/trafficLights.js: close button's left edge at
   * `x`, centred on `centerY`, 12px across, 20px apart), so captures show the window as
   * it is.
   */
  const LIGHTS = [['#ff5f57', '#e0443e'], ['#febc2e', '#dea123'], ['#28c840', '#1aab29']]
  const placeLights = ({ visible, x, centerY }) => {
    let box = document.getElementById('showcase-traffic-lights')
    if (!box) {
      box = document.createElement('div')
      box.id = 'showcase-traffic-lights'
      box.setAttribute('aria-hidden', 'true')
      box.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647'
      box.innerHTML = LIGHTS.map(([fill, edge]) => `<i style="position:absolute;width:12px;height:12px;border-radius:50%;box-sizing:border-box;background:${fill};border:0.5px solid ${edge}"></i>`).join('')
      document.documentElement.append(box)
    }
    box.style.display = visible ? '' : 'none'
    ;[...box.children].forEach((dot, i) => { dot.style.left = `${x + i * 20}px`; dot.style.top = `${centerY - 6}px` })
  }

  // The shell is a Mac window: the layout keeps clear of the lights only on a Mac
  // (trafficLightsBox), so captures made on Linux CI must look like one too.
  Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' })

  // preferences_load answers scope → { key: value }, as lib/preferences.ts reads it;
  // the scope of a key is the same rule as its scopeFor.
  const scopeFor = (key) => (key.startsWith('inkblot:pinterest-preview:') ? 'pinterest-cache'
    : key.startsWith('inkblot-order:') || key.startsWith('inkblot-expanded:') ? 'file-tree' : 'app')
  const scoped = (flat) => {
    const out = { app: {}, 'file-tree': {}, 'pinterest-cache': {} }
    for (const [key, value] of Object.entries(flat)) out[scopeFor(key)][key] = String(value)
    return out
  }

  // The shell draws context menus natively; here a shot picks an item by its label,
  // the way the shell answers a click: a message on the item's action channel.
  const menuItems = []
  window.__SHOWCASE_MENU__ = {
    labels: () => menuItems.map((item) => item.text),
    choose(text) {
      const item = [...menuItems].reverse().find((i) => i.text === text)
      if (!item || item.channel == null) throw new Error(`No menu item "${text}"`)
      window[`_${item.channel}`]({ index: 0, message: item.rid })
    },
  }

  let nextId = 1
  const answer = (cmd, args, opts) => {
    const [plugin, name] = cmd.startsWith('plugin:') ? cmd.slice(7).split('|') : [null, cmd]
    if (plugin === 'fs' && fs[name]) return fs[name](args, opts)
    if (plugin === 'path' && path[name]) return path[name](args)
    if (plugin === 'event') return nextId++
    if (plugin === 'menu') {
      if (name === 'items') return []
      const rid = nextId++
      // A native menu item: remembered with its action's channel, so a shot can choose it.
      if (name === 'new' && args?.options?.text) menuItems.push({ rid, text: args.options.text, channel: args.handler?.id })
      return [rid, 'x']
    }
    if (cmd === 'plugin:window|is_fullscreen') return false
    if (cmd === 'preferences_load') return scoped(prefs)
    if (cmd === 'preferences_set') { prefs[args?.key] = args?.value; return null }
    if (cmd === 'preferences_remove') { delete prefs[args?.key]; return null }
    if (cmd === 'window_traffic_lights') { placeLights(args); return null }
    // A shot's fixed answers for native commands (the language tools' models, …).
    if (setup.ipc && cmd in setup.ipc) return setup.ipc[cmd]
    if (cmd === 'list_system_fonts') return []
    if (cmd === 'project_locations' || cmd === 'project_locks') return null
    return null
  }

  window.__SHOWCASE_FS__ = { files, dirs }
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
  // The shell sets this (tauri.conf.json: withGlobalTauri); some tiles test for it.
  window.__TAURI__ = {}
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback: (cb) => { const n = nextId++; window[`_${n}`] = cb; return n },
    unregisterCallback: () => {},
    // The shell serves project files over its asset protocol; here a binary fixture is a blob URL.
    convertFileSrc: (p) => {
      const content = files.get(norm(p))
      if (!content || typeof content === 'string') return p
      content.url ??= URL.createObjectURL(new Blob([content.data], { type: content.type }))
      return content.url
    },
    invoke: async (cmd, args, opts) => {
      try {
        const result = answer(cmd, args, opts)
        if (log) console.log('[ipc]', cmd, JSON.stringify(args instanceof Uint8Array ? { bytes: args.length, ...opts?.headers } : args)?.slice(0, 200), '→', JSON.stringify(result)?.slice(0, 120))
        return result
      } catch (error) {
        if (log) console.log('[ipc]', cmd, JSON.stringify(args)?.slice(0, 200), '✗', error.message)
        throw error.message
      }
    },
  }
})()
