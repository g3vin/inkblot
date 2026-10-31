#!/usr/bin/env node
/**
 * audit.mjs — the ledger behind the `audit` skill (.claude/skills/audit/SKILL.md). It
 * splits the source into slices one session can review, and remembers which version of
 * each file was audited, so every run picks up where the last one stopped and an
 * unchanged file is never reviewed twice.
 *
 *   next [path] [--lines N]   print the next slice: files never audited or changed since,
 *                             starting in the directory with the most such lines
 *   done <findings.json>      record the slice's files as audited at their current
 *                             content, with the findings the review kept
 *   status [--full]           coverage, and the open findings, most severe first
 *
 * The ledger (.claude/audit/ledger.json, git-ignored) keeps, per file, the git blob id it
 * was audited at and its findings. Blob ids make staleness exact: an edited file is due
 * again, a committed or renamed-back one isn't. Re-auditing a file replaces its findings,
 * so a fixed bug drops out of the ledger on the next pass over that file.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { countLines, isChecked } from '../lint-size.mjs'

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const LEDGER = path.join(repo, '.claude/audit/ledger.json')
const SEVERITY = ['high', 'medium', 'low']

const git = (args, input) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', input, maxBuffer: 64 << 20 })

// Tests and CSS are left out: tests are checked by running them, styles by design-review.
const audited = (rel) =>
  (isChecked(rel) && !rel.startsWith('tests/') && !rel.endsWith('.css')) || /^scripts\/.*\.mjs$/.test(rel)

function sourceFiles() {
  const files = git(['ls-files', '--cached', '--others', '--exclude-standard'])
    .split('\n')
    .filter((rel) => audited(rel) && fs.existsSync(path.join(repo, rel)))
  const blobs = git(['hash-object', '--stdin-paths'], files.join('\n')).trim().split('\n')
  return files.map((rel, i) => ({
    rel,
    blob: blobs[i],
    lines: countLines(fs.readFileSync(path.join(repo, rel), 'utf8')),
  }))
}

const readLedger = () => {
  try {
    return JSON.parse(fs.readFileSync(LEDGER, 'utf8'))
  } catch {
    return {}
  }
}

const writeLedger = (ledger) => {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true })
  fs.writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 1)}\n`)
}

const sum = (files) => files.reduce((total, file) => total + file.lines, 0)

function progress(files, ledger) {
  const stale = files.filter((file) => ledger[file.rel]?.blob !== file.blob)
  const done = sum(files) - sum(stale)
  return `Audited ${done.toLocaleString()} of ${sum(files).toLocaleString()} lines ` +
    `(${Math.round((100 * done) / Math.max(1, sum(files)))}%); ${stale.length} files due.`
}

function next(args) {
  const at = args.indexOf('--lines')
  const budget = at >= 0 ? Number(args[at + 1]) : 2500
  const scope = args.find((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--lines')
  const ledger = readLedger()
  const files = sourceFiles()
  const stale = files
    .filter((file) => (!scope || file.rel.startsWith(scope)) && ledger[file.rel]?.blob !== file.blob)
    .sort((a, b) => a.rel.localeCompare(b.rel))
  if (!stale.length) {
    console.log(`Nothing due${scope ? ` under ${scope}` : ''}. ${progress(files, ledger)}`)
    return
  }

  // Start in the directory with the most unaudited lines, then take neighbours in path
  // order, so a slice holds files that work together.
  const byDir = new Map()
  for (const file of stale) {
    const dir = path.dirname(file.rel)
    byDir.set(dir, (byDir.get(dir) ?? 0) + file.lines)
  }
  const [dir] = [...byDir].sort((a, b) => b[1] - a[1])[0]
  const slice = []
  for (const file of stale.slice(stale.findIndex((f) => path.dirname(f.rel) === dir))) {
    if (slice.length && sum(slice) + file.lines > budget) break
    slice.push(file)
  }

  console.log(`Slice: ${slice.length} files, ${sum(slice).toLocaleString()} lines`)
  for (const file of slice) {
    const known = ledger[file.rel] ? ' (changed since its last audit)' : ''
    console.log(`  ${file.rel}  ${file.lines}${known}`)
  }
  console.log(progress(files, ledger))
}

function done([findingsPath]) {
  const { files: sliced = [], findings = [] } = JSON.parse(fs.readFileSync(findingsPath, 'utf8'))
  const ledger = readLedger()
  const current = new Map(sourceFiles().map((file) => [file.rel, file]))
  const today = new Date().toISOString().slice(0, 10)
  for (const rel of sliced) {
    if (!current.has(rel)) throw new Error(`Not an audited source file: ${rel}`)
    ledger[rel] = { blob: current.get(rel).blob, audited: today, findings: [] }
  }
  // A finding may sit outside the slice (a caller the verification traced into). It
  // joins that file's list without marking the file audited.
  for (const finding of findings) {
    ledger[finding.file] ??= { blob: null, findings: [] }
    ledger[finding.file].findings.push(finding)
  }
  writeLedger(ledger)
  console.log(`Recorded ${sliced.length} files, ${findings.length} findings. ${progress([...current.values()], ledger)}`)
}

function status(args) {
  const ledger = readLedger()
  const files = sourceFiles()
  const blobs = new Map(files.map((file) => [file.rel, file.blob]))
  const open = Object.entries(ledger)
    .flatMap(([rel, entry]) =>
      entry.findings.map((finding) => ({ ...finding, changed: entry.blob && blobs.get(rel) !== entry.blob })),
    )
    .sort((a, b) => SEVERITY.indexOf(a.severity) - SEVERITY.indexOf(b.severity))
  console.log(`${progress(files, ledger)} ${open.length} open findings.`)
  for (const finding of open) {
    const changed = finding.changed ? ' (file changed since: may be fixed)' : ''
    console.log(`- ${finding.file}:${finding.line} [${finding.severity}] ${finding.summary}${changed}`)
    if (args.includes('--full')) console.log(`    ${finding.failure_scenario}`)
  }
}

const [command, ...args] = process.argv.slice(2)
const commands = { next, done, status }
if (!commands[command]) {
  console.error('Usage: audit.mjs next [path] [--lines N] | done <findings.json> | status [--full]')
  process.exit(1)
}
commands[command](args)
