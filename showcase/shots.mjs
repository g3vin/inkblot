/**
 * shots.mjs — every picture and loop the website shows of the app, by id.
 *
 * The website looks each one up by `id` (inkblot-site src/data/screens.ts, features.ts),
 * so an id here is a promise: renaming or removing one fails the site's build until the
 * site follows. Adding one is free.
 *
 *   id        the website's id for it
 *   kind      'still' (a picture) or 'loop' (a silent video that repeats)
 *   themes    the app themes to capture it in: 'light' (Paper) and/or 'dark' (Ink)
 *   accent    the ink, when not Ink Blue
 *   viewport  the window size in CSS pixels; its ratio is the site's aspect
 *   seconds   a loop's length (the site plays it on repeat)
 *   fixture   options for the sample book, e.g. { notes: 'research' } (fixtures/)
 *   clip      a still that keeps only part of the window: returns the rectangle
 *   run       drives the app to the moment to capture. For a loop, everything after
 *             `h.record()` is the loop; everything before is trimmed away.
 */
import { CHAPTERS, EARNEST, LIGHTHOUSE, NEXT_LINE, PROJECT, session, tile } from './fixtures/books.mjs'

/** Open a sample project and one of its documents. */
async function openChapter(page, name, project = PROJECT) {
  await page.getByText(project, { exact: true }).first().dblclick()
  await page.getByText(name, { exact: true }).first().click()
  await page.locator('.ProseMirror').first().waitFor()
  await page.waitForTimeout(1200)
}

/**
 * Open `project` from the start screen; the app restores its saved session (the shot's
 * `prefs`): the document, the inspector tab, the workbench. Then wait for `selector`.
 */
async function restored(page, selector = '.ProseMirror', project = PROJECT) {
  await page.getByText(project, { exact: true }).first().dblclick()
  await page.locator(selector).first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(1500)
}

/**
 * A rect around `boxes` with `pad` to spare, widened to the window's proportions and
 * kept inside it: what a camera move should frame.
 */
function frame(boxes, { width: W, height: H }, pad = 32) {
  let x0 = Math.min(...boxes.map((b) => b.x)) - pad
  let y0 = Math.min(...boxes.map((b) => b.y)) - pad
  let x1 = Math.max(...boxes.map((b) => b.x + b.width)) + pad
  let y1 = Math.max(...boxes.map((b) => b.y + b.height)) + pad
  const w = Math.max(x1 - x0, ((y1 - y0) * W) / H)
  const h = (w * H) / W
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  x0 = Math.min(Math.max(0, cx - w / 2), W - w)
  y0 = Math.min(Math.max(0, cy - h / 2), H - h)
  return { x: x0, y: y0, width: w, height: h }
}

/** Put the caret at the end of the paragraph holding `text`. */
async function caretAfter(page, text) {
  await page.locator('.ProseMirror p', { hasText: text }).first().click()
  await page.keyboard.press('End')
}

/** Type like a person: steady, with a pause after punctuation. */
async function write(page, text, { cps = 14 } = {}) {
  for (const ch of text) {
    await page.keyboard.type(ch)
    await page.waitForTimeout(/[.,;—]/.test(ch) ? 260 : 1000 / cps)
  }
}

export const SHOTS = [
  {
    id: 'editor',
    kind: 'loop',
    themes: ['light', 'dark'],
    viewport: { width: 1440, height: 900 }, // 16 / 10
    seconds: 20,
    async run(page, h) {
      await openChapter(page, CHAPTERS.pilgrims)
      await caretAfter(page, 'I’m the man of the family now Papa is away')
      await h.record()
      await page.waitForTimeout(1500)
      await page.keyboard.press('Enter')
      // Little Women's own next line, written as the writer would.
      await write(page, NEXT_LINE)
      await h.until(20)
    },
  },
  {
    id: 'editor-night',
    kind: 'still',
    themes: ['dark'],
    accent: 'amber',
    viewport: { width: 1440, height: 810 }, // 16 / 9
    async run(page) {
      // To the Lighthouse, "Time Passes": the house through a night of rain.
      await openChapter(page, 'Time Passes', LIGHTHOUSE)
      await caretAfter(page, 'So with the lamps all put out')
    },
  },
  {
    // The website's "Notes that stay with the words.": the writer's note on the March
    // parlour ("a pleasant atmosphere of home peace pervaded it"), pinned open beside the
    // phrase, with a photo of Orchard House and a voice memo.
    id: 'notes',
    kind: 'still',
    themes: ['light', 'dark'],
    // Wide enough that the text column (it stops growing) leaves a margin for the note.
    viewport: { width: 1800, height: 1000 },
    fixture: { notes: 'research' },
    async run(page) {
      await openChapter(page, CHAPTERS.pilgrims)
      await page.getByRole('button', { name: 'Hide inspector' }).click()
      await page.waitForTimeout(600)
      const marker = page.locator('.note-marker').first()
      await marker.evaluate((el) => el.scrollIntoView({ block: 'center' }))
      await page.waitForTimeout(300)
      await marker.click()
      const card = page.locator('.note-preview-card').first()
      await card.waitFor()
      await page.waitForTimeout(600)
      // The note opens beside its phrase, over the text; drag it out into the margin,
      // level with the passage, as a writer would. Its string follows.
      const column = await page.locator('.ProseMirror').first().boundingBox()
      const dot = await marker.boundingBox()
      const from = await card.boundingBox()
      const grab = { x: from.x + from.width / 2, y: from.y + 10 }
      // Level with the phrase: its line ends there, so the string runs out through open page.
      const to = { x: grab.x + (column.x + column.width + 28 - from.x), y: grab.y + (dot.y - 70 - from.y) }
      await page.mouse.move(grab.x, grab.y)
      await page.mouse.down()
      await page.mouse.move((grab.x + to.x) / 2, (grab.y + to.y) / 2, { steps: 10 })
      await page.mouse.move(to.x, to.y, { steps: 10 })
      await page.mouse.up()
      await page.mouse.move(4, 996)
      await page.waitForTimeout(900)
    },
    // The passage and its note, not the window: from the gap two paragraphs above the
    // noted one to the first break between lines below the card, like a cropped page.
    async clip(page) {
      const column = await page.locator('.ProseMirror').first().boundingBox()
      const card = await page.locator('.note-preview-card').first().boundingBox()
      const paragraphs = await page.locator('.ProseMirror p').evaluateAll((ps) => ps.map((p) => {
        const r = p.getBoundingClientRect()
        // One rect per line: the text's client rects, merged by their top.
        const range = document.createRange()
        range.selectNodeContents(p)
        const lines = []
        for (const rect of range.getClientRects()) {
          const line = lines.find((l) => Math.abs(l.top - rect.top) < 4)
          if (line) line.bottom = Math.max(line.bottom, rect.bottom)
          else if (rect.height > 4) lines.push({ top: rect.top, bottom: rect.bottom })
        }
        return { top: r.top, bottom: r.bottom, lines: lines.sort((a, b) => a.top - b.top), noted: !!p.querySelector('.note-marker') }
      }))
      const gap = (i) => (paragraphs[i - 1].bottom + paragraphs[i].top) / 2
      const noted = paragraphs.findIndex((p) => p.noted)
      const top = Math.min(gap(Math.max(1, noted - 2)), card.y - 32)
      // Every break between lines (and between paragraphs) below the noted paragraph.
      const breaks = []
      for (let i = noted; i < paragraphs.length; i++) {
        const { lines } = paragraphs[i]
        for (let k = 1; k < lines.length; k++) breaks.push((lines[k - 1].bottom + lines[k].top) / 2)
        if (i + 1 < paragraphs.length) breaks.push(gap(i + 1))
      }
      const bottom = breaks.find((y) => y >= card.y + card.height + 24) ?? card.y + card.height + 32
      const right = Math.min(card.x + card.width + 40, page.viewportSize().width - 12)
      return { x: column.x - 56, y: top, width: right - (column.x - 56), height: bottom - top }
    },
  },
  {
    id: 'review',
    kind: 'still',
    themes: ['light'],
    viewport: { width: 1680, height: 720 }, // 21 / 9
    async run(page) {
      await openChapter(page, CHAPTERS.pilgrims)
      await page.getByRole('button', { name: 'Notes', exact: true }).first().click()
      await page.waitForTimeout(800)
    },
  },
  /* ---- "The whole book, in one window": three panes, one window, the same chrome ---- */
  ...[
    ['split-prose', CHAPTERS.pilgrims, '.ProseMirror'],
    ['split-canvas', 'The Marches.canvas', '.canvas-surface'],
    ['split-map', 'Concord.map', '.map-pane, .map-surface, [class*="map-"]'],
  ].map(([id, doc, selector]) => ({
    id,
    kind: 'still',
    themes: ['light', 'dark'],
    viewport: { width: 1440, height: 900 }, // 16 / 10
    prefs: session(PROJECT, doc, { sidebarTab: 'notes' }),
    async run(page) {
      await restored(page, selector)
    },
  })),

  /* ---- The feature roster: what each one looks like at work. 4 / 3, like its frame. ---- */
  {
    id: 'timeline',
    kind: 'still',
    themes: ['light', 'dark'],
    viewport: { width: 1200, height: 900 },
    prefs: session(PROJECT, 'The year.timeline', { sidebarTab: 'timeline' }),
    async run(page) {
      await restored(page, '.timeline-surface, [class*="timeline-"]')
      // A new view opens its settings; put them away and show the whole year.
      await page.getByRole('button', { name: 'Inspector', exact: true }).filter({ visible: true }).first().click()
      await page.getByRole('button', { name: 'Show everything' }).first().click()
      await page.waitForTimeout(800)
    },
  },
  {
    id: 'history',
    kind: 'still',
    themes: ['light', 'dark'],
    viewport: { width: 1200, height: 900 },
    prefs: session(PROJECT, CHAPTERS.pilgrims, { sidebarTab: 'history' }),
    async run(page) {
      await restored(page)
      // Compare the chapter with its first draft (the oldest version, last in the list).
      await page.getByRole('button', { name: 'Compare / merge' }).filter({ visible: true }).last().click()
      await page.waitForTimeout(1500)
    },
  },
  {
    id: 'language',
    kind: 'still',
    themes: ['light', 'dark'],
    viewport: { width: 1200, height: 900 },
    prefs: session(PROJECT, CHAPTERS.pilgrims, {
      sidebarTab: 'workbench',
      tiles: [tile('synonym', 'grumbled', 3), tile('rhyme', 'rug', 2), tile('definition', 'dreadful', 1)],
    }),
    // What the on-device models answer for these words (the desktop app runs them).
    ipc: {
      get_synonyms: { synonyms: ['muttered', 'complained', 'groused', 'griped', 'moaned', 'protested', 'whined', 'carped'], antonyms: ['rejoiced', 'praised'] },
      get_rhymes: { rhymes: ['hug', 'snug', 'shrug', 'mug', 'tug', 'jug', 'smug', 'dug'] },
      download_rhyme_dictionary: null,
    },
    // The definition tile asks dictionaryapi.dev; this is Webster's 1913 entry, public domain.
    routes: [{ url: 'https://api.dictionaryapi.dev/**', json: [{ word: 'dreadful', meanings: [{ partOfSpeech: 'adjective', definitions: [{ definition: 'Inspiring dread; impressing great fear; fearful; terrible.' }] }] }] }],
    async run(page) {
      await restored(page)
    },
  },
  {
    id: 'bubble',
    kind: 'still',
    themes: ['light', 'dark'],
    viewport: { width: 1200, height: 900 },
    prefs: session(PROJECT, CHAPTERS.pilgrims),
    async run(page) {
      await restored(page)
      // Right-click in a paragraph, then Bubble paragraph: one bubble per sentence.
      const paragraph = page.locator('.ProseMirror p', { hasText: 'It’s so dreadful to be poor' }).first()
      await paragraph.click()
      await paragraph.click({ button: 'right' })
      await page.waitForTimeout(500)
      // A right-click in WebKit selects across the paragraph's end; the shell's menu is
      // modal and leaves the caret where it was, so put it back before choosing.
      await paragraph.click()
      await page.evaluate(() => window.__SHOWCASE_MENU__.choose('Bubble paragraph'))
      await page.waitForTimeout(1200)
      // Word by word: the roster's line for it.
      await page.getByText('Words', { exact: true }).filter({ visible: true }).first().click()
      await page.waitForTimeout(1200)
    },
  },
  {
    id: 'screenplays',
    kind: 'still',
    themes: ['light', 'dark'],
    viewport: { width: 1200, height: 900 },
    prefs: session(EARNEST, 'Act One'),
    async run(page) {
      await restored(page, '.ProseMirror', EARNEST)
    },
  },
  {
    id: 'references',
    kind: 'still',
    themes: ['light', 'dark'],
    viewport: { width: 1200, height: 900 },
    prefs: session(PROJECT, CHAPTERS.pilgrims, { sidebarTab: 'references' }),
    async run(page) {
      await restored(page)
      // The project's library, not just what this chapter cites.
      await page.getByText('This document', { exact: true }).first().click()
      await page.getByText('This project', { exact: true }).first().click()
      await page.waitForTimeout(800)
    },
  },
  /* ---- "Color it in.": every window colour, then a note takes a new ink. ---- */
  {
    id: 'inks',
    kind: 'loop',
    themes: ['light', 'dark'],
    viewport: { width: 1440, height: 900 }, // 16 / 10
    seconds: 16.5,
    prefs: session(PROJECT, CHAPTERS.pilgrims, { sidebarTab: 'notes' }),
    async run(page, h) {
      await restored(page)
      const card = page.locator('.note-tile').first()
      await card.waitFor()
      await h.record()

      // The window colour (Settings → Window colour), through every ink and back to Sage.
      // The setting is the root's data-tray, exactly as lib/theme.ts sets it.
      const trays = ['blue', 'teal', 'green', 'amber', 'rust', 'red', 'violet', 'slate', 'sage']
      for (const [i, ink] of trays.entries()) {
        await h.until(0.8 + i * 0.85)
        await page.evaluate((id) => {
          if (id === 'sage') document.documentElement.removeAttribute('data-tray')
          else document.documentElement.setAttribute('data-tray', id)
        }, ink)
      }

      // In close on the first note and the place it's pinned (its marker).
      const highlight = await page.locator('.note-marker').first().boundingBox()
      const tile = await card.boundingBox()
      await h.until(8.4)
      h.zoom(frame([tile, highlight], page.viewportSize(), 48), 1.2)

      // Press its colour: the inks bloom. Swipe to Teal and let go: note and phrase take it.
      await h.until(10)
      await card.hover()
      const dot = await card.getByRole('button', { name: /^Note colour/ }).first().boundingBox()
      await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2)
      await page.mouse.down()
      await page.waitForTimeout(700)
      const teal = await page.locator('.ib-ink-wheel-ring [role="option"][aria-label="Teal"]').first().boundingBox()
      await page.mouse.move(teal.x + teal.width / 2, teal.y + teal.height / 2, { steps: 24 })
      await page.waitForTimeout(500)
      await page.mouse.up()
      await page.mouse.move(4, page.viewportSize().height - 4)

      await h.until(13.5)
      h.zoomOut(1.2)
      await h.until(16.5)
    },
  },
]
