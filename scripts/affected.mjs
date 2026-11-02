#!/usr/bin/env node
/**
 * affected.mjs — which checks a change needs (`npm run affected [-- --base <ref>]`).
 *
 * Reads the changed files (the working tree against <ref>, default HEAD, plus untracked
 * files) and prints the commands to run while iterating:
 *
 *   unit suites   every suite in tests/unit/run.mjs whose import graph reaches a changed
 *                 file, plus the suites that scan the tree instead of importing it
 *                 (css, icons, help, speech: see SCANNERS)
 *   lint:design   for a change to CSS, JSX or src/ui
 *   parity        for a module with a `Mirrors:` header line, naming the twin to change
 *   types         for a Rust file with #[typeshare] types
 *   cargo test    per changed crate
 *
 * The full pre-commit checks are still `npm run check` and `npm run check:rust`; this
 * only narrows the loop before them. The import graph is read with regexes, not a
 * parser: it follows static, dynamic and `new URL(…, import.meta.url)` imports of
 * relative paths, which is how every module in src/ imports another.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs']

// Suites that read files from disk rather than importing them.
export const SCANNERS = [
  { suite: 'css', test: (file) => /^src\/.*\.css$/.test(file) },
  { suite: 'icons', test: (file) => /^src\/.*\.(jsx?|tsx?)$/.test(file) },
  { suite: 'help', test: (file) => /^src\/.*\.(jsx?|tsx?)$/.test(file) },
  { suite: 'speech', test: (file) => file === 'src-tauri/crates/inkblot-models/src/pocket_speech.rs' },
]

const IMPORT = /\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s+['"]([^'"]+)['"]|new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g

/** The relative specifiers a module imports, without query strings (`?raw`). */
export function parseImports(text) {
  const found = []
  for (const match of text.matchAll(IMPORT)) {
    const spec = (match[1] ?? match[2] ?? match[3] ?? match[4]).split('?')[0]
    if (spec.startsWith('.')) found.push(spec)
  }
  return found
}

/** Resolves `spec` from `from` the way Vite does, against the set of known files. */
export function resolveSpecifier(from, spec, has) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec))
  const candidates = [base, ...EXTENSIONS.map((ext) => base + ext), ...EXTENSIONS.map((ext) => `${base}/index${ext}`)]
  return candidates.find((candidate) => has(candidate)) ?? null
}

/** `Mirrors: a/b.rs, c/d.rs` in the first 40 lines of a module's header. */
export function parseMirrors(text) {
  const head = text.split('\n').slice(0, 40).join('\n')
  const line = head.match(/Mirrors:\s*([^\n]+)/)
  if (!line) return []
  return line[1].split(/[,\s]+/).map((part) => part.replace(/[`*.);:]+$/, '').replace(/^[`(]+/, '')).filter((part) => /\.(rs|js|jsx|ts|mjs)$/.test(part))
}

/**
 * The plan for a set of changed files.
 * @param {{ changed: string[], files: Map<string, string>, suites: string[] }} input
 *   `files` maps every repo-relative source path to its text; suites are names in
 *   tests/unit/ (`tests/unit/<name>.mjs`).
 */
export function plan({ changed, files, suites }) {
  const has = (file) => files.has(file)
  const imports = new Map()
  const edges = (file) => {
    if (!imports.has(file)) {
      const text = files.get(file) ?? ''
      imports.set(file, parseImports(text).map((spec) => resolveSpecifier(file, spec, has)).filter(Boolean))
    }
    return imports.get(file)
  }
  const reach = (start) => {
    const seen = new Set([start])
    const queue = [start]
    while (queue.length) {
      for (const next of edges(queue.pop())) {
        if (!seen.has(next)) {
          seen.add(next)
          queue.push(next)
        }
      }
    }
    return seen
  }

  const changedSet = new Set(changed)
  const hitSuites = new Set()
  for (const suite of suites) {
    const entry = `tests/unit/${suite}.mjs`
    if (!files.has(entry)) continue
    for (const file of reach(entry)) {
      if (changedSet.has(file)) {
        hitSuites.add(suite)
        break
      }
    }
  }
  for (const { suite, test } of SCANNERS) {
    if (suites.includes(suite) && changed.some(test)) hitSuites.add(suite)
  }

  // Mirrors are declared once, in the JS header; a changed Rust twin finds them backwards.
  const twins = []
  for (const [file, text] of files) {
    if (!/^src\/.*\.(jsx?|tsx?)$/.test(file)) continue
    for (const rust of parseMirrors(text)) {
      if (changedSet.has(file)) twins.push({ changed: file, twin: rust })
      else if (changedSet.has(rust)) twins.push({ changed: rust, twin: file })
    }
  }

  const crates = new Set()
  let typeshare = false
  for (const file of changed) {
    const crate = file.match(/^src-tauri\/crates\/([^/]+)\//)
    if (crate) crates.add(crate[1])
    else if (/^src-tauri\/src\/.*\.rs$/.test(file)) crates.add('inkblot')
    if (file.endsWith('.rs') && /#\[typeshare/.test(files.get(file) ?? '')) typeshare = true
  }

  const commands = []
  const ordered = suites.filter((suite) => hitSuites.has(suite))
  if (ordered.length) commands.push(`npm test -- ${ordered.join(' ')}`)
  if (changed.some((file) => /^src\/.*\.(css|jsx)$/.test(file) || file.startsWith('src/ui/'))) commands.push('npm run lint:design')
  if (typeshare) commands.push('npm run types')
  for (const crate of [...crates].sort()) commands.push(`(cd src-tauri && cargo test -q -p ${crate})`)
  if (twins.length) commands.push('npm run parity')
  return { suites: ordered, twins, commands }
}

const SOURCE = /\.(jsx?|tsx?|mjs|css|rs)$/

function listSources(repo) {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'src', 'tests/unit', 'src-tauri/crates', 'src-tauri/src'], { cwd: repo, encoding: 'utf8' })
  return out.split('\n').filter((file) => SOURCE.test(file) && fs.existsSync(path.join(repo, file)))
}

function changedFiles(repo, base) {
  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).split('\n').filter(Boolean)
  return [...new Set([...git(['diff', '--name-only', base]), ...git(['ls-files', '--others', '--exclude-standard'])])]
}

function suiteNames(repo) {
  const runner = fs.readFileSync(path.join(repo, 'tests/unit/run.mjs'), 'utf8')
  const list = runner.match(/const SUITES = \[([^\]]*)\]/)
  return list ? [...list[1].matchAll(/'([^']+)'/g)].map((match) => match[1]) : []
}

function main() {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const at = process.argv.indexOf('--base')
  const base = at > 0 ? process.argv[at + 1] : 'HEAD'
  const changed = changedFiles(repo, base)
  if (!changed.length) {
    console.log(`Nothing changed against ${base}.`)
    return
  }
  const files = new Map(listSources(repo).map((file) => [file, fs.readFileSync(path.join(repo, file), 'utf8')]))
  const result = plan({ changed, files, suites: suiteNames(repo) })
  const sources = changed.filter((file) => SOURCE.test(file))
  console.log(`${changed.length} changed file${changed.length === 1 ? '' : 's'} against ${base} (${sources.length} source).`)
  for (const { changed: file, twin } of result.twins) console.log(`Mirrored: ${file} ↔ ${twin}; change both.`)
  if (!result.commands.length) console.log('No suite or check is affected beyond `npm run check`.')
  else console.log(['Run:', ...result.commands.map((command) => `  ${command}`)].join('\n'))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main()
