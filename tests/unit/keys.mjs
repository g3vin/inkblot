/**
 * Keyboard shortcuts (keybindings.ts) and Settings ▸ Shortcuts.
 *
 *   - the notation: a key event read by where the key is, on a Mac and elsewhere,
 *     and written back as the writer reads it;
 *   - the writer's changes: rebinding, removing and restoring, saved in the preferences;
 *   - conflicts with another command and with the app's own keys;
 *   - the one key handler: it runs the command bound to a keystroke when the command
 *     can run, leaves the keystroke alone otherwise, and stands down while paused;
 *   - the shortcuts page: recording a new shortcut, Escape keeping the old one, and the
 *     warning under a clash.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'
import { setInvokeHandler } from './stub-core.mjs'
import { ok } from './assert.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent', 'getComputedStyle'])
globalThis.IS_REACT_ACT_ENVIRONMENT = true

setInvokeHandler(async (command) => (command === 'preferences_load' ? { app: {} } : null))
const prefs = await import('../../src/lib/preferences.ts')
if (!prefs.isHydrated()) await prefs.hydratePreferences()

const K = await import('../../src/lib/keybindings.ts')
const C = await import('../../src/lib/commands.ts')

const key = (code, mods = {}) => new window.KeyboardEvent('keydown', { code, key: code.replace(/^Key/, '').toLowerCase(), bubbles: true, cancelable: true, ...mods })

/* ---------------- the notation ---------------- */

ok('⌘⇧N on a Mac', K.bindingFromEvent(key('KeyN', { metaKey: true, shiftKey: true }), true) === 'Mod+Shift+N')
ok('Ctrl+Shift+N elsewhere is the same binding', K.bindingFromEvent(key('KeyN', { ctrlKey: true, shiftKey: true }), false) === 'Mod+Shift+N')
ok('⌥ reads the key, not the ˜ it types', K.bindingFromEvent(new window.KeyboardEvent('keydown', { code: 'KeyN', key: '˜', metaKey: true, altKey: true }), true) === 'Mod+Alt+N')
ok('⌃ on a Mac is its own modifier', K.bindingFromEvent(new window.KeyboardEvent('keydown', { code: 'Tab', key: 'Tab', ctrlKey: true }), true) === 'Ctrl+Tab')
ok('the backslash', K.bindingFromEvent(new window.KeyboardEvent('keydown', { code: 'Backslash', key: '\\', metaKey: true }), true) === 'Mod+\\')
ok('a modifier alone is no binding', K.bindingFromEvent(new window.KeyboardEvent('keydown', { code: 'ShiftLeft', key: 'Shift', shiftKey: true }), true) === '')
ok('modifiers are put in order', K.normalizeBinding('Shift+Mod+n', true) === 'Mod+Shift+N')
ok('on a PC, Ctrl is Mod', K.normalizeBinding('Ctrl+Tab', false) === 'Mod+Tab')
ok('written as a Mac writes it', K.formatBinding('Mod+Alt+Shift+V', true) === '⌥⇧⌘V')
ok('and with ⌃ first', K.formatBinding('Ctrl+Shift+Tab', true) === '⌃⇧⇥')
ok('written as a PC writes it', K.formatBinding('Mod+Shift+N', false) === 'Ctrl+Shift+N')
ok('a plain letter cannot be bound', !K.isBindable('N') && !K.isBindable('Shift+N'))
ok('a function key can', K.isBindable('F5'))

/* ---------------- the writer's changes ---------------- */

let ran = []
let canRun = true
const unregister = C.registerCommands([
  { id: 'test.one', section: 'Test', title: 'Do one', keys: 'Mod+J', run: () => ran.push('one') },
  { id: 'test.two', section: 'Test', title: 'Do two', keys: 'Mod+Shift+J', when: () => canRun, run: () => ran.push('two') },
  { id: 'test.fixed', section: 'Test', title: 'Fixed thing', shortcut: '⌘;', run: () => ran.push('fixed') },
])

const one = C.listAllCommands().find((command) => command.id === 'test.one')
ok('a command starts on its default', K.bindingFor(one) === 'Mod+J')
K.setBinding('test.one', 'Mod+Alt+J')
ok('rebinding changes it', K.bindingFor(one) === 'Mod+Alt+J' && K.isRebound('test.one'))
ok('and is saved in the preferences', JSON.parse(prefs.getPreference(K.KEYBINDINGS_KEY))['test.one'] === 'Mod+Alt+J')
ok('the palette shows the new one', K.shortcutLabel(one) === K.formatBinding('Mod+Alt+J'))
K.setBinding('test.one', '')
ok('removing leaves it with none', K.bindingFor(one) === '' && K.shortcutLabel(one) === '')
K.resetBinding('test.one')
ok('restoring puts the default back', K.bindingFor(one) === 'Mod+J' && !K.isRebound('test.one'))
ok('a fixed shortcut is shown as it is', K.shortcutLabel(C.listAllCommands().find((c) => c.id === 'test.fixed')) === '⌘;')

/* ---------------- conflicts ---------------- */

K.setBinding('test.one', 'Mod+Shift+J')
const clash = K.conflictsFor('Mod+Shift+J', 'test.one')
ok('two commands on one key clash', clash.length === 1 && clash[0].command?.id === 'test.two')
const builtIn = K.conflictsFor('Mod+C', 'test.one')
ok('the app’s own keys clash too', builtIn.some((conflict) => conflict.kind === 'built-in' && conflict.title === 'Copy'))
ok('a free key does not', K.conflictsFor('Mod+Alt+Shift+Y', 'test.one').length === 0)
K.resetAllBindings()
ok('restoring every default clears every change', !K.isRebound('test.one') && prefs.getPreference(K.KEYBINDINGS_KEY) === '{}')

/* ---------------- the handler ---------------- */

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')

function Handler() {
  K.useKeybindings()
  return null
}
const root = createRoot(document.getElementById('root').appendChild(document.createElement('div')))
await act(async () => root.render(React.createElement(Handler)))

const mac = K.isMacPlatform()
const mod = mac ? { metaKey: true } : { ctrlKey: true }
const press = async (event) => { await act(async () => { window.dispatchEvent(event) }) ; return event }

ran = []
let event = await press(key('KeyJ', mod))
ok('a bound key runs its command', ran.join() === 'one')
ok('and the page does not see it', event.defaultPrevented)

canRun = false
event = await press(key('KeyJ', { ...mod, shiftKey: true }))
ok('a command that cannot run now is not run', ran.join() === 'one')
ok('and the key is left for the page', !event.defaultPrevented)
canRun = true

event = await press(key('KeyY', mod))
ok('an unbound key is left alone', !event.defaultPrevented)

K.pauseKeybindings(true)
await press(key('KeyJ', mod))
ok('paused, nothing runs', ran.join() === 'one')
K.pauseKeybindings(false)

K.setBinding('test.one', 'Mod+Alt+J')
ran = []
await press(key('KeyJ', mod))
await press(key('KeyJ', { ...mod, altKey: true }))
ok('a rebound command answers its new key, not its old one', ran.join() === 'one')
K.resetAllBindings()

/* ---------------- the shortcuts page ---------------- */

const { default: ShortcutsPane } = await import('../../src/components/settings/ShortcutsPane.jsx')
const pageHost = document.getElementById('root').appendChild(document.createElement('div'))
const pageRoot = createRoot(pageHost)
await act(async () => pageRoot.render(React.createElement(ShortcutsPane)))

const rowFor = (title) => [...pageHost.querySelectorAll('.settings-shortcut')].find((row) => row.querySelector('.settings-shortcut-title')?.textContent === title)
ok('every registered command is listed', Boolean(rowFor('Do one') && rowFor('Do two') && rowFor('Fixed thing')))
ok('the app’s own keys are listed', Boolean(rowFor('Copy')))
ok('a fixed shortcut cannot be changed', !rowFor('Fixed thing').querySelector('.settings-shortcut-keys'))

await act(async () => { rowFor('Do one').querySelector('.settings-shortcut-keys').click() })
ok('clicking a shortcut records the next one', rowFor('Do one').dataset.recording === 'true')
ran = []
await press(key('KeyJ', { ...mod, shiftKey: true }))
ok('the keys pressed become its shortcut', K.bindingFor(one) === 'Mod+Shift+J')
ok('without running whatever had them', ran.length === 0)
ok('and the clash is said under the row', rowFor('Do one').querySelector('.settings-shortcut-conflict')?.textContent.includes('Do two'))

await act(async () => { rowFor('Do one').querySelector('.settings-shortcut-keys').click() })
await press(new window.KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true, cancelable: true }))
ok('Escape keeps the shortcut it had', K.bindingFor(one) === 'Mod+Shift+J' && rowFor('Do one').dataset.recording === 'false')

await act(async () => { rowFor('Do one').querySelector('[aria-label="Use the default shortcut"]').click() })
ok('its reset button restores the default', K.bindingFor(one) === 'Mod+J')

await act(async () => pageRoot.unmount())
await act(async () => root.unmount())
unregister()
