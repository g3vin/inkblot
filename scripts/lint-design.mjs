#!/usr/bin/env node
/**
 * lint-design.mjs — keeps raw design values out of the app (docs/DESIGN.md → Guardrails).
 *
 *   npm run lint:design            check: fail if any file got worse than the baseline
 *   npm run lint:design -- --list  print every finding
 *   npm run lint:design -- --update-baseline   record the current counts (only ever DOWN)
 *
 * Flags, outside the files that are allowed to define them:
 *   color   hex / rgb() / hsl() literals        → use a token (--text-*, --ink-*, …)
 *   font    font-family not built from a var()  → use --font-ui / --font-type / --font-editor
 *   radius  border-radius in px                 → use --radius-sm / md / lg / pill
 *
 * A raw shadow is caught by its colour (rgba(…) / #…) → use --shadow-float / --shadow-dialog.
 *
 * The code base predates the design language, so existing findings are recorded per
 * file in scripts/design-baseline.json. A file may never gain findings; migrating a
 * surface lowers its count, and --update-baseline then locks the lower number in.
 * A new file starts at zero.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = path.join(repo, 'scripts/design-baseline.json')
const ALLOWED = new Set([
  'src/styles/tokens.css', // the one place raw values live
  'src/lib/palette.ts', // legacy hex → ink mapping
])
// Files that must not be checked: generated, vendored, or not UI, and content. The
// print modules in TypeScript draw the printed page and e-book themes, and the map's
// world data (src/lib/map/) and themes (mapThemes.css) are the map's own colours:
// document content, whose colours are the writer's, not the app's.
const IGNORED = [
  /^src\/types\//,
  /^src\/print\/export\//,
  /^src\/print\/[^/]+\.ts$/,
  /^src\/lib\/map\//,
  /^src\/map\/mapThemes\.css$/,
  /\.d\.ts$/,
]

const args = new Set(process.argv.slice(2))

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name)
  if (entry.isDirectory()) return walk(full)
  return /\.(css|jsx?|tsx?)$/.test(entry.name) ? [full] : []
})

const stripComments = (text, isCss) => (isCss
  ? text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  : text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1'))

const COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g

function check(rel, text) {
  const isCss = rel.endsWith('.css')
  const findings = []
  const lines = stripComments(text, isCss).split('\n')
  lines.forEach((line, index) => {
    const at = (kind, detail) => findings.push({ kind, line: index + 1, detail: detail.trim().slice(0, 100) })
    if (isCss) {
      if (COLOR.test(line)) at('color', line)
      COLOR.lastIndex = 0
      const font = /font-family\s*:\s*([^;]+)/.exec(line)
      if (font && !/var\(|inherit|initial|unset/.test(font[1])) at('font', line)
      const radius = /border(?:-[a-z]+)*-radius\s*:\s*([^;]+)/.exec(line)
      if (radius && /\b(?!0px)\d+(?:\.\d+)?px/.test(radius[1]) && !/var\(/.test(radius[1])) at('radius', line)
    } else {
      // In scripts only colour literals in strings are flagged (inline styles, palettes).
      const strings = line.match(/(['"`])(?:\\.|(?!\1).)*\1/g) || []
      if (strings.some((s) => /^.#[0-9a-fA-F]{3,8}.$|^.#[0-9a-fA-F]{6}\b|(?:rgba?|hsla?)\(/.test(s))) at('color', line)
    }
  })
  return findings
}

const results = {}
for (const file of walk(path.join(repo, 'src'))) {
  const rel = path.relative(repo, file).split(path.sep).join('/')
  if (ALLOWED.has(rel) || IGNORED.some((re) => re.test(rel))) continue
  const findings = check(rel, fs.readFileSync(file, 'utf8'))
  if (findings.length) results[rel] = findings
}

const counts = Object.fromEntries(Object.entries(results).map(([file, list]) => [file, list.length]).sort())
const total = Object.values(counts).reduce((a, b) => a + b, 0)

if (args.has('--list')) {
  for (const [file, list] of Object.entries(results)) {
    for (const f of list) console.log(`${file}:${f.line}  ${f.kind.padEnd(6)} ${f.detail}`)
  }
}

let baseline = {}
try { baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) } catch { /* first run */ }

if (args.has('--update-baseline')) {
  const next = {}
  for (const [file, count] of Object.entries(counts)) {
    next[file] = baseline[file] === undefined || args.has('--force') ? count : Math.min(count, baseline[file])
    if (baseline[file] !== undefined && count > baseline[file] && !args.has('--force')) {
      console.error(`refusing to raise ${file} from ${baseline[file]} to ${count}; fix the new findings instead`)
      process.exitCode = 1
    }
  }
  fs.writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`)
  console.log(`baseline: ${total} findings across ${Object.keys(next).length} files`)
} else {
  const worse = Object.entries(counts).filter(([file, count]) => count > (baseline[file] ?? 0))
  const better = Object.entries(baseline).filter(([file, count]) => (counts[file] ?? 0) < count)
  for (const [file, count] of worse) {
    console.error(`✗ ${file}: ${count} raw design value(s), baseline allows ${baseline[file] ?? 0}`)
    for (const f of results[file]) console.error(`    ${f.line}: ${f.kind} — ${f.detail}`)
  }
  if (better.length) console.log(`↓ ${better.length} file(s) improved — run \`npm run lint:design -- --update-baseline\` to lock it in.`)
  console.log(`${worse.length ? '✗' : '✓'} design lint: ${total} legacy findings remaining (see docs/DESIGN.md → Migration)`)
  if (worse.length) process.exitCode = 1
}
