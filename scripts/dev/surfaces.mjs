/**
 * surfaces.mjs — what capture.mjs and measure.mjs share: the surface catalogue
 * (design-review/surfaces.json), the browser sizes, and opening a surface on a fresh
 * page the same way every time.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const base = process.env.BASE_URL || 'http://localhost:5173'
export const catalogue = JSON.parse(fs.readFileSync(path.join(repo, 'design-review/surfaces.json'), 'utf8'))

export const VIEWPORTS = {
  desktop: { viewport: { width: 1400, height: 900 } },
  ipad: {
    viewport: { width: 820, height: 1180 },
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  },
}
export const THEMES = ['light', 'dark']
const FIXED_TIME = new Date('2026-10-01T10:00:00')
const mock = fs.readFileSync(path.join(repo, 'scripts/dev/tauri-mock.js'), 'utf8')

/** The command line: `opt('run')` is one value, `opts('only')` every value (comma lists too). */
export function cli(args = process.argv.slice(2)) {
  const opt = (name, fallback) => {
    const i = args.indexOf(`--${name}`)
    return i >= 0 ? args[i + 1] : fallback
  }
  const opts = (name) => args.flatMap((a, i) => (a === `--${name}` ? args[i + 1].split(',') : []))
  return { args, opt, opts }
}

/** The surfaces whose id matches one of the globs (all of them with none). */
export function pick(globs) {
  const res = globs.map((g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`))
  return catalogue.surfaces.filter((s) => !res.length || res.some((re) => re.test(s.id)))
}

export async function launch() {
  const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core')
  return chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
}

/**
 * Get a fresh page ready for a surface: the fixed clock, seeded random numbers,
 * off-site requests blocked (unless the surface answers them with a fixture, `routes`),
 * its `seed`, the Tauri mock, and no blinking caret. `variant` opens the app with ?variant=….
 */
export async function preparePage(page, surface, { variant } = {}) {
  await page.clock.setFixedTime(FIXED_TIME)
  await page.route((url) => !url.href.startsWith(base) && !url.protocol.startsWith('data') && !url.protocol.startsWith('blob'), (route) => route.abort())
  for (const [glob, body] of Object.entries(surface.routes ?? {})) {
    await page.route(glob, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }))
  }
  // The same random numbers every run: maps draw their stars and galaxies from Math.random.
  await page.addInitScript(() => {
    let state = 0x2f6b
    Math.random = () => {
      state = (state + 0x6d2b79f5) | 0
      let t = Math.imul(state ^ (state >>> 15), 1 | state)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  })
  if (surface.seed) await page.addInitScript((seed) => { window.__ibMockSeed = seed }, surface.seed)
  await page.addInitScript({ content: mock })
  await page.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style')
      style.textContent = '* { caret-color: transparent !important; }'
      document.head.append(style)
    })
  })
  const appUrl = (extra = '') => {
    const url = new URL(extra || '/', base)
    if (variant) url.searchParams.set('variant', variant)
    return url.toString()
  }
  return (steps) => runSteps(page, steps, appUrl)
}

// One step of a surface's script. A step is an object with one action key; `optional:
// true` lets a surface go on when that step fails.
async function step(page, s, appUrl) {
  // The first visible match: the toolbar keeps hidden copies of its buttons for measuring.
  const loc = (sel) => page.locator(`${sel} >> visible=true`).first()
  if (s.open) return runSteps(page, catalogue.presets[s.open] ?? (() => { throw new Error(`no preset ${s.open}`) })(), appUrl)
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

async function runSteps(page, steps = [], appUrl) {
  for (const s of steps) {
    try {
      await step(page, s, appUrl)
      await page.waitForTimeout(s.settle ?? 350)
    } catch (error) {
      if (!s.optional) throw new Error(`${JSON.stringify(s)}: ${process.env.DEBUG ? error.message : error.message.split('\n')[0]}`, { cause: error })
    }
  }
}
