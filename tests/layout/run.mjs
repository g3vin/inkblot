/**
 * Print Layout, in real WebKit.
 *
 *   npm run test:layout
 *
 * jsdom does no layout, so `npm test` can only check pagination as a function
 * (tests/unit/print.mjs). This drives the real editor, the real PrintLayoutView and
 * the app's own CSS in WebKit — the engine both shells run — and checks what can only
 * be seen in a laid-out page:
 *
 *   · no line of text falls outside a page's text block, on Letter and on a mirrored
 *     6 × 9 book, mid-paragraph breaks and table rows included
 *   · where pages break does not depend on the zoom
 *   · ↑/↓ cross from the foot of one page to the head of the next, and back
 *   · typing at a page boundary reflows and settles
 *   · the printed pages hold exactly the lines the screen showed, none cut
 *   · binding imposes the right number of sheets
 *   · a 300-page manuscript paginates in a pass short enough to run as you type
 *
 * Needs `playwright-core` and its WebKit build, which are not project dependencies:
 *
 *   npm i --no-save playwright-core && npx playwright-core install webkit
 *
 * or, with a copy installed elsewhere, PLAYWRIGHT_CORE=/path/to/playwright-core/index.mjs.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../..')

let webkit
try {
  // PLAYWRIGHT_CORE may point at a copy installed elsewhere, to keep it out of the
  // project's node_modules.
  ({ webkit } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core'))
} catch {
  console.error('playwright-core is not installed. Run:\n  npm i --no-save playwright-core && npx playwright-core install webkit')
  process.exit(2)
}

const { createServer } = await import('vite')
const react = (await import('@vitejs/plugin-react')).default
const server = await createServer({
  root: here,
  configFile: false,
  plugins: [react()],
  logLevel: 'error',
  server: { port: 0, fs: { allow: [repo] } },
})
await server.listen()
const base = server.resolvedUrls.local[0]

const ok = (label, condition, detail = '') => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${!condition && detail ? `  — ${detail}` : ''}`)
  if (!condition) process.exitCode = 1
}

/* ---------------- content ---------------- */

const WORDS = 'the quick brown fox jumps over a lazy dog while writers draft chapters of long novels in quiet rooms'.split(' ')
const manuscript = (paragraphs, seed = 1, { table = false } = {}) => {
  let s = seed
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
  const para = () => Array.from({ length: 20 + Math.floor(rnd() * 160) }, () => WORDS[Math.floor(rnd() * WORDS.length)]).join(' ')
  let html = ''
  for (let i = 0; i < paragraphs; i += 1) {
    if (i % 17 === 0) html += `<h1>Chapter ${i / 17 + 1}</h1>`
    else if (i % 9 === 0) html += `<h2>Section ${i}</h2>`
    html += `<p>${para()}</p>`
    if (i === 12) html += `<ul><li><p>${para()}</p></li><li><p>${para()}</p></li></ul>`
    if (i === 20) html += `<blockquote><p>${para()}</p></blockquote>`
    if (table && i === 25) {
      html += `<table><tr><th><p>Row</p></th><th><p>Text</p></th></tr>${
        Array.from({ length: 30 }, (_, k) => `<tr><td><p>row ${k}</p></td><td><p>${para().slice(0, 70)}</p></td></tr>`).join('')}</table>`
    }
    if (i === 30) html += '<div data-page-break="recto"></div>'
  }
  return html
}

const BOOK = {
  presetId: 'trade-6x9', widthMm: 152.4, heightMm: 228.6, orientation: 'portrait',
  margins: { topMm: 19.05, bottomMm: 19.05, insideMm: 15.875, outsideMm: 15.875, gutterMm: 3.175 },
  mirrorMargins: true, columns: 1, columnGapMm: 6.35,
  header: { left: '', center: '{chapter}', right: '' },
  versoHeader: { left: '', center: '{title}', right: '' },
  footer: { left: '', center: '{page}', right: '' },
  headerDistanceMm: 9.525, footerDistanceMm: 9.525, differentFirstPage: true,
  pageNumberStart: 1, pageNumberFormat: 'arabic', widowOrphanLines: 2, chapterStartsOnRecto: true,
}

/* ---------------- page helpers ---------------- */

const browser = await webkit.launch()

const open = async (content, { zoom = 1, setup = null } = {}) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } })
  page.on('pageerror', (e) => ok(`no page error (${e.message})`, false))
  await page.addInitScript((c) => { window.__content = c }, content)
  await page.goto(`${base}?zoom=${zoom}&setup=${encodeURIComponent(JSON.stringify(setup))}`)
  await page.waitForFunction(() => window.__print?.editor && window.__print.paginationKey.getState(window.__print.editor.state)?.result, null, { timeout: 30000 })
  await settle(page)
  return page
}

const pushesOf = (page) => page.evaluate(() => {
  const { editor, paginationKey } = window.__print
  return JSON.stringify(paginationKey.getState(editor.state).pushes.map((p) => `${p.kind}${p.pos}:${p.height.toFixed(1)}`))
})

async function settle(page) {
  let last = ''
  for (let i = 0; i < 60; i += 1) {
    await page.waitForTimeout(120)
    const now = await pushesOf(page)
    if (now === last) return
    last = now
  }
}

/** Every line of text, and whether it lies inside some page's text block. */
const linesOutsidePages = (page) => page.evaluate(() => {
  const stage = document.querySelector('.pl-stage')
  const z = stage.getBoundingClientRect().width / stage.offsetWidth
  const cs = getComputedStyle(stage)
  const top = parseFloat(cs.getPropertyValue('--pl-content-top')) * z
  const h = parseFloat(cs.getPropertyValue('--pl-content-h')) * z
  const boxes = [...document.querySelectorAll('.pl-page')].map((p) => {
    const r = p.getBoundingClientRect()
    return { top: r.top + top, bottom: r.top + top + h }
  })
  const walker = document.createTreeWalker(document.querySelector('.pl-flow .ProseMirror'), NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let lines = 0
  const outside = []
  while (walker.nextNode()) {
    range.selectNodeContents(walker.currentNode)
    for (const r of range.getClientRects()) {
      if (r.height < 1) continue
      lines += 1
      if (!boxes.some((b) => r.top >= b.top - 0.6 && r.bottom <= b.bottom + 0.6)) outside.push(walker.currentNode.textContent.slice(0, 24))
    }
  }
  return { pages: boxes.length, lines, outside }
})

/* ---------------- 1. breaks: Letter, a mirrored book, tables ---------------- */

{
  const page = await open(manuscript(80, 1, { table: true }))
  const r = await linesOutsidePages(page)
  ok(`Letter: all ${r.lines} lines on ${r.pages} pages lie inside a text block`, r.outside.length === 0, r.outside.join(' | '))
  const lineSplits = await page.evaluate(() => window.__print.paginationKey.getState(window.__print.editor.state).pushes.filter((p) => p.kind === 'line').length)
  ok('Letter: paragraphs are split across pages, not only moved whole', lineSplits > 5)
  const again = await page.evaluate(() => {
    const { editor, paginationKey, computePushes } = window.__print
    const state = paginationKey.getState(editor.state)
    const fresh = computePushes(editor.view, state).pushes
    return fresh.length === state.pushes.length && fresh.every((p, i) => p.pos === state.pushes[i].pos && Math.abs(p.height - state.pushes[i].height) < 0.75)
  })
  ok('Letter: a settled layout measures to the same breaks again (no oscillation)', again)
  await page.close()
}
{
  const page = await open(manuscript(80, 2, { table: true }), { setup: BOOK })
  const r = await linesOutsidePages(page)
  ok(`6 × 9 mirrored: all ${r.lines} lines on ${r.pages} pages lie inside a text block`, r.outside.length === 0, r.outside.join(' | '))
  await page.close()
}

/* ---------------- 2. zoom does not move a break ---------------- */

{
  const content = manuscript(60, 3)
  const a = await open(content, { zoom: 0.5 })
  const b = await open(content, { zoom: 1.75 })
  ok('the same breaks at 50% and 175% zoom', (await pushesOf(a)) === (await pushesOf(b)))
  await a.close()
  await b.close()
}

/* ---------------- 3. the caret across a page boundary ---------------- */

{
  const words = Array.from({ length: 12 }, (_, i) => `<p>${WORDS.concat(WORDS, WORDS, WORDS, WORDS, WORDS, WORDS, WORDS).slice(i).join(' ')}</p>`).join('')
  const page = await open(words)
  const boundary = await page.evaluate(() => {
    const { editor, paginationKey } = window.__print
    return paginationKey.getState(editor.state).pushes.find((p) => p.kind === 'line')?.pos ?? null
  })
  ok('a paragraph is split across the first page boundary', boundary != null)
  const head = () => page.evaluate(() => window.__print.editor.state.selection.head)
  const pageOfHead = () => page.evaluate(() => {
    const { editor } = window.__print
    const c = editor.view.coordsAtPos(editor.state.selection.head)
    const pages = [...document.querySelectorAll('.pl-page')].map((p) => p.getBoundingClientRect())
    return pages.findIndex((r) => c.top >= r.top && c.top <= r.bottom) + 1
  })
  // Click on the last line of page 1, just before the split.
  const at = await page.evaluate((pos) => {
    const v = window.__print.editor.view
    const sc = document.querySelector('.pane-scroll')
    sc.scrollTop += v.coordsAtPos(pos - 5).top - 400
    const c = v.coordsAtPos(pos - 5)
    return { x: c.left, y: (c.top + c.bottom) / 2 }
  }, boundary)
  await page.mouse.click(at.x, at.y)
  const start = await head()
  ok('the caret starts on page 1', (await pageOfHead()) === 1)
  await page.keyboard.press('ArrowDown')
  ok('↓ from the foot of page 1 lands on page 2', (await pageOfHead()) === 2 && (await head()) > start)
  await page.keyboard.press('ArrowUp')
  ok('↑ from the head of page 2 comes back to the same place on page 1', (await pageOfHead()) === 1 && (await head()) === start)

  // Type at the boundary: the page must reflow and settle.
  await page.keyboard.type(' more words here to push the text along a line or two ')
  await settle(page)
  const r = await linesOutsidePages(page)
  ok('typing at a page boundary reflows it and settles', r.outside.length === 0, r.outside.join(' | '))
  await page.close()
}

/* ---------------- 4. what prints is what was shown ---------------- */

for (const [label, setup] of [['Letter', null], ['6 × 9 mirrored', BOOK]]) {
  const page = await open(manuscript(50, 4, { table: true }), { zoom: 0.75, setup })
  const result = await page.evaluate(async () => {
    const { editor, preparePrint } = window.__print
    const stage = document.querySelector('.pl-stage')
    const z = stage.getBoundingClientRect().width / stage.offsetWidth
    const cs = getComputedStyle(stage)
    const ct = parseFloat(cs.getPropertyValue('--pl-content-top'))
    const ch = parseFloat(cs.getPropertyValue('--pl-content-h'))
    const textRects = (root) => {
      const out = []
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      const rg = document.createRange()
      while (w.nextNode()) {
        if (w.currentNode.parentElement.closest('.pl-running')) continue
        rg.selectNodeContents(w.currentNode)
        for (const r of rg.getClientRects()) if (r.height > 1) out.push(r)
      }
      return out
    }
    const live = textRects(document.querySelector('.pl-flow .ProseMirror'))
    const liveCounts = [...document.querySelectorAll('.pl-page')].map((pg) => {
      const t = pg.getBoundingClientRect().top + ct * z
      return new Set(live.filter((r) => r.top >= t - 1 && r.bottom <= t + ch * z + 1).map((r) => Math.round((r.top - t) / z))).size
    })
    const prepared = await preparePrint({ projectName: 'x', docPath: 'Harness', scope: 'document', liveEditors: [{ path: 'Harness', editor }] })
    const root = document.createElement('div')
    root.id = 'print-root'
    root.className = 'print-scope'
    root.style.cssText = 'display:block;position:absolute;left:0;top:0'
    prepared.elements.forEach((el) => root.appendChild(el))
    document.body.appendChild(root)
    let cut = 0
    const cuts = []
    const printCounts = prepared.elements.map((pg) => {
      const lines = new Set()
      const top = pg.getBoundingClientRect().top + ct
      for (const clip of pg.querySelectorAll('.print-clip')) {
        const c = clip.getBoundingClientRect()
        for (const r of textRects(clip)) {
          if (r.bottom <= c.top || r.top >= c.bottom) continue
          if (r.top < top - 1 || r.bottom > top + ch + 1) {
            cut += 1
            cuts.push({ page: prepared.elements.indexOf(pg) + 1, top: Math.round(r.top - top), bottom: Math.round(r.bottom - top) })
          }
          else lines.add(Math.round(r.top - top))
        }
      }
      return lines.size
    })
    root.remove()
    return { liveCounts, printCounts, cut, size: [prepared.widthPx, prepared.heightPx], detail: cuts }
  })
  ok(`${label}: every printed page holds exactly the lines its screen page did`,
    JSON.stringify(result.liveCounts) === JSON.stringify(result.printCounts),
    `${result.liveCounts} vs ${result.printCounts}`)
  ok(`${label}: no printed line is cut by the page`, result.cut === 0, `${result.cut} cut ${JSON.stringify(result.detail || [])}`)
  await page.close()
}

/* ---------------- 5. binding ---------------- */

{
  const page = await open(manuscript(60, 5), { setup: BOOK })
  const r = await page.evaluate(async () => {
    const { editor, preparePrint } = window.__print
    const book = { title: 'T', author: 'A', binding: { binding: 'signatures', sheetsPerSignature: 4, sheetPresetId: 'letter', sheetFit: 'actualSize', duplex: 'automatic', paperThicknessMm: 0.1, cropMarks: true, includeGuide: true } }
    const prepared = await preparePrint({ projectName: 'x', docPath: 'Harness', scope: 'document', bound: true, liveEditors: [{ path: 'Harness', editor }], book })
    return { pages: prepared.pageCount, sheets: prepared.elements.length, w: prepared.widthPx, h: prepared.heightPx }
  })
  const expected = Math.ceil(r.pages / 16) * 4 * 2 + 1
  ok(`binding: ${r.pages} pages in 16-page signatures are ${expected - 1} sheet sides and a folding guide`, r.sheets === expected, `${r.sheets}`)
  ok('binding: sheets are landscape Letter', Math.round(r.w) === 1056 && Math.round(r.h) === 816)
  await page.close()
}

/* ---------------- 6. a whole manuscript ---------------- */

{
  const page = await open(manuscript(1100, 6))
  const r = await page.evaluate(() => {
    const { editor, paginationKey, computePushes } = window.__print
    const state = paginationKey.getState(editor.state)
    const t = performance.now()
    computePushes(editor.view, state)
    return { pages: state.result.pageCount, ms: performance.now() - t }
  })
  ok(`a ${r.pages}-page manuscript paginates in ${Math.round(r.ms)}ms (budget 250ms)`, r.pages > 250 && r.ms < 250)
  await page.close()
}

await browser.close()
await server.close()
console.log(process.exitCode ? '\nPrint Layout: FAILURES' : '\nPrint Layout: all checks passed.')
