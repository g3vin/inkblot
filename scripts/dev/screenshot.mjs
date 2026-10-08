#!/usr/bin/env node
/**
 * screenshot.mjs — look at the real app (or the ?design showcase) in a headless browser.
 *
 *   npm i --no-save playwright-core
 *   npm run dev                                   # in another terminal
 *   node scripts/dev/screenshot.mjs out/app dark              # welcome window → editor
 *   node scripts/dev/screenshot.mjs out/ds light --design     # the showcase
 *
 * Writes <prefix>-landing.png, -editor.png and -scrolled.png (or -design.png). The page
 * runs against scripts/dev/tauri-mock.js, so it needs no desktop shell. Environment:
 * BASE_URL (default http://localhost:5173), CHROMIUM (a Chromium binary, if Playwright's
 * own is not installed), PLAYWRIGHT_CORE (path to playwright-core's index.mjs).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const [prefix = 'screenshot', theme = 'dark', ...flags] = process.argv.slice(2)
const base = process.env.BASE_URL || 'http://localhost:5173'
const here = path.dirname(fileURLToPath(import.meta.url))
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core')

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: theme })
await page.addInitScript({ content: fs.readFileSync(path.join(here, 'tauri-mock.js'), 'utf8') })
page.on('pageerror', (error) => console.log('page error:', error.message))

if (flags.includes('--design')) {
  await page.goto(`${base}/?design`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${prefix}-design.png` })
} else {
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${prefix}-landing.png` })
  await page.getByText('Novel', { exact: true }).first().dblclick()
  await page.waitForTimeout(1500)
  await page.getByText('Chapter one', { exact: true }).first().click()
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${prefix}-editor.png` })
  await page.evaluate(() => document.querySelector('.pane-scroll')?.scrollBy(0, 200))
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${prefix}-scrolled.png` })
}
await browser.close()
