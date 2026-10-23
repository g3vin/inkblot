#!/usr/bin/env node
/**
 * compare.mjs — pixel-diff two capture runs (scripts/dev/capture.mjs) for the design
 * review: which surfaces changed, and by how much.
 *
 *   npm i --no-save playwright-core pixelmatch pngjs
 *   node scripts/dev/compare.mjs control round-01-B          # two runs in design-review/out/
 *   node scripts/dev/compare.mjs control head --strict        # exit 1 if anything changed
 *
 * Writes design-review/out/compare/<a>--<b>/: report.json, report.md and index.html
 * (before, after and a diff image for each changed screenshot), and prints the summary.
 * A screenshot counts as changed when any pixel differs beyond the colour threshold.
 *
 * Options: --threshold <0–1> (pixelmatch's per-pixel colour tolerance, default 0.1),
 * --noise <percent> (a change no bigger than this share of the screenshot is WebGL
 * antialiasing noise, reported but not counted; default 0.005),
 * --strict (exit 1 on any change, or on a screenshot only the second run has; use it to
 * prove a variant switch left the default render pixel-identical). Screenshots only the
 * first run has are listed apart, so a partial run (`capture --only`) compares cleanly.
 * Environment: DEV_DEPS (a folder whose node_modules holds pixelmatch and pngjs, if they
 * are not installed here).
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const [runA, runB] = args.filter((a, i) => !a.startsWith('--') && !['--threshold', '--noise'].includes(args[i - 1]))
if (!runA || !runB) {
  console.error('Usage: node scripts/dev/compare.mjs <run-a> <run-b> [--threshold 0.1] [--strict]')
  process.exit(2)
}

const resolver = createRequire(process.env.DEV_DEPS ? path.join(process.env.DEV_DEPS, 'noop.js') : import.meta.url)
const load = async (name) => import(pathToFileURL(resolver.resolve(name)).href)
const pixelmatch = (await load('pixelmatch')).default
const { PNG } = (await load('pngjs')).default

const out = path.join(repo, 'design-review/out')
const dirA = path.isAbsolute(runA) ? runA : path.join(out, runA)
const dirB = path.isAbsolute(runB) ? runB : path.join(out, runB)
for (const dir of [dirA, dirB]) if (!fs.existsSync(dir)) { console.error(`No run at ${dir}`); process.exit(2) }
const reportDir = path.join(out, 'compare', `${path.basename(dirA)}--${path.basename(dirB)}`)
fs.rmSync(reportDir, { recursive: true, force: true })
fs.mkdirSync(path.join(reportDir, 'diff'), { recursive: true })

const pngs = (dir) => new Set(fs.readdirSync(dir).filter((f) => f.endsWith('.png')))
const inA = pngs(dirA)
const inB = pngs(dirB)
const names = [...new Set([...inA, ...inB])].sort()
const threshold = Number(opt('threshold', 0.1))
// WebGL views (the globe, 3D maps) can antialias a handful of pixels differently from
// run to run. A change no bigger than this share of the screenshot counts as noise.
const noise = Number(opt('noise', 0.005))

const rows = []
for (const name of names) {
  if (!inA.has(name) || !inB.has(name)) {
    rows.push({ name, status: inA.has(name) ? 'only-a' : 'only-b', percent: null })
    continue
  }
  const a = PNG.sync.read(fs.readFileSync(path.join(dirA, name)))
  const b = PNG.sync.read(fs.readFileSync(path.join(dirB, name)))
  if (a.width !== b.width || a.height !== b.height) {
    rows.push({ name, status: 'resized', percent: 100, size: [`${a.width}×${a.height}`, `${b.width}×${b.height}`] })
    continue
  }
  const diff = new PNG({ width: a.width, height: a.height })
  const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold, alpha: 0.25 })
  const percent = (changed / (a.width * a.height)) * 100
  const status = changed === 0 ? 'same' : percent <= noise ? 'noise' : 'changed'
  if (status === 'changed') fs.writeFileSync(path.join(reportDir, 'diff', name), PNG.sync.write(diff))
  rows.push({ name, status, percent, pixels: changed })
}

// Missing screenshots are listed apart: comparing a partial run (`capture --only`) with a
// full one is normal, and they would bury the real changes.
const missing = rows.filter((r) => r.percent === null)
const compared = rows.filter((r) => r.percent !== null)
const changed = compared.filter((r) => r.status === 'changed').sort((x, y) => y.percent - x.percent)
const noisy = compared.filter((r) => r.status === 'noise').map((r) => r.name.replace(/\.png$/, ''))
const same = compared.length - changed.length - noisy.length
const fmt = (r) => (r.status === 'resized' ? `resized ${r.size.join(' → ')}` : `${r.percent.toFixed(3)}%`)
const onlyIn = (status) => missing.filter((r) => r.status === status).map((r) => r.name.replace(/\.png$/, ''))
const summary = { a: runA, b: runB, threshold, noise, noisy, compared: compared.length, same, changed: changed.length, rows: changed, onlyInA: onlyIn('only-a'), onlyInB: onlyIn('only-b') }
fs.writeFileSync(path.join(reportDir, 'report.json'), `${JSON.stringify(summary, null, 2)}\n`)

const md = [
  `# ${runA} → ${runB}`,
  '',
  `${compared.length} screenshots compared at threshold ${threshold}: ${changed.length} changed, ${same} identical${noisy.length ? `, ${noisy.length} within the ${noise}% noise floor (${noisy.join(', ')})` : ''}.`,
  ...(summary.onlyInA.length ? [`${summary.onlyInA.length} only in ${runA} (see report.json).`] : []),
  ...(summary.onlyInB.length ? [`${summary.onlyInB.length} only in ${runB}: ${summary.onlyInB.join(', ')}.`] : []),
  '',
  ...(changed.length ? ['| Screenshot | Pixels changed |', '| --- | --- |', ...changed.map((r) => `| ${r.name.replace(/\.png$/, '')} | ${fmt(r)} |`)] : ['No differences.']),
  '',
].join('\n')
fs.writeFileSync(path.join(reportDir, 'report.md'), md)

const rel = (dir, name) => path.relative(reportDir, path.join(dir, name))
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(runA)} → ${esc(runB)}</title>
<style>
  :root { color-scheme: light dark; --bg: #f7f5f0; --fg: #1d1b18; --muted: #6b665d; --rule: #d9d4ca; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1b1a18; --fg: #ece8e1; --muted: #a39d92; --rule: #3a3732; } }
  body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; } p { color: var(--muted); margin: 0 0 24px; }
  section { border-top: 1px solid var(--rule); padding: 16px 0; }
  h2 { font-size: 14px; margin: 0 0 8px; } h2 span { color: var(--muted); font-weight: 400; }
  .row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  figure { margin: 0; } figcaption { color: var(--muted); font-size: 12px; } img { width: 100%; border: 1px solid var(--rule); }
  @media (max-width: 700px) { .row { grid-template-columns: 1fr; } }
</style>
<h1>${esc(runA)} → ${esc(runB)}</h1>
<p>${compared.length} screenshots compared at threshold ${threshold}: ${changed.length} changed, ${same} identical${noisy.length ? `, ${noisy.length} within the noise floor` : ''}.${missing.length ? ` ${missing.length} are in only one run.` : ''}</p>
${changed.map((r) => `<section><h2>${esc(r.name.replace(/\.png$/, ''))} <span>${esc(fmt(r))}</span></h2><div class="row">
  <figure><img loading="lazy" src="${esc(rel(dirA, r.name))}"><figcaption>${esc(runA)}</figcaption></figure>
  <figure><img loading="lazy" src="${esc(rel(dirB, r.name))}"><figcaption>${esc(runB)}</figcaption></figure>
  <figure>${r.status === 'changed' ? `<img loading="lazy" src="diff/${esc(r.name)}">` : ''}<figcaption>diff</figcaption></figure>
</div></section>`).join('\n')}
`
fs.writeFileSync(path.join(reportDir, 'index.html'), html)

console.log(md)
console.log(`Report: ${path.relative(repo, reportDir)}/index.html`)
if (flag('strict') && (changed.length || summary.onlyInB.length)) process.exitCode = 1
