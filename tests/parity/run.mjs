/**
 * The differential parity harness: one corpus, both implementations, compared.
 *
 *   npm run parity
 *
 * Every module under cases/ produces `{ fn, args, expected }` rows, where `expected`
 * comes from calling the REAL JS function in src/lib/. This runner sends the same
 * `{ fn, args }` rows to the Rust `parity` binary and asserts the two agree.
 *
 * Why it exists: domain logic is implemented twice, in src/lib/ (what the webview
 * runs) and in `inkblot-core` (what the Tauri commands call). Two
 * implementations of the same function is a drift risk, and "I read both and they
 * look the same" is not a check. This is.
 *
 * A green run means something only if the harness can fail: after adding a case
 * module, break the Rust side on purpose and watch it fail before trusting it.
 *
 * Adding a function: a case module in cases/ (or rows in an existing one), an arm in
 * `src-tauri/crates/inkblot-core/src/bin/parity.rs`, and an import below. A module
 * may export `canon(value, case)` to normalize both sides the same way (canvasModel
 * uses it to rewrite generated ids).
 *
 * Both sides are compared after a JSON round-trip, so neither is credited with
 * distinctions JSON cannot carry (`undefined` keys, NaN, ±Infinity all collapse the
 * same way on both sides). Numbers that survive are compared with Object.is, so a
 * -0 or a last-bit float difference fails rather than passes.
 *
 * One class of case cannot be compared at all: a JS result containing an UNPAIRED
 * SURROGATE. JS strings are UTF-16 and can hold half of an astral character — a regex
 * without the `u` flag matches the halves separately, and `slice` will cut between
 * them — while a Rust `String` is UTF-8 and cannot represent one at all. Those cases
 * are counted as unrepresentable rather than failed, and a function where EVERY case
 * is unrepresentable fails, because that means nothing was actually checked.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import canvasGeometry from './cases/canvasGeometry.mjs'
import canvasModel from './cases/canvasModel.mjs'
import docKind from './cases/docKind.mjs'
import jsNumber from './cases/jsNumber.mjs'
import mapDiff from './cases/mapDiff.mjs'
import mapModel from './cases/mapModel.mjs'
import readAloudNotes from './cases/readAloudNotes.mjs'
import search from './cases/search.mjs'
import store from './cases/store.mjs'
import storyStructure from './cases/storyStructure.mjs'
import versionHistory from './cases/versionHistory.mjs'

const MODULES = [jsNumber, docKind, canvasGeometry, canvasModel, storyStructure, versionHistory, store, search, readAloudNotes, mapModel, mapDiff]

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TAURI = path.resolve(HERE, '../../src-tauri')

/* ---------------- build and run the Rust half ---------------- */

const build = spawnSync('cargo', ['build', '-q', '-p', 'inkblot-core', '--bin', 'parity'], {
  cwd: TAURI,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
})
if (build.status !== 0) {
  console.error('cargo build failed; cannot compare against anything.')
  process.exit(1)
}

const cases = []
const canonicalizers = new Map()
for (const module of MODULES) {
  if (module.canon) canonicalizers.set(module.name, module.canon)
  for (const row of module.cases()) {
    cases.push({ id: cases.length, module: module.name, ...row })
  }
}

const rust = spawnSync(path.join(TAURI, 'target/debug/parity'), {
  input: JSON.stringify({ cases: cases.map(({ id, fn, args }) => ({ id, fn, args })) }),
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
})
if (rust.status !== 0) {
  console.error('parity binary failed:', rust.stderr || rust.error)
  process.exit(1)
}

const results = new Map()
for (const row of JSON.parse(rust.stdout).results) results.set(row.id, row)

/* ---------------- compare ---------------- */

/** JSON's view of a value — the most either side can be asked to agree on. */
const throughJson = (value) => JSON.parse(JSON.stringify(value ?? null))

const same = (a, b) => {
  if (Object.is(a, b)) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => key in b && same(a[key], b[key]))
}

const show = (value) => JSON.stringify(value) ?? String(value)

/** A UTF-16 code unit with no partner — something Rust's String cannot hold. */
const hasLoneSurrogate = (value) => {
  if (typeof value === 'string') {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index)
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1)
        if (!(next >= 0xdc00 && next <= 0xdfff)) return true
        index += 1
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        return true
      }
    }
    return false
  }
  if (Array.isArray(value)) return value.some(hasLoneSurrogate)
  if (value && typeof value === 'object') return Object.values(value).some(hasLoneSurrogate)
  return false
}

const counts = new Map()
const unrepresentable = new Map()
const failures = []

for (const testCase of cases) {
  const key = `${testCase.module}.${testCase.fn}`
  counts.set(key, (counts.get(key) || 0) + 1)

  // A module may canonicalize before comparing — see canvasModel's generated ids.
  // It runs on BOTH sides, so it can only erase a difference it erases symmetrically.
  const canon = canonicalizers.get(testCase.module)
  const settle = (value) => (canon ? canon(throughJson(value), testCase) : throughJson(value))

  const result = results.get(testCase.id)
  const expected = settle(testCase.expected)

  if (hasLoneSurrogate(expected)) {
    unrepresentable.set(key, (unrepresentable.get(key) || 0) + 1)
    continue
  }

  if (!result) {
    failures.push({ key, testCase, detail: 'no result returned' })
  } else if ('err' in result) {
    failures.push({ key, testCase, detail: `rust: ${result.err}` })
  } else if (!same(expected, settle(result.ok))) {
    failures.push({ key, testCase, detail: `js ${show(expected)} !== rust ${show(settle(result.ok))}` })
  }
}

const failed = new Set(failures.map((failure) => failure.key))
for (const [key, count] of counts) {
  const bad = failures.filter((failure) => failure.key === key).length
  const skipped = unrepresentable.get(key) || 0

  if (skipped === count) {
    console.log(`FAIL  ${key} — all ${count} cases unrepresentable; nothing was checked`)
    failed.add(key)
    process.exitCode = 1
    continue
  }

  const aside = skipped ? `, ${skipped} unrepresentable in UTF-8` : ''
  console.log(
    bad
      ? `FAIL  ${key} — ${bad} of ${count} differ${aside}`
      : `PASS  ${key} — ${count - skipped} cases identical${aside}`
  )
}

if (failures.length) {
  console.log(`\n${failures.length} mismatches; first ${Math.min(10, failures.length)}:`)
  for (const failure of failures.slice(0, 10)) {
    console.log(`  ${failure.key}(${failure.testCase.args.map(show).join(', ')})  ${failure.detail}`)
  }
  console.log(`\nFAILURES in: ${[...failed].join(', ')}`)
  process.exitCode = 1
} else {
  const skipped = [...unrepresentable.values()].reduce((total, count) => total + count, 0)
  const aside = skipped ? ` (${skipped} unrepresentable in UTF-8, see above)` : ''
  console.log(`\n${cases.length - skipped} cases, JS and Rust identical${aside}.`)
}
