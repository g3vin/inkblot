/**
 * The Tauri shim the Swift shell injects (native/…/Web/tauri-shim.js).
 *
 * Under the Swift shell the web bundle is unmodified and still calls Tauri — for every
 * document save, every delete confirmation, every context menu. The shim is what
 * answers, and nothing in the build can see it: it is a string Swift injects into a
 * page. If it gets a wire format wrong, the symptom is a menu item that does nothing,
 * or a document that saves as garbage.
 *
 * So the menu and event halves are driven here through the **real** `@tauri-apps/api`
 * modules (imported by path, which is what keeps loader.mjs from stubbing them), and the
 * filesystem half through the exact argument shapes `@tauri-apps/plugin-fs` sends,
 * transcribed from its dist. What Swift receives is recorded and checked too, since
 * that is the other half of the contract.
 */
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'

const ok = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) process.exitCode = 1 }

const SHIM = new URL('../../native/inkblot-core/inkblot-core/Web/tauri-shim.js', import.meta.url)
const HOST = new URL('../../native/inkblot-core/inkblot-core/Web/native-host.js', import.meta.url)
const API = new URL('../../node_modules/@tauri-apps/api/', import.meta.url)

const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' })
const win = dom.window

/* Swift, as far as the shim can tell: a handler whose postMessage returns a promise
   of a JSON string. Every request is kept so what crossed can be asserted on. */
const received = []
const files = new Map()
let nextPopupChoice = null
const openWindows = new Set()

const reply = (value) => JSON.stringify({ ok: true, value })
const fail = (error) => JSON.stringify({ ok: false, error })

win.webkit = {
  messageHandlers: {
    tauri: {
      postMessage: async (json) => {
        const request = JSON.parse(json)
        received.push(request)
        const { cmd, args, bytes, headers } = request
        switch (cmd) {
          case 'plugin:fs|write_text_file':
          case 'plugin:fs|write_file':
            files.set(decodeURIComponent(headers.path), bytes)
            return reply(null)
          case 'plugin:fs|read_text_file':
          case 'plugin:fs|read_file':
            return files.has(args.path)
              ? JSON.stringify({ ok: true, bytes: files.get(args.path) })
              : fail(`No such file: ${args.path}`)
          case 'plugin:fs|exists':
            return reply(files.has(args.path))
          case 'menu.popup':
            return reply(nextPopupChoice)
          case 'menu.setApp':
            return reply(null)
          case 'window.create':
            if (openWindows.has(args.options.label)) return fail(`a window with label \`${args.options.label}\` already exists`)
            openWindows.add(args.options.label)
            return reply(null)
          case 'window.list':
            return reply(['main', ...openWindows])
          case 'window.op':
            return reply(null)
          default:
            return fail(`${cmd} is not available`)
        }
      },
    },
  },
}

win.eval(readFileSync(SHIM, 'utf8'))
installGlobals(win, ['window'])

const { invoke } = await import(new URL('core.js', API).href)
const { Menu, MenuItem, CheckMenuItem, PredefinedMenuItem, Submenu } = await import(new URL('menu.js', API).href)
const { listen, emit } = await import(new URL('event.js', API).href)

ok('the shim installs __TAURI_INTERNALS__', typeof win.__TAURI_INTERNALS__?.invoke === 'function')

/* ---------------- the filesystem: bytes survive the trip ---------------- */
{
  // Exactly what plugin-fs's writeTextFile sends: the encoded text *as* the argument,
  // with the path in a header, URI-encoded.
  const text = 'she hesitated — “at the door” 🚪'
  const path = '/Users/me/Novel/chapter one.json'
  await invoke('plugin:fs|write_text_file', new TextEncoder().encode(text), {
    headers: { path: encodeURIComponent(path), options: JSON.stringify({}) },
  })
  const write = received.at(-1)
  ok('a write reaches Swift as base64 bytes, not as a JSON array of numbers',
    typeof write.bytes === 'string' && Object.keys(write.args).length === 0)
  ok('with the path header intact', decodeURIComponent(write.headers.path) === path)

  // And what plugin-fs's readTextFile does with the answer.
  const arr = await invoke('plugin:fs|read_text_file', { path, options: undefined })
  // `new Uint8Array` rather than plugin-fs's `instanceof` test: the buffer was made in
  // jsdom's realm, and this assertion runs in Node's.
  const bytes = new Uint8Array(arr)
  ok('a read comes back as an ArrayBuffer plugin-fs can decode',
    arr instanceof win.ArrayBuffer || arr instanceof ArrayBuffer)
  ok('and decodes to the same text, multi-byte characters included',
    new TextDecoder().decode(bytes) === text)

  ok('a plain value comes back as itself', (await invoke('plugin:fs|exists', { path })) === true)

  let rejection = null
  try {
    await invoke('plugin:fs|read_text_file', { path: '/nope' })
  } catch (error) { rejection = error }
  ok('a failure rejects with the message as a string, the way Tauri does',
    typeof rejection === 'string' && rejection.includes('/nope'))

  let unknown = null
  try { await invoke('kokoro_vocab') } catch (error) { unknown = error }
  ok('a command Swift does not have rejects rather than hanging', typeof unknown === 'string')
}

/* ---------------- events stay on this side ---------------- */
{
  const before = received.length
  const heard = []
  const unlisten = await listen('dictation://partial', (event) => heard.push(event))
  win.__inkblotTauri.emit('dictation://partial', { text: 'hello' })
  await emit('dictation://partial', { text: 'again' })
  unlisten()
  win.__inkblotTauri.emit('dictation://partial', { text: 'after' })

  ok('Swift can emit an event the bundle listens for',
    heard.length === 2 && heard[0].payload.text === 'hello' && heard[0].event === 'dictation://partial')
  ok('an unlisten sticks', !heard.some((event) => event.payload.text === 'after'))
  ok('and none of it crossed to Swift', received.length === before)
}

/* ---------------- other windows: docWindow.js and the Pinterest windows ---------------- */
{
  const { WebviewWindow } = await import(new URL('webviewWindow.js', API).href)
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  const created = []
  const board = new WebviewWindow('pinterest', { url: 'https://www.pinterest.com/', width: 600, visible: false })
  board.once('tauri://created', () => created.push('pinterest'))
  await settle()
  const create = received.findLast((request) => request.cmd === 'window.create')
  ok('new WebviewWindow asks Swift to create it, with its label and options',
    create?.args.options.label === 'pinterest' && create.args.options.url === 'https://www.pinterest.com/'
      && create.args.options.visible === false)
  ok('and hears that it was created', created.length === 1)

  let refused = null
  const again = new WebviewWindow('pinterest', { url: 'https://www.pinterest.com/' })
  again.once('tauri://error', (event) => { refused = event.payload })
  await settle()
  ok('a label already in use is refused, as Tauri refuses it', String(refused).includes('already exists'))

  ok('getByLabel finds it through Swift', (await WebviewWindow.getByLabel('pinterest'))?.label === 'pinterest')
  ok('and not a window that is not open', (await WebviewWindow.getByLabel('nope')) === null)

  await board.hide()
  await board.setAlwaysOnTop(true)
  const ops = received.filter((request) => request.cmd === 'window.op').slice(-2)
  ok('window verbs cross by label', ops[0]?.args.label === 'pinterest' && ops[0].args.op === 'hide')
  ok('with their value', ops[1]?.args.op === 'set_always_on_top' && ops[1].args.value === true)

  // Two windows' `destroyed` handlers: only the one that closed may hear it.
  const detached = new WebviewWindow('doc-Novel-one', { url: 'index.html?project=Novel&doc=one' })
  await settle()
  const destroyed = []
  await board.once('tauri://destroyed', () => destroyed.push('pinterest'))
  await detached.once('tauri://destroyed', () => destroyed.push('doc'))
  const anyWindow = []
  await listen('tauri://destroyed', () => anyWindow.push(true))
  win.__inkblotTauri.emit('tauri://destroyed', null, 'pinterest')
  ok('an event about one window reaches that window\'s listener only',
    destroyed.length === 1 && destroyed[0] === 'pinterest')
  ok('and the listeners for any window', anyWindow.length === 1)
}

/* ---------------- a context menu, the way the bundle builds one ---------------- */
{
  const chosen = []
  const copy = await MenuItem.new({ id: 'copy', text: 'Copy', action: (id) => chosen.push(id) })
  const del = await MenuItem.new({ text: 'Delete…', enabled: false, action: () => chosen.push('delete') })
  const separator = await PredefinedMenuItem.new({ item: 'Separator' })
  const sub = await Submenu.new({
    text: 'Highlight',
    items: [{ id: 'yellow', text: 'Yellow', action: (id) => chosen.push(id) }],
  })
  const menu = await Menu.new({ items: [copy, separator, del, sub] })

  ok('an item reports the text it was made with', (await copy.text()) === 'Copy')
  ok('menu.items() hands back the right classes',
    (await menu.items()).map((item) => item.constructor.name).join() ===
      'MenuItem,PredefinedMenuItem,MenuItem,Submenu')

  const before = received.length
  // The user picks "Yellow", inside the submenu Swift was shown.
  nextPopupChoice = null
  await menu.popup()
  const shown = received.at(-1).args.menu
  ok('building a menu costs no round trips; showing it costs one', received.length === before + 1)
  ok('Swift is shown the whole tree, disabled item and separator included',
    shown.items.length === 4 &&
    shown.items[1].predefined === 'Separator' &&
    shown.items[2].enabled === false &&
    shown.items[3].items[0].text === 'Yellow')

  nextPopupChoice = shown.items[3].items[0].rid
  await menu.popup()
  ok('choosing an inline submenu item runs its action with its id', chosen.join() === 'yellow')

  nextPopupChoice = shown.items[0].rid
  await menu.popup()
  nextPopupChoice = shown.items[0].rid
  await menu.popup()
  ok('the same item can be chosen twice — the channel index keeps counting',
    chosen.join() === 'yellow,copy,copy')

  nextPopupChoice = null
  await menu.popup()
  ok('dismissing the menu runs nothing', chosen.length === 3)
}

/* ---------------- the app menu, the way App.jsx builds it ---------------- */
{
  let themeRuns = 0
  const menu = await Menu.default()
  const toggle = await MenuItem.new({ id: 'theme-toggle', text: 'Switch to Dark', action: () => { themeRuns += 1 } })
  const system = await CheckMenuItem.new({ id: 'theme-system', text: 'System', checked: true, action: () => {} })
  const view = await Submenu.new({ text: 'View', items: [toggle, system] })
  await menu.append(view)
  await menu.setAsAppMenu()

  const published = received.filter((request) => request.cmd === 'menu.setApp')
  ok('setAsAppMenu publishes the menu to Swift',
    published.at(-1)?.args.menu.items[0].text === 'View')

  const countBefore = published.length
  await toggle.setText('Switch to Light')
  const latest = received.filter((request) => request.cmd === 'menu.setApp')
  ok('relabelling an app-menu item republishes it',
    latest.length === countBefore + 1 &&
    latest.at(-1).args.menu.items[0].items[0].text === 'Switch to Light')

  win.__inkblotTauri.activateMenuItem(latest.at(-1).args.menu.items[0].items[0].rid)
  ok('a click in the menu bar runs the item', themeRuns === 1)

  win.__inkblotTauri.activateMenuItem(latest.at(-1).args.menu.items[0].items[1].rid)
  ok('a check item flips before its action runs, as Tauri does', (await system.isChecked()) === false)
}

/* ---------------- the bridge's half of the page ---------------- */
{
  const page = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' })
  const posted = []
  page.window.webkit = { messageHandlers: { inkblotBridge: { postMessage: (json) => posted.push(json) } } }
  page.window.eval('window.__inkblotNativeChrome = ["fileTree"]')
  page.window.eval(readFileSync(HOST, 'utf8'))
  const host = page.window.__inkblotNative

  host.deliver('{"early":1}')
  const heard = []
  host.listen((json) => heard.push(json))
  host.deliver('{"late":2}')
  host.post('{"out":3}')

  ok('native-host.js keeps what Swift delivered before anyone listened',
    heard.join() === '{"early":1},{"late":2}')
  ok('and posts to the bridge handler', posted.join() === '{"out":3}')
  ok('and says which chrome the shell owns', host.chrome.includes('fileTree'))
}
