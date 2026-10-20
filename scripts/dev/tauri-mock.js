/**
 * tauri-mock.js — a stand-in for the Tauri bridge, injected into a plain browser page so
 * the app renders outside the desktop shell (for headless screenshots; see
 * scripts/dev/screenshot.mjs and scripts/dev/capture.mjs).
 *
 * It keeps a small in-memory projects folder at /mock holding "Novel" (two chapters, one
 * note) and "Short stories". Writes land in it, so creating a canvas, map or timeline
 * works, and it is mirrored to sessionStorage so a reload keeps it. Preferences are kept
 * the same way. Native menus can't be drawn in a browser: each one that pops up is
 * recorded, resolved to its items, on `window.__ibMenus`, and `window.__ibMenuClick(text)`
 * runs the item of the last one with that text ('More › Rename…' reaches into a
 * submenu), or else any item with that text, such as one in the app's menu bar. Every other command answers null.
 */
(() => {
  let id = 1
  const KEY = '__ibMockState'
  const paragraph = (i) => ({ type: 'paragraph', content: [{ type: 'text', text: `It was a bright cold day in April, and the clocks were striking thirteen. Winston Smith, his chin nuzzled into his breast in an effort to escape the vile wind, slipped quickly through the glass doors of Victory Mansions. ${i}` }] })
  const doc = JSON.stringify({
    content: { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Chapter One' }] }, ...Array.from({ length: 8 }, (_, i) => paragraph(i + 1))] },
    notes: [
      { id: 'n1', type: 'quote', from: 20, to: 40, anchor: 'bright cold day', content: 'Is this too on the nose?', color: '#ffd54f' },
      { id: 'n2', type: 'free', content: 'Keep the weather motif.', color: 'teal' },
    ],
  })
  const seed = () => ({
    files: { '/mock/Novel/Chapter one.json': doc, '/mock/Novel/Chapter two.json': doc },
    dirs: ['/mock', '/mock/Novel', '/mock/Short stories'],
    prefs: {},
  })
  const load = () => {
    try { const saved = JSON.parse(sessionStorage.getItem(KEY)); if (saved?.files) return saved } catch { /* fresh */ }
    return seed()
  }
  const state = load()
  // A capture can add files and preferences before the app starts (capture.mjs `seed`).
  if (window.__ibMockSeed && !state.seeded) {
    Object.assign(state.files, window.__ibMockSeed.files || {})
    for (const dir of window.__ibMockSeed.dirs || []) if (!state.dirs.includes(dir)) state.dirs.push(dir)
    for (const [scope, values] of Object.entries(window.__ibMockSeed.prefs || {})) state.prefs[scope] = { ...state.prefs[scope], ...values }
    state.seeded = true
  }
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(state)) } catch { /* in memory only */ } }
  save()

  const norm = (p) => String(p ?? '').replace(/^file:\/\//, '').replace(/\/+$/, '') || '/'
  const parent = (p) => p.slice(0, p.lastIndexOf('/')) || '/'
  const addDir = (p) => { for (let d = p; d !== '/' && !state.dirs.includes(d); d = parent(d)) state.dirs.push(d) }
  const isDir = (p) => state.dirs.includes(p)
  const isFile = (p) => p in state.files
  const under = (p, root) => p === root || p.startsWith(`${root}/`)
  const entry = (name, dir) => ({ name, isFile: !dir, isDirectory: dir, isSymlink: false })
  const info = (p) => ({ isFile: isFile(p), isDirectory: isDir(p), isSymlink: false, size: (state.files[p] || '').length, mtime: 1760000000000, atime: null, birthtime: 1760000000000, readonly: false })
  const bytes = (text) => Array.from(new TextEncoder().encode(text))
  const text = (data) => (typeof data === 'string' ? data : new TextDecoder().decode(data instanceof Uint8Array ? data : new Uint8Array(data || [])))

  const fs = (op, args, options) => {
    const path = norm(args?.path ?? (options?.headers?.path ? decodeURIComponent(options.headers.path) : ''))
    switch (op) {
      case 'exists': return isFile(path) || isDir(path)
      case 'stat': case 'lstat':
        if (!isFile(path) && !isDir(path)) throw new Error(`No such file or directory: ${path}`)
        return info(path)
      case 'read_dir': {
        const names = new Map()
        for (const d of state.dirs) if (parent(d) === path && d !== path) names.set(d.slice(path.length + 1), true)
        for (const f of Object.keys(state.files)) if (parent(f) === path) names.set(f.slice(path.length + 1), false)
        return [...names].map(([name, dir]) => entry(name, dir))
      }
      case 'read_text_file': case 'read_file':
        if (!isFile(path)) throw new Error(`No such file: ${path}`)
        return bytes(state.files[path])
      case 'write_text_file': case 'write_file':
        addDir(parent(path)); state.files[path] = text(args); save(); return null
      case 'mkdir': addDir(path); save(); return null
      case 'remove':
        for (const f of Object.keys(state.files)) if (under(f, path)) delete state.files[f]
        state.dirs = state.dirs.filter((d) => !under(d, path)); save(); return null
      case 'rename': case 'copy_file': {
        const from = norm(args.oldPath ?? args.fromPath)
        const to = norm(args.newPath ?? args.toPath)
        for (const f of Object.keys(state.files)) {
          if (!under(f, from)) continue
          state.files[to + f.slice(from.length)] = state.files[f]
          if (op === 'rename') delete state.files[f]
        }
        for (const d of [...state.dirs]) if (under(d, from)) addDir(to + d.slice(from.length))
        if (op === 'rename') state.dirs = state.dirs.filter((d) => !under(d, from))
        addDir(parent(to)); save(); return null
      }
      default: return null
    }
  }

  // Native menus: remember each item by rid, and resolve the tree when one pops up.
  const menuItems = new Map()
  const actions = new Map()
  window.__ibMenus = []
  const resolveMenu = (rid) => {
    const node = menuItems.get(rid)
    if (!node) return null
    const { kind, options = {} } = node
    if (kind === 'Predefined' || kind === 'PredefinedMenuItem') {
      const item = options.item
      return item === 'Separator' ? { separator: true } : { predefined: typeof item === 'string' ? item : Object.keys(item || {})[0] }
    }
    const out = { text: options.text, rid }
    if (typeof options.checked === 'boolean') out.checked = options.checked
    if (options.enabled === false) out.enabled = false
    if (options.accelerator) out.accelerator = options.accelerator
    if (options.items) out.items = options.items.map((i) => (Array.isArray(i) ? resolveMenu(i[0]) : { text: i.text })).filter(Boolean)
    return out
  }

  window.__ibMenuClick = (path) => {
    let items = window.__ibMenus.at(-1)?.items || []
    let found = null
    for (const text of String(path).split(' › ')) {
      found = items.find((item) => item.text === text)
      items = found?.items || []
    }
    // Not in the last pop-up: any item with that text, such as one in the app's menu bar.
    let rid = found?.rid
    if (!actions.has(rid)) rid = [...menuItems].reverse().find(([key, node]) => node.options?.text === path && actions.has(key))?.[0]
    if (!actions.has(rid)) throw new Error(`No menu item "${path}"`)
    actions.get(rid)(`m${rid}`)
  }

  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback: (cb) => { const n = id++; window[`_${n}`] = cb; return n },
    unregisterCallback: () => {},
    convertFileSrc: (path) => path,
    invoke: async (cmd, args, options) => {
      if (cmd.startsWith('plugin:fs|')) return fs(cmd.slice(10), args, options)
      if (cmd.startsWith('plugin:path')) return '/mock'
      if (cmd === 'preferences_load') return state.prefs
      if (cmd === 'preferences_set') { state.prefs[args.scope] = { ...state.prefs[args.scope], [args.key]: args.value }; save(); return null }
      if (cmd === 'preferences_remove') { delete state.prefs[args.scope]?.[args.key]; save(); return null }
      if (cmd === 'plugin:app|version') return '0.1.0'
      if (cmd.includes('list_system_fonts')) return []
      if (cmd.startsWith('plugin:event')) return id++
      if (cmd === 'plugin:menu|new') {
        const rid = id++
        menuItems.set(rid, { kind: args.kind, options: args.options })
        if (args.handler?.onmessage) actions.set(rid, args.handler.onmessage)
        return [rid, `m${rid}`]
      }
      if (cmd === 'plugin:menu|popup') { window.__ibMenus.push(resolveMenu(args.rid)); return null }
      if (cmd === 'plugin:menu|items') return []
      if (cmd.startsWith('plugin:menu')) return [id++, 'x']
      if (cmd.startsWith('plugin:window|is_fullscreen')) return false
      return null
    },
  }
})()
