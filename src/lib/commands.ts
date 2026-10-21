/**
 * commands.ts — every action a writer can take, in one searchable registry.
 *
 * The command palette (⌘K, src/ui/CommandPalette.jsx) lists what is registered here.
 * This is the backbone of progressive disclosure (docs/DESIGN.md): the visible chrome
 * shows only the essentials, and everything else is one search away. When you add a
 * feature, register its actions — a feature with no command is invisible to anyone who
 * doesn't already know where its button is.
 *
 * Register from wherever the action lives, for as long as it can run:
 *
 *   useCommands(() => [{
 *     id: 'notes.add', title: 'Add note', section: 'Notes', icon: 'note',
 *     keys: 'Mod+Alt+N', keywords: ['comment', 'annotate'], run: addNote,
 *   }], [addNote])
 *
 * `keys` is the command's default shortcut: the app's key handler runs it, and the
 * writer can change it in Settings ▸ Shortcuts (keybindings.ts).
 */
import { useEffect, useSyncExternalStore } from 'react'

export interface Command {
  /** Dotted and stable: 'section.action'. */
  id: string
  /** Sentence case, verb first: "Add note", "Switch to dark theme". */
  title: string
  /** Groups results: 'Document', 'Notes', 'View', 'Print & export'… */
  section: string
  /** Extra words people might search for. */
  keywords?: string[]
  /** An icon name from src/ui/icons.js. */
  icon?: string
  /**
   * The default shortcut, as `Mod+Shift+N` (keybindings.ts). The app's key handler
   * runs the command on it, and the writer can rebind it.
   */
  keys?: string
  /** Shown, not bound: for a shortcut bound wherever it lives, not rebindable. */
  shortcut?: string
  /** False hides the command (it cannot run right now). */
  when?: () => boolean
  run: () => void | Promise<void>
}

const registry = new Map<string, Command>()
const listeners = new Set<() => void>()
let snapshot: Command[] = []

const emit = () => {
  snapshot = [...registry.values()]
  listeners.forEach((listener) => listener())
}

/** Add commands; returns a function that removes exactly those. */
export function registerCommands(commands: Command[]): () => void {
  commands.forEach((command) => registry.set(command.id, command))
  emit()
  return () => {
    let changed = false
    commands.forEach((command) => {
      if (registry.get(command.id) === command) {
        registry.delete(command.id)
        changed = true
      }
    })
    if (changed) emit()
  }
}

export const listCommands = (): Command[] => snapshot.filter((command) => command.when?.() ?? true)

/** Every registered command, including those that cannot run right now. */
export const listAllCommands = (): Command[] => snapshot

/** Every registered command, re-rendering when commands come and go. */
export function useAllCommands(): Command[] {
  return useSyncExternalStore(subscribeCommands, () => snapshot, () => snapshot)
}

export function subscribeCommands(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function runCommand(id: string): Promise<boolean> {
  const command = registry.get(id)
  if (!command || command.when?.() === false) return false
  await command.run()
  return true
}

/** Register commands for the life of a component. */
export function useCommands(factory: () => Command[], deps: unknown[]): void {
  useEffect(() => registerCommands(factory()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller names the deps
    deps)
}

/** The live command list, re-rendering when commands come and go. */
export function useCommandList(): Command[] {
  const all = useSyncExternalStore(subscribeCommands, () => snapshot, () => snapshot)
  return all.filter((command) => command.when?.() ?? true)
}

/**
 * Fuzzy score of `query` against a command: consecutive and word-start matches score
 * higher; 0 means no match. Title matches outrank keyword and section matches.
 */
export function scoreCommand(command: Command, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1
  const fields: Array<[string, number]> = [
    [command.title.toLowerCase(), 3],
    [(command.keywords || []).join(' ').toLowerCase(), 1.5],
    [command.section.toLowerCase(), 1],
  ]
  let best = 0
  for (const [text, weight] of fields) {
    if (!text) continue
    if (text.includes(q)) {
      const atWordStart = text.startsWith(q) || text.includes(` ${q}`)
      best = Math.max(best, weight * (atWordStart ? 10 : 6))
      continue
    }
    let ti = 0
    let run = 0
    let score = 0
    for (const ch of q) {
      const found = text.indexOf(ch, ti)
      if (found < 0) { score = 0; break }
      run = found === ti ? run + 1 : 1
      score += run + (found === 0 || text[found - 1] === ' ' ? 2 : 0)
      ti = found + 1
    }
    best = Math.max(best, (score / q.length) * weight)
  }
  return best
}
