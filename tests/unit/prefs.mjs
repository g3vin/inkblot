/**
 * The preference store's webview half.
 *
 * Everything the app remembers between launches lives in files under AppData that both
 * shells can read — not `localStorage`, which a native shell cannot see. The Rust
 * half has its own tests; what is checked here is the part that only exists in the
 * webview, and where a mistake is silent:
 *
 *   - **which file a key lands in.** A key routed to the wrong scope is written to one
 *     file and looked for in another, so it reads back as absent — the setting appears
 *     to save and is simply gone at the next launch.
 *   - **that reads are synchronous after hydration**, because every call site reads
 *     during render and none of them can await.
 *   - **that a failed write does not throw**: losing a setting must not crash the app.
 */
import { setInvokeHandler } from './stub-core.mjs'

import { ok } from './assert.mjs'

const calls = []
let failWrites = false

setInvokeHandler(async (command, args) => {
  calls.push({ command, args })
  if (command === 'preferences_load') {
    return {
      app: { 'inkblot-theme': 'dark', 'inkblot-session': '{"tabs":[]}' },
      'file-tree': { 'inkblot-expanded:Novel': '["Characters"]' },
      'pinterest-cache': { 'inkblot:pinterest-preview:https://pin.it/x': '{"pins":[]}' },
    }
  }
  if (failWrites) throw new Error('disk is full')
  return null
})

const prefs = await import('../../src/lib/preferences.ts')

/* ---------------- hydration ---------------- */

ok('nothing is hydrated before the first read', !prefs.isHydrated())
ok('an unhydrated read is null rather than a throw', prefs.getPreference('inkblot-theme') === null)

await prefs.hydratePreferences()
ok('hydration reports itself', prefs.isHydrated())
ok('it asked for every scope in one call', calls.filter((c) => c.command === 'preferences_load').length === 1)

/* ---------------- reads are synchronous ---------------- */

ok('an app preference reads back', prefs.getPreference('inkblot-theme') === 'dark')
ok('a file-tree preference reads back', prefs.getPreference('inkblot-expanded:Novel') === '["Characters"]')
ok('a pinterest entry reads back', prefs.getPreference('inkblot:pinterest-preview:https://pin.it/x') === '{"pins":[]}')
ok('an absent key is null, as getItem was', prefs.getPreference('never-set') === null)

/* ---------------- writes route to the right file ---------------- */

const scopeOf = (key) => {
  calls.length = 0
  prefs.setPreference(key, 'v')
  return calls[0]?.args?.scope
}

ok('the theme is an app preference', scopeOf('inkblot-theme') === 'app')
ok('a session is an app preference', scopeOf('inkblot-session') === 'app')
ok('the read-aloud voice is an app preference', scopeOf('inkblot:read-aloud-voice') === 'app')
ok('a tree order goes to the file-tree scope', scopeOf('inkblot-order:Novel') === 'file-tree')
ok('a tree expansion goes to the file-tree scope', scopeOf('inkblot-expanded:Novel') === 'file-tree')
ok('a scraped board goes to the pinterest scope', scopeOf('inkblot:pinterest-preview:https://pin.it/y') === 'pinterest-cache')
ok('an unrecognized key is an app preference', scopeOf('something-new') === 'app')

/* ---------------- writes are visible immediately ---------------- */

prefs.setPreference('inkblot-accent-color', '#ff0000')
ok('a write reads back without waiting for disk', prefs.getPreference('inkblot-accent-color') === '#ff0000')

prefs.removePreference('inkblot-accent-color')
ok('a delete is visible immediately', prefs.getPreference('inkblot-accent-color') === null)

/* ---------------- a project rename carries its tree state ---------------- */

// Re-established because the scope probes above wrote over them.
prefs.setPreference('inkblot-order:Novel', '{"a":1}')
prefs.setPreference('inkblot-expanded:Novel', '["Characters"]')

prefs.renamePreferencePrefix('inkblot-order:Novel', 'inkblot-order:Book')
ok('the old key is gone', prefs.getPreference('inkblot-order:Novel') === null)
ok('the new key has the value', prefs.getPreference('inkblot-order:Book') === '{"a":1}')
ok('a neighbouring key is untouched', prefs.getPreference('inkblot-expanded:Novel') === '["Characters"]')

/* ---------------- session state never reaches disk ---------------- */

calls.length = 0
prefs.setSessionValue('inkblot:project-open-id', 'abc')
ok('a session value reads back', prefs.getSessionValue('inkblot:project-open-id') === 'abc')
ok('and never went to disk', calls.length === 0)
ok('an unset session value is null', prefs.getSessionValue('nothing') === null)

/* ---------------- a failed write is survivable ---------------- */

failWrites = true
let threw = false
// The write logs on rejection, which is the behaviour under test; silencing it keeps
// the suite's output readable.
const realError = console.error
console.error = () => {}
try {
  prefs.setPreference('inkblot-theme', 'light')
} catch {
  threw = true
}
ok('a write that cannot reach disk does not throw', !threw)
ok('and the value is still readable in this session', prefs.getPreference('inkblot-theme') === 'light')

// Let the rejected write settle, so its handler runs before the suite ends.
await new Promise((resolve) => setTimeout(resolve, 0))
console.error = realError
