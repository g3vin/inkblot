#!/usr/bin/env node
/**
 * capture.mjs — screenshot every surface in design-review/surfaces.json, in both themes
 * and at two sizes, for the design review (docs/design-review/). It grew out of
 * screenshot.mjs and runs the same way, against scripts/dev/tauri-mock.js.
 *
 *   npm i --no-save playwright-core
 *   npm run dev                                         # in another terminal
 *   node scripts/dev/capture.mjs                        # every surface → design-review/out/<sha>/
 *   node scripts/dev/capture.mjs --run control          # name the run
 *   node scripts/dev/capture.mjs --only 'sheet-*'       # some surfaces (a glob on the id)
 *   node scripts/dev/capture.mjs --variant modals:B     # opens the app with ?variant=modals:B
 *   node scripts/dev/capture.mjs --list                 # the catalogue, nothing captured
 *
 * Writes design-review/out/<run>/<surface>-<theme>-<viewport>.png, a <surface>-menu.json
 * for a surface that pops up a native menu (the browser can't draw one), and
 * manifest.json: the sha, the date, and what was captured or failed, and why.
 *
 * Options: --run <name>, --only <glob> (repeatable, or comma-separated), --variant
 * <family>:<id>, --themes light,dark, --viewports desktop,ipad, --jobs <n> (default 4),
 * --scale <n> (device pixels, default 1), --list. Environment: BASE_URL (default
 * http://localhost:5173), CHROMIUM (a Chromium binary, if Playwright's own is not
 * installed), PLAYWRIGHT_CORE (path to playwright-core's index.mjs).
 *
 * To keep runs comparable it fixes the clock, seeds Math.random, asks for reduced motion,
 * hides the text caret and blocks every off-site request (a surface can answer one with
 * a fixture). Each surface × theme × viewport starts from a fresh page, so nothing one
 * surface opens leaks into the next.
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { THEMES, VIEWPORTS, catalogue, cli, launch, pick, preparePage, repo, base } from './surfaces.mjs'

const { args, opt, opts } = cli()
const globs = opts('only')
const surfaces = pick(globs)
const themes = opts('themes').length ? opts('themes') : THEMES
const viewports = opts('viewports').length ? opts('viewports') : Object.keys(VIEWPORTS)

if (args.includes('--list')) {
  for (const s of surfaces) console.log(`${s.id.padEnd(36)} ${s.family.padEnd(16)} ${s.title}`)
  console.log(`${surfaces.length} surfaces; ${catalogue.unreachable.length} listed as unreachable`)
  process.exit(0)
}

const sha = (() => { try { return execSync('git rev-parse --short HEAD', { cwd: repo }).toString().trim() } catch { return 'nosha' } })()
const dirty = (() => { try { return execSync('git status --porcelain -- src', { cwd: repo }).toString().trim() !== '' } catch { return false } })()
const run = opt('run', sha)
const variant = opt('variant')
const outDir = path.join(repo, 'design-review/out', run)
fs.mkdirSync(outDir, { recursive: true })

const browser = await launch()

async function capture(surface, theme, viewport) {
  const name = `${surface.id}-${theme}-${viewport}`
  const context = await browser.newContext({
    ...VIEWPORTS[viewport],
    colorScheme: theme,
    reducedMotion: 'reduce',
    deviceScaleFactor: Number(opt('scale', 1)),
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  try {
    const run = await preparePage(page, surface, { variant })
    await run(surface.steps)
    await page.waitForTimeout(surface.settle ?? 600)
    const shot = surface.shot ?? {}
    const file = path.join(outDir, `${name}.png`)
    if (shot.clip) await page.locator(shot.clip).first().screenshot({ path: file, timeout: 5000 })
    else await page.screenshot({ path: file, fullPage: Boolean(shot.fullPage) })
    if (surface.menu && theme === themes[0] && viewport === viewports[0]) {
      const menus = await page.evaluate(() => window.__ibMenus)
      fs.writeFileSync(path.join(outDir, `${surface.id}-menu.json`), `${JSON.stringify(menus.at(-1) ?? null, (key, value) => (key === 'rid' ? undefined : value), 2)}\n`)
    }
    return { surface: surface.id, theme, viewport, ok: true, errors }
  } catch (error) {
    return { surface: surface.id, theme, viewport, ok: false, error: process.env.DEBUG ? error.message : error.message.split('\n')[0], errors }
  } finally {
    await context.close()
  }
}

const jobs = []
for (const surface of surfaces) {
  for (const viewport of viewports) {
    if (surface.viewports && !surface.viewports.includes(viewport)) continue
    for (const theme of themes) jobs.push([surface, theme, viewport])
  }
}

const results = []
let next = 0
const worker = async () => {
  while (next < jobs.length) {
    const [surface, theme, viewport] = jobs[next++]
    const result = await capture(surface, theme, viewport)
    results.push(result)
    console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${surface.id}-${theme}-${viewport}${result.ok ? '' : `  ${result.error}`}`)
  }
}
await Promise.all(Array.from({ length: Number(opt('jobs', 4)) }, worker))
await browser.close()

const order = new Map(jobs.map(([s, t, v], i) => [`${s.id}-${t}-${v}`, i]))
results.sort((a, b) => order.get(`${a.surface}-${a.theme}-${a.viewport}`) - order.get(`${b.surface}-${b.theme}-${b.viewport}`))
const failed = results.filter((r) => !r.ok)
const manifest = {
  run,
  sha,
  dirty,
  date: new Date().toISOString(),
  base,
  variant: variant ?? null,
  surfaces: surfaces.length,
  captured: results.length - failed.length,
  failed: failed.length,
  results,
}
// Merge into an earlier manifest for the same run, so `--only` can re-take a few surfaces.
const manifestPath = path.join(outDir, 'manifest.json')
if (fs.existsSync(manifestPath) && globs.length) {
  const earlier = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const retaken = new Set(surfaces.map((s) => s.id))
  manifest.results = [...earlier.results.filter((r) => !retaken.has(r.surface)), ...results]
  manifest.surfaces = new Set(manifest.results.map((r) => r.surface)).size
  manifest.captured = manifest.results.filter((r) => r.ok).length
  manifest.failed = manifest.results.filter((r) => !r.ok).length
}
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`\n${manifest.captured} captured, ${manifest.failed} failed → ${path.relative(repo, outDir)}`)
if (dirty) console.log('Note: src/ has uncommitted changes, so this run is not reproducible from the sha alone.')
process.exitCode = failed.length ? 1 : 0
