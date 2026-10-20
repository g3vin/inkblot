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
 * To keep runs comparable it fixes the clock, asks for reduced motion, hides the text
 * caret and blocks every off-site request (a surface can answer one with a fixture). Each surface × theme × viewport starts from a fresh page, so nothing one
 * surface opens leaks into the next.
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const base = process.env.BASE_URL || 'http://localhost:5173'

const VIEWPORTS = {
  desktop: { viewport: { width: 1400, height: 900 } },
  ipad: {
    viewport: { width: 820, height: 1180 },
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  },
}
const THEMES = ['light', 'dark']
const FIXED_TIME = new Date('2026-10-01T10:00:00')

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const opts = (name) => args.flatMap((a, i) => (a === `--${name}` ? args[i + 1].split(',') : []))

const catalogue = JSON.parse(fs.readFileSync(path.join(repo, 'design-review/surfaces.json'), 'utf8'))
const globs = opts('only').map((g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`))
const surfaces = catalogue.surfaces.filter((s) => !globs.length || globs.some((re) => re.test(s.id)))
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

const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core')
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const mock = fs.readFileSync(path.join(repo, 'scripts/dev/tauri-mock.js'), 'utf8')

const appUrl = (extra = '') => {
  const url = new URL(extra || '/', base)
  if (variant) url.searchParams.set('variant', variant)
  return url.toString()
}

// One step of a surface's script. A step is an object with one action key; `optional:
// true` lets a surface go on when that step fails.
async function step(page, s) {
  // The first visible match: the toolbar keeps hidden copies of its buttons for measuring.
  const loc = (sel) => page.locator(`${sel} >> visible=true`).first()
  if (s.open) return runSteps(page, catalogue.presets[s.open] ?? (() => { throw new Error(`no preset ${s.open}`) })())
  if (s.goto !== undefined) {
    await page.goto(appUrl(s.goto), { waitUntil: 'networkidle' })
    return page.evaluate(() => document.fonts.ready)
  }
  if (s.click) return loc(s.click).click({ timeout: 5000, force: Boolean(s.force) })
  if (s.dblclick) return loc(s.dblclick).dblclick({ timeout: 5000 })
  if (s.rightclick) return loc(s.rightclick).click({ button: 'right', timeout: 5000 })
  if (s.hover) return loc(s.hover).hover({ timeout: 5000 })
  if (s.focus) return loc(s.focus).focus({ timeout: 5000 })
  if (s.fill) return loc(s.fill).fill(s.value ?? '', { timeout: 5000 })
  if (s.press) return page.keyboard.press(s.press)
  if (s.type) return page.keyboard.type(s.type, { delay: 10 })
  if (s.waitFor) return loc(s.waitFor).waitFor({ timeout: s.timeout ?? 8000 })
  if (s.wait) return page.waitForTimeout(s.wait)
  if (s.eval) return page.evaluate(s.eval)
  // Choose an item in the native menu the last step popped up (see tauri-mock.js).
  if (s.menuItem) return page.evaluate((text) => window.__ibMenuClick(text), s.menuItem)
  if (s.reload) { await page.reload({ waitUntil: 'networkidle' }); return page.waitForTimeout(1200) }
  if (s.command) {
    // Run a ⌘K command by its title, as a writer would.
    await page.keyboard.press('Meta+k')
    await loc('.ib-palette-input').waitFor({ timeout: 4000 })
    await page.keyboard.type(s.command, { delay: 5 })
    await page.waitForTimeout(250)
    const option = page.locator('.ib-palette [role=option]').filter({ hasText: s.command }).first()
    await option.click({ timeout: 4000 })
    return
  }
  if (s.scroll) return page.evaluate(([sel, y]) => document.querySelector(sel)?.scrollBy(0, y), [s.scroll, s.by ?? 400])
  throw new Error(`unknown step ${JSON.stringify(s)}`)
}

async function runSteps(page, steps = []) {
  for (const s of steps) {
    try {
      await step(page, s)
      await page.waitForTimeout(s.settle ?? 350)
    } catch (error) {
      if (!s.optional) throw new Error(`${JSON.stringify(s)}: ${process.env.DEBUG ? error.message : error.message.split('\n')[0]}`)
    }
  }
}

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
    await page.clock.setFixedTime(FIXED_TIME)
    // Nothing leaves the machine: off-site requests fail, unless the surface answers them
    // with a fixture (`routes`: { "<url glob>": <JSON body> }).
    await page.route((url) => !url.href.startsWith(base) && !url.protocol.startsWith('data') && !url.protocol.startsWith('blob'), (route) => route.abort())
    for (const [glob, body] of Object.entries(surface.routes ?? {})) {
      await page.route(glob, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }))
    }
    if (surface.seed) await page.addInitScript((seed) => { window.__ibMockSeed = seed }, surface.seed)
    await page.addInitScript({ content: mock })
    await page.addInitScript(() => {
      // No blinking caret in a screenshot.
      addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style')
        style.textContent = '* { caret-color: transparent !important; }'
        document.head.append(style)
      })
    })
    await runSteps(page, surface.steps)
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
