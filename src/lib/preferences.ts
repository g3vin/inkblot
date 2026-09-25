/**
 * preferences.ts — the app's settings, stored on disk under AppData.
 *
 * Not `localStorage`: a `WKWebView` in a Swift app gets its own store, per origin,
 * that no native code can read — so a theme chosen in the webview would be invisible
 * to native chrome, and vice versa. On disk, through `inkblot_core::store::preferences`,
 * both shells read the same values. Never use `localStorage` for app state.
 *
 * **The API is synchronous.** Every call site reads during render — a `useState`
 * initializer, a node view's constructor — and none of them can await. So the whole
 * store is hydrated once, before React mounts (see `main.jsx`), and reads answer from
 * that cache. Writes update the cache immediately and reach disk on their own time.
 *
 * A write that fails is logged and dropped — losing a remembered accent colour must
 * not take the app down.
 *
 * ## Scopes
 *
 * Three files rather than one, so that a huge or corrupt Pinterest cache cannot take
 * the theme with it, and so the file read at every launch stays small. A key is routed
 * to its scope by prefix; see `scopeFor`.
 *
 * ## Session values stay in memory
 *
 * `inkblot:project-open-id` and the per-project Pinterest refresh flag describe one app
 * launch. On disk they would outlive the thing they describe (a stale "already
 * refreshed" flag is a board that never refreshes again), so they are an in-memory Map
 * here (`getSessionValue` / `setSessionValue`).
 */
import { invoke } from '@tauri-apps/api/core'

/**
 * The three files. These strings are the wire format: `preferences_set` and its
 * neighbours parse them back into `inkblot_core`'s `PreferenceScope`, so a value
 * added here has to exist there too.
 */
export type PreferenceScope = 'app' | 'file-tree' | 'pinterest-cache'

const SCOPES: PreferenceScope[] = ['app', 'file-tree', 'pinterest-cache']

/** What `preferences_load` answers with: every scope's whole map, in one call. */
type PreferenceSnapshot = Partial<Record<PreferenceScope, Record<string, string>>>

/** Key prefix → scope. Anything unmatched is an ordinary app preference. */
const scopeFor = (key: string): PreferenceScope => {
  if (key.startsWith('inkblot:pinterest-preview:')) return 'pinterest-cache'
  if (key.startsWith('inkblot-order:') || key.startsWith('inkblot-expanded:')) return 'file-tree'
  return 'app'
}

/** scope → { key: value }. Populated by `hydratePreferences`. */
const cache = new Map<PreferenceScope, Map<string, string>>(
  SCOPES.map((scope) => [scope, new Map()])
)

let hydrated = false

/**
 * Read the whole store into memory. Call once, before anything renders.
 *
 * Failure is survivable: every caller defaults when a key is absent, so an app that
 * cannot read its preferences starts with the defaults rather than not starting.
 */
export async function hydratePreferences(): Promise<void> {
  try {
    const loaded = await invoke<PreferenceSnapshot | null>('preferences_load')
    for (const scope of SCOPES) {
      cache.set(scope, new Map(Object.entries(loaded?.[scope] || {})))
    }
  } catch (error) {
    console.error('[preferences] load failed; starting with defaults:', error)
  }
  hydrated = true
}

/** Whether the cache has been filled. False in tests and before boot finishes. */
export const isHydrated = (): boolean => hydrated

/** The stored string, or null when the key was never written — `getItem`'s contract. */
export function getPreference(key: string): string | null {
  const value = cache.get(scopeFor(key))?.get(key)
  return value === undefined ? null : value
}

/**
 * Values are strings, because that is what the store holds and what `getPreference`
 * hands back. The `String()` guards the plain-JS call sites, which the type checker
 * does not hold to this signature.
 */
export function setPreference(key: string, value: string): void {
  const scope = scopeFor(key)
  const stored = String(value)
  cache.get(scope)?.set(key, stored)

  invoke('preferences_set', { scope, key, value: stored }).catch((error) => {
    console.error('[preferences] write failed for %s:', key, error)
  })
}

export function removePreference(key: string): void {
  const scope = scopeFor(key)
  cache.get(scope)?.delete(key)

  invoke('preferences_remove', { scope, key }).catch((error) => {
    console.error('[preferences] delete failed for %s:', key, error)
  })
}

/**
 * Move every key under one prefix to another, in the cache and on disk.
 *
 * A project rename has to carry the file tree's stored order and expansion with it, or
 * the renamed project opens with every folder collapsed and its manual order lost.
 */
export function renamePreferencePrefix(fromPrefix: string, toPrefix: string): void {
  const scope = scopeFor(fromPrefix)
  const scoped = cache.get(scope)

  if (scoped) {
    for (const [key, value] of [...scoped]) {
      if (!key.startsWith(fromPrefix)) continue
      scoped.delete(key)
      scoped.set(`${toPrefix}${key.slice(fromPrefix.length)}`, value)
    }
  }

  invoke('preferences_rename_prefix', { scope, fromPrefix, toPrefix }).catch((error) => {
    console.error('[preferences] rename failed for %s:', fromPrefix, error)
  })
}

/* ---------------- session state ---------------- */

/**
 * State scoped to one app launch, which is what `sessionStorage` was for. It stays in
 * memory: written to disk it would outlive the launch it describes, and a stale
 * "already refreshed this project" flag means a board that never refreshes again.
 */
const sessionState = new Map<string, string>()

export function getSessionValue(key: string): string | null {
  const value = sessionState.get(key)
  return value === undefined ? null : value
}

export function setSessionValue(key: string, value: string): void {
  sessionState.set(key, String(value))
}
