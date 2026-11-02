#!/usr/bin/env node
/**
 * lint-size.mjs — keeps source files small enough to read in one go
 * (.claude/rules/file-size.md, CONTRIBUTING → Code style).
 *
 *   npm run lint:size                          fail if a file is over the limit and its baseline
 *   npm run lint:size -- --list                every file over the limit, largest first
 *   npm run lint:size -- --update-baseline     record the current sizes (only ever DOWN)
 *
 * A file of more than LIMIT lines is one a person or an agent can't hold whole, and
 * reading it costs more than its parts would. The files that were already larger are
 * recorded in scripts/size-baseline.json: such a file may shrink but never grow, and
 * --update-baseline locks a lower size in. A new file must stay under LIMIT. To make
 * room in a baselined file, split something out first (a hook, a helper module, a Rust
 * child module or tests file); see the rule for how.
 *
 * `sizeVerdict` is shared with the post-edit hook (scripts/claude/post-edit.mjs), so an
 * edit that pushes a file over is reported as it is made.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const LIMIT = 700

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = path.join(repo, 'scripts/size-baseline.json')

const SOURCE = /^(src\/.*\.(jsx?|tsx?|mjs|css)|tests\/unit\/.*\.mjs|src-tauri\/(src|crates\/[^/]+\/src)\/.*\.rs)$/
// Generated: regenerate instead of editing, so its size is not a choice.
const GENERATED = new Set(['src/types/inkblot-core.ts'])

export const isChecked = (rel) => SOURCE.test(rel) && !GENERATED.has(rel)

export const readBaseline = () => {
  try {
    return JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
  } catch {
    return {}
  }
}

export const countLines = (text) => (text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length)

/** Null when the file is fine; otherwise why it is not. */
export function sizeVerdict(rel, lines, baseline = readBaseline()) {
  if (!isChecked(rel) || lines <= LIMIT) return null
  const allowed = baseline[rel]
  if (allowed === undefined) return `${rel} is ${lines} lines; new files stay under ${LIMIT}. Split it before going on.`
  if (lines > allowed) return `${rel} grew to ${lines} lines (baseline ${allowed}, limit ${LIMIT}). Split something out of it instead of growing it.`
  return null
}

function sizes() {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: repo, encoding: 'utf8' })
    .split('\n')
    .filter((rel) => isChecked(rel) && fs.existsSync(path.join(repo, rel)))
  return new Map(files.map((rel) => [rel, countLines(fs.readFileSync(path.join(repo, rel), 'utf8'))]))
}

function main() {
  const args = new Set(process.argv.slice(2))
  const current = sizes()
  const baseline = readBaseline()

  if (args.has('--list')) {
    const over = [...current].filter(([, lines]) => lines > LIMIT).sort((a, b) => b[1] - a[1])
    for (const [rel, lines] of over) console.log(`${String(lines).padStart(5)}  ${rel}${baseline[rel] !== undefined ? '' : '  (new)'}`)
    return
  }

  if (args.has('--update-baseline')) {
    const next = {}
    for (const [rel, lines] of [...current].sort()) {
      if (lines <= LIMIT) continue
      if (baseline[rel] === undefined && !args.has('--force')) {
        console.error(`✗ ${rel} is ${lines} lines and not in the baseline: split it, or pass --force to record it.`)
        process.exitCode = 1
        continue
      }
      next[rel] = baseline[rel] === undefined ? lines : Math.min(lines, baseline[rel])
    }
    fs.writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`)
    console.log(`size baseline: ${Object.keys(next).length} files over ${LIMIT} lines`)
    return
  }

  const problems = [...current].map(([rel, lines]) => sizeVerdict(rel, lines, baseline)).filter(Boolean)
  if (problems.length) {
    for (const problem of problems) console.error(`✗ ${problem}`)
    process.exitCode = 1
    return
  }
  const listed = Object.keys(baseline).length
  console.log(`✓ size lint: every file under ${LIMIT} lines, or under its baseline (${listed} legacy files; see scripts/size-baseline.json)`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main()
