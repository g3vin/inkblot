/**
 * The differential parity harness: one corpus, both implementations, compared.
 *
 *   npm run parity
 *
 * Every module under cases/ produces `{ fn, args, expected }` rows, where `expected`
 * comes from calling the REAL JS function in src/lib/. This runner sends the same
 * `{ fn, args }` rows to the Rust `parity` binary and asserts the two agree.
 *
 * Why it exists: Phase 2 ports domain logic to Rust while the JS stays in place and
 * the app keeps shipping. Two implementations of the same function is a drift risk,
 * and "I read both and they look the same" is not a check. This is.
 *
 * Both sides are compared after a JSON round-trip, so neither is credited with
 * distinctions JSON cannot carry (`undefined` keys, NaN, ±Infinity all collapse the
 * same way on both sides). Numbers that survive are compared with Object.is, so a
 * -0 or a last-bit float difference fails rather than passes.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import canvasGeometry from './cases/canvasGeometry.mjs'
import canvasModel from './cases/canvasModel.mjs'
import docKind from './cases/docKind.mjs'
import jsNumber from './cases/jsNumber.mjs'
import storyStructure from './cases/storyStructure.mjs'
import versionHistory from './cases/versionHistory.mjs'

const MODULES = [jsNumber, docKind, canvasGeometry, canvasModel, storyStructure, versionHistory]

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TAURI = path.resolve(HERE, '../../src-tauri')

/* ---------------- build and run the Rust half ---------------- */

const build = spawnSync('cargo', ['build', '-p', 'inkblot-core', '--bin', 'parity'], {
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

const counts = new Map()
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
  const label = bad ? `FAIL  ${key} — ${bad} of ${count} differ` : `PASS  ${key} — ${count} cases identical`
  console.log(label)
}

if (failures.length) {
  console.log(`\n${failures.length} mismatches; first ${Math.min(10, failures.length)}:`)
  for (const failure of failures.slice(0, 10)) {
    console.log(`  ${failure.key}(${failure.testCase.args.map(show).join(', ')})  ${failure.detail}`)
  }
  console.log(`\nFAILURES in: ${[...failed].join(', ')}`)
  process.exitCode = 1
} else {
  console.log(`\n${cases.length} cases, JS and Rust identical.`)
  process.exitCode = 0
}
