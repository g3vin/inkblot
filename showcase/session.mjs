/**
 * session.mjs — the app, served and opened in WebKit with the showcase mock and a
 * fixture project, ready for a shot to drive. Used by capture.mjs.
 *
 * Serves a production build (`vite build` into showcase/.dist, then `vite preview`), so
 * captures show what ships; `dev: true` serves the dev server instead, for quick work on
 * a shot. WebKit is the engine both shells run.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const repo = path.resolve(here, '..')

export async function loadPlaywright() {
  try {
    return await import(process.env.PLAYWRIGHT_CORE || 'playwright-core')
  } catch {
    console.error('playwright-core is not installed. Run:\n  npm i --no-save playwright-core && npx playwright-core install webkit')
    process.exit(2)
  }
}

/** Start the app's server. Returns { url, close }. */
export async function serve({ dev = false } = {}) {
  const vite = await import('vite')
  if (dev) {
    const server = await vite.createServer({ root: repo, logLevel: 'error', server: { port: 0 } })
    await server.listen()
    return { url: server.resolvedUrls.local[0], close: () => server.close() }
  }
  const outDir = path.join(here, '.dist')
  await vite.build({ root: repo, logLevel: 'warn', build: { outDir, emptyOutDir: true } })
  const server = await vite.preview({ root: repo, logLevel: 'error', build: { outDir }, preview: { port: 0 } })
  return { url: server.resolvedUrls.local[0], close: () => new Promise((done) => server.httpServer.close(done)) }
}

const MOCK = fs.readFileSync(path.join(here, 'tauri-mock.js'), 'utf8')

/** A frozen moment for every capture, so dates and "edited 2 min ago" never change. */
export const NOW = '2026-10-21T09:00:00Z'

/**
 * A fresh page on `url` with `files` seeded and `prefs` loaded. Determinism: the clock
 * is installed at NOW and Math.random is seeded, so the same build gives the same frames.
 */
export async function openPage(browser, url, { files, prefs = {}, ipc = {}, routes = [], viewport, scale = 2, video, log = false }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: scale,
    colorScheme: prefs['inkblot-theme'] === 'dark' ? 'dark' : 'light',
    reducedMotion: 'no-preference',
    ...(video ? { recordVideo: { dir: video, size: viewport } } : {}),
  })
  await context.clock.install({ time: new Date(NOW) })
  // Network the app reaches for (a dictionary, say), answered from the shot.
  for (const { url: pattern, json } of routes) {
    await context.route(pattern, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) }))
  }
  await context.addInitScript({
    content: `
      window.__SHOWCASE__ = ${JSON.stringify({ files, prefs, ipc, now: NOW, log })};
      (() => { let s = 0x2f4a8a; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } })();
      ${MOCK}`,
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => { errors.push(error.message); if (log) console.log(`  [page error] ${error.stack}`) })
  if (log) page.on('console', (m) => console.log(`  [page] ${m.text()}`))
  await page.goto(url, { waitUntil: 'networkidle' })
  return { context, page, errors }
}
