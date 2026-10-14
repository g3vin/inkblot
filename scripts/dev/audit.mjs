#!/usr/bin/env node
/**
 * audit.mjs — screenshot every surface for a UI audit: the landing page, the editor,
 * every inspector tab in both layouts (Write and Typeset), the left sidebar's Files
 * and Book, ⌘K, Settings and project search.
 *
 *   npm i --no-save playwright-core
 *   npm run dev                                   # in another terminal
 *   node scripts/dev/audit.mjs out/audit light
 *   node scripts/dev/audit.mjs out/audit dark
 *
 * Writes <dir>/<theme>-<NN>-<surface>.png, the inspector tabs both cropped to the
 * panel and full window. Runs against scripts/dev/tauri-mock.js, as screenshot.mjs
 * does, and takes the same BASE_URL, CHROMIUM and PLAYWRIGHT_CORE settings.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const [outDir = 'audit', theme = 'light'] = process.argv.slice(2)
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const base = process.env.BASE_URL || 'http://localhost:5173'
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core')
fs.mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: theme, deviceScaleFactor: 2 })
await page.addInitScript({ content: fs.readFileSync(`${repo}/scripts/dev/tauri-mock.js`, 'utf8') })
page.on('pageerror', (e) => console.log('page error:', e.message))
const shot = async (name, el) => {
  const p = `${outDir}/${theme}-${name}.png`
  try { el ? await page.locator(el).first().screenshot({ path: p }) : await page.screenshot({ path: p }) ; console.log('ok', name) }
  catch (e) { console.log('FAIL', name, e.message.split('\n')[0]) }
}
const tryDo = async (label, fn) => { try { await fn() } catch (e) { console.log('skip', label, e.message.split('\n')[0]) } }
const wait = (ms = 700) => page.waitForTimeout(ms)

await page.goto(base, { waitUntil: 'networkidle' }); await wait(1500)
await shot('00-landing')
await page.getByText('Novel', { exact: true }).first().dblclick(); await wait(1500)
await page.getByText('Chapter one', { exact: true }).first().click(); await wait(2000)
await shot('01-editor')

const tabs = async (prefix) => {
  const labels = await page.$$eval('.right-sidebar .inspector-header button[aria-label]', (bs) => bs.map((b) => b.getAttribute('aria-label')))
  console.log(prefix, 'tabs:', labels)
  for (const label of labels) {
    if (label.startsWith('Switch to')) continue
    await tryDo(label, async () => {
      await page.locator(`.right-sidebar .inspector-header button[aria-label="${label}"]`).click({ timeout: 3000 }); await wait(900)
      const slug = label.toLowerCase().replace(/[^a-z]+/g, '-')
      await shot(`${prefix}-${slug}`, '.right-sidebar')
      await shot(`${prefix}-${slug}-full`)
    })
  }
}
await tabs('10-write')
await tryDo('layout switch', async () => { await page.locator('.inspector-layout-switch').click(); await wait(1500) })
await shot('20-typeset-full')
await tabs('21-typeset')
await tryDo('back to write', async () => { await page.locator('.inspector-layout-switch').click(); await wait(1200) })

// Left sidebar tabs
await tryDo('left tabs', async () => {
  const labels = await page.$$eval('.left-sidebar button[aria-label]', (bs) => bs.map((b) => b.getAttribute('aria-label')))
  console.log('left buttons:', labels)
  await shot('30-left', '.left-sidebar')
  const book = page.locator('.left-sidebar button[aria-label="Book"]')
  if (await book.count()) { await book.first().click(); await wait(900); await shot('31-left-book', '.left-sidebar') }
})
await tryDo('palette', async () => { await page.keyboard.press('Meta+k'); await wait(800); await shot('40-palette'); await page.keyboard.press('Escape'); await wait(400) })
await tryDo('settings', async () => { await page.keyboard.press('Meta+,'); await wait(1000); await shot('41-settings'); await page.keyboard.press('Escape'); await wait(400) })
await tryDo('project search', async () => { await page.keyboard.press('Meta+Shift+f'); await wait(1000); await shot('42-search'); await page.keyboard.press('Escape'); await wait(400) })
await browser.close()
