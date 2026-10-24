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
 * The pointer, drawn into the page: a recording has no system cursor, and a drag or a
 * click with no hand on screen reads as the window moving by itself. It follows the
 * mouse Playwright moves, and takes no events (elementFromPoint looks through it).
 */
const CURSOR = `
  addEventListener('DOMContentLoaded', () => {
    const hand = document.createElement('div')
    hand.setAttribute('aria-hidden', 'true')
    hand.innerHTML = '<svg width="22" height="30" viewBox="0 0 22 30"><path d="M3 2.5v21.2l5.2-5 3.6 8.4 3.6-1.6-3.5-8.2h7.3z" fill="#111" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/></svg>'
    Object.assign(hand.style, { position: 'fixed', left: '-3px', top: '-2px', zIndex: '2147483647', pointerEvents: 'none', filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,.35))', transform: 'translate(-60px, -60px)', transformOrigin: '3px 2px' })
    document.documentElement.appendChild(hand)
    let x = -60, y = -60, down = false
    const place = () => { hand.style.transform = 'translate(' + x + 'px, ' + y + 'px)' + (down ? ' scale(0.88)' : '') }
    addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; place() }, true)
    addEventListener('mousedown', () => { down = true; place() }, true)
    addEventListener('mouseup', () => { down = false; place() }, true)
  })`

/**
 * A fresh page on `url` with `files` seeded and `prefs` loaded. Determinism: the clock
 * is installed at NOW and Math.random is seeded, so the same build gives the same frames.
 * `cursor` draws the pointer in (see CURSOR).
 */
export async function openPage(browser, url, { files, prefs = {}, ipc = {}, routes = [], viewport, scale = 2, video, cursor = false, log = false }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: scale,
    colorScheme: ['dark', 'midnight'].includes(prefs['inkblot-theme']) ? 'dark' : 'light',
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
      ${MOCK}
      ${cursor ? CURSOR : ''}`,
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => { errors.push(error.message); if (log) console.log(`  [page error] ${error.stack}`) })
  if (log) page.on('console', (m) => console.log(`  [page] ${m.text()}`))
  await page.goto(url, { waitUntil: 'networkidle' })
  return { context, page, errors }
}
