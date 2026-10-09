/**
 * keybindings.ts — the keyboard shortcuts, and the one key handler that runs them.
 *
 * A shortcut belongs to a command (commands.ts): a command's `keys` is its default
 * binding, and the writer may change it in Settings ▸ Shortcuts. So the command
 * palette and the shortcuts page show one list, and a rebound key is what the palette
 * shows too. The writer's changes are saved in the preferences (`inkblot-keybindings`):
 * a binding per command id, or '' for one taken away.
 *
 * A binding is written `Mod+Shift+N`: modifiers first (`Mod` is ⌘ on a Mac and Ctrl
 * elsewhere, `Ctrl` the Control key itself, then `Alt` and `Shift`), then the key by
 * its place on the keyboard (`event.code`), so ⌥N is still N though the Mac types ˜.
 *
 * `useKeybindings`, mounted once by the app, listens before anything else does and
 * runs the command bound to a keystroke, when the command can run. A keystroke bound
 * to nothing, or to a command that cannot run now, is left alone for the page.
 *
 * A few keys are the app's own and cannot be bound here (`BUILT_IN`): the palette, the
 * editor's formatting, the clipboard, the window. Binding one of them is allowed, with
 * a warning, as is binding one key to two commands.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { getPreference, isHydrated, setPreference } from './preferences'
import { listAllCommands, runCommand, type Command } from './commands'

export const KEYBINDINGS_KEY = 'inkblot-keybindings'

const MODIFIERS = ['Mod', 'Ctrl', 'Alt', 'Shift'] as const

export const isMacPlatform = (): boolean =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')

/** The shortcuts that are the app's or the system's, shown on the page but not rebindable. */
export const BUILT_IN: Array<{ keys: string; title: string }> = [
  { keys: 'Mod+K', title: 'Open the command palette' },
  { keys: 'Mod+C', title: 'Copy' },
  { keys: 'Mod+X', title: 'Cut' },
  { keys: 'Mod+V', title: 'Paste' },
  { keys: 'Mod+Alt+Shift+V', title: 'Paste and match style' },
  { keys: 'Mod+Z', title: 'Undo' },
  { keys: 'Mod+Shift+Z', title: 'Redo' },
  { keys: 'Mod+A', title: 'Select all' },
  { keys: 'Mod+B', title: 'Bold' },
  { keys: 'Mod+I', title: 'Italic' },
  { keys: 'Mod+U', title: 'Underline' },
  { keys: 'Mod+S', title: 'Pin or unpin the sidebar under the pointer' },
  { keys: 'Mod+Alt+F', title: 'Insert footnote' },
  { keys: 'Mod+Alt+R', title: 'Add reference' },
  { keys: 'Mod+Alt+K', title: 'Insert citation' },
  { keys: 'Mod+Shift+E', title: 'Export again' },
  { keys: 'Mod+H', title: 'Hide Inkblot' },
  { keys: 'Mod+M', title: 'Minimise the window' },
  { keys: 'Mod+Q', title: 'Quit Inkblot' },
]

/* ---------------- the notation ---------------- */

const CODE_KEYS: Record<string, string> = {
  Backslash: '\\', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
  BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`',
  IntlBackslash: '\\',
}

/** The key part of a binding for a key event, by where the key is rather than what it types. */
function keyOf(event: KeyboardEvent): string | null {
  const { code, key } = event
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6)
  if (CODE_KEYS[code]) return CODE_KEYS[code]
  if (['Shift', 'Meta', 'Control', 'Alt', 'CapsLock', 'Fn', 'OS'].includes(key)) return null
  if (key === ' ') return 'Space'
  if (key && key.length === 1) return key.toUpperCase()
  return key || null
}

/** Put a binding's modifiers in order; on a PC, Ctrl and Mod are one key. */
export function normalizeBinding(binding: string | null | undefined, mac = isMacPlatform()): string {
  if (!binding) return ''
  const parts = binding.split('+')
  // `+` itself, written as the last part: 'Mod++'.
  const key = binding.endsWith('++') ? '+' : parts[parts.length - 1]
  const held = new Set(parts.slice(0, binding.endsWith('++') ? -2 : -1))
  if (!mac && held.has('Ctrl')) {
    held.delete('Ctrl')
    held.add('Mod')
  }
  const mods = MODIFIERS.filter((mod) => held.has(mod))
  return [...mods, key.length === 1 ? key.toUpperCase() : key].join('+')
}

/** The binding a key event makes, or '' for a key that is only a modifier. */
export function bindingFromEvent(event: KeyboardEvent, mac = isMacPlatform()): string {
  const key = keyOf(event)
  if (!key) return ''
  const held: string[] = []
  if (mac ? event.metaKey : event.ctrlKey) held.push('Mod')
  if (mac && event.ctrlKey) held.push('Ctrl')
  if (event.altKey) held.push('Alt')
  if (event.shiftKey) held.push('Shift')
  return normalizeBinding([...held, key].join('+'), mac)
}

/** Whether a binding is one a writer could press without meaning to type. */
export function isBindable(binding: string): boolean {
  if (!binding) return false
  const parts = binding.split('+')
  const key = parts[parts.length - 1]
  const mods = parts.slice(0, -1)
  if (/^F\d{1,2}$/.test(key)) return true
  // Shift alone only changes what a key types.
  return mods.some((mod) => mod !== 'Shift')
}

const MAC_SYMBOLS: Record<string, string> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Mod: '⌘' }
const KEY_NAMES: Record<string, string> = {
  Tab: '⇥', Enter: '↩', Escape: 'Esc', Backspace: '⌫', Delete: '⌦', Space: 'Space',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
}

/** A binding as a writer reads it: ⇧⌘N on a Mac, Ctrl+Shift+N elsewhere. */
export function formatBinding(binding: string | null | undefined, mac = isMacPlatform()): string {
  const normal = normalizeBinding(binding, mac)
  if (!normal) return ''
  const parts = normal.split('+')
  const key = normal.endsWith('++') ? '+' : parts[parts.length - 1]
  const mods = parts.slice(0, normal.endsWith('++') ? -2 : -1)
  const keyName = KEY_NAMES[key] ?? key
  if (!mac) return [...mods.map((mod) => (mod === 'Mod' ? 'Ctrl' : mod)), keyName].join('+')
  // A Mac writes them ⌃⌥⇧⌘, in that order.
  const order = ['Ctrl', 'Alt', 'Shift', 'Mod']
  return order.filter((mod) => mods.includes(mod)).map((mod) => MAC_SYMBOLS[mod]).join('') + keyName
}

/* ---------------- the writer's changes ---------------- */

type Overrides = Record<string, string>

let overrides: Overrides | null = null
const listeners = new Set<() => void>()

const NONE: Overrides = {}

function readOverrides(): Overrides {
  if (overrides) return overrides
  // Not kept until the preferences are read, or it would stay empty.
  if (!isHydrated()) return NONE
  try {
    const parsed = JSON.parse(getPreference(KEYBINDINGS_KEY) || '{}')
    overrides = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    overrides = {}
  }
  return overrides as Overrides
}

function writeOverrides(next: Overrides) {
  overrides = next
  setPreference(KEYBINDINGS_KEY, JSON.stringify(next))
  listeners.forEach((listener) => listener())
}

export function subscribeKeybindings(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The writer's changes, re-rendering when they change. */
export function useKeybindingOverrides(): Overrides {
  return useSyncExternalStore(subscribeKeybindings, readOverrides, readOverrides)
}

/** What a command is bound to now: the writer's choice, or its default. */
export function bindingFor(command: Pick<Command, 'id' | 'keys'>, from: Overrides = readOverrides()): string {
  const chosen = Object.prototype.hasOwnProperty.call(from, command.id) ? from[command.id] : command.keys
  return normalizeBinding(chosen)
}

/** Whether the writer has changed a command's binding. */
export const isRebound = (id: string, from: Overrides = readOverrides()) => Object.prototype.hasOwnProperty.call(from, id)

/** Bind a command to `binding`; '' takes its shortcut away. */
export function setBinding(id: string, binding: string) {
  writeOverrides({ ...readOverrides(), [id]: normalizeBinding(binding) })
}

/** Put a command back on its default binding. */
export function resetBinding(id: string) {
  const { [id]: _dropped, ...rest } = readOverrides()
  writeOverrides(rest)
}

export function resetAllBindings() {
  writeOverrides({})
}

/** What the palette shows for a command: its binding, or the shortcut it is bound to elsewhere. */
export function shortcutLabel(command: Command, from: Overrides = readOverrides()): string {
  if (command.keys !== undefined || isRebound(command.id, from)) return formatBinding(bindingFor(command, from))
  return command.shortcut ?? ''
}

/* ---------------- conflicts ---------------- */

export type Conflict = { kind: 'command'; command: Command } | { kind: 'built-in'; title: string }

/** Everything else `binding` already does: other commands bound to it, and the app's own keys. */
export function conflictsFor(
  binding: string,
  exceptId: string | null,
  commands: Command[] = listAllCommands(),
  from: Overrides = readOverrides(),
): Conflict[] {
  const normal = normalizeBinding(binding)
  if (!normal) return []
  const found: Conflict[] = []
  for (const command of commands) {
    if (command.id !== exceptId && bindingFor(command, from) === normal) found.push({ kind: 'command', command })
  }
  for (const builtIn of BUILT_IN) {
    if (normalizeBinding(builtIn.keys) === normal) found.push({ kind: 'built-in', title: builtIn.title })
  }
  return found
}

/* ---------------- the handler ---------------- */

let paused = false

/** Stop answering keys for a while: the shortcuts page does, while it records one. */
export function pauseKeybindings(on: boolean) {
  paused = on
}

/**
 * The command a keystroke runs, if any: the first bound to it that can run now. A
 * binding shared by two commands goes to whichever is available.
 */
export function commandForEvent(event: KeyboardEvent, commands: Command[] = listAllCommands()): Command | null {
  const binding = bindingFromEvent(event)
  if (!isBindable(binding)) return null
  const from = readOverrides()
  return commands.find((command) => bindingFor(command, from) === binding && (command.when?.() ?? true)) ?? null
}

/** Answer the bound keys for as long as the calling component is mounted. Mount it once. */
export function useKeybindings(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (paused || event.isComposing || event.defaultPrevented) return
      const command = commandForEvent(event)
      if (!command) return
      event.preventDefault()
      event.stopPropagation()
      void runCommand(command.id)
    }
    // Capture, so a bound key reaches its command before an editor or a field acts on it.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
}
