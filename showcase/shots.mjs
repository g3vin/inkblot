/**
 * shots.mjs — every picture and loop the website shows of the app, by id.
 *
 * The website looks each one up by `id` (inkblot-site src/data/screens.ts, features.ts),
 * so an id here is a promise: renaming or removing one fails the site's build until the
 * site follows. Adding one is free.
 *
 *   id        the website's id for it
 *   kind      'still' (a picture), 'loop' (a silent video that repeats) or 'sequence'
 *             (a recording's frames, for the site to play by scrolling)
 *   themes    the app themes to capture it in: 'light' (Paper), 'dark' (Ink), 'midnight'
 *   accent    the ink, when not Ink Blue
 *   viewport  the window size in CSS pixels; its ratio is the site's aspect
 *   seconds   a loop's or sequence's length
 *   seam      a loop's crossfade from its end into its start; 0 when it ends as it began
 *   cursor    draw the pointer in: for a shot whose story is a hand at work
 *   rest      a loop's mark whose frame stands in for it without motion
 *   fixture   options for the sample book, e.g. { notes: 'research' } (fixtures/)
 *   clip      a still that keeps only part of the window: returns the rectangle
 *   run       drives the app to the moment to capture. For a loop, everything after
 *             `h.record()` is the loop; everything before is trimmed away. h.glide moves
 *             the pointer like a hand, h.mark notes when a step happens, h.focus says
 *             what a sequence keeps.
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

const centre = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })

/** A document's row in the file tree, where a hand would take hold of it. */
async function treeRow(page, docPath) {
  const box = await page.locator(`.file-item[data-entry-path="${docPath}"]`).first().boundingBox()
  return { x: box.x + 48, y: box.y + box.height / 2 }
}

/** A click where the pointer is, as a hand makes one. */
async function press(page) {
  await page.mouse.down()
  await page.waitForTimeout(90)
  await page.mouse.up()
}

/**
 * Carry `docPath` out of the file tree to `to` on the page and hold it there until the
 * split opens under it (`opened`), then let go: the app's drag-to-split. Returns when
 * the split opened, for the shot's marks.
 */
async function carry(page, h, docPath, to, opened) {
  await h.glide(await treeRow(page, docPath), 0.9)
  await page.waitForTimeout(200)
  await page.mouse.down()
  const from = await treeRow(page, docPath)
  await h.glide({ x: from.x + 10, y: from.y + 3 }, 0.15)
  await h.glide(to, 1.1)
  await page.locator(opened).first().waitFor({ timeout: 5000 })
  const at = Date.now()
  await page.waitForTimeout(450)
  await page.mouse.up()
  return at
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
    // Midnight: the app's pure black, for the site's "how it feels at night".
    themes: ['midnight'],
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
  /*
   * ---- "The whole story, in one window": the hero. One chapter; drag the cast canvas
   * out of the file tree onto the page and hold it, and the window splits; drag the map
   * onto the chapter's side, then the galaxy over the map; back to the chapter (the tree
   * keeps the split) and close the split. Everything is the app's own motion, with the pointer
   * drawn in. It ends as it began, so it repeats with no crossfade. ----
   */
  {
    id: 'hero',
    kind: 'loop',
    themes: ['light', 'dark'],
    viewport: { width: 1440, height: 900 }, // 16 / 10
    seconds: 21,
    seam: 0,
    cursor: true,
    rest: 'rest',
    prefs: session(PROJECT, CHAPTERS.pilgrims, { sidebarTab: 'notes' }),
    async run(page, h) {
      await restored(page)
      // At rest, the pointer waits in the page's right margin.
      const home = { x: 1100, y: 700 }
      await h.point(home)
      await page.waitForTimeout(400)
      await h.record()
      h.mark('one')

      await h.until(1)
      const page1 = await page.locator('.pane').first().boundingBox()
      h.mark('canvas', await carry(page, h, 'The Marches.canvas', { x: page1.x + page1.width * 0.78, y: 470 }, '.secondary-pane .canvas-surface'))
      await h.glide({ x: 900, y: 760 }, 0.9)

      await h.until(5.8)
      const left = await page.locator('.pane.primary-pane').first().boundingBox()
      h.mark('map', await carry(page, h, 'Concord.map', { x: left.x + left.width * 0.45, y: 470 }, '.primary-pane .map-surface'))
      await h.glide({ x: 900, y: 780 }, 0.9)
      await h.until(11.2)
      h.mark('rest')

      // The sky over them: the galaxy takes the map's side (on a map, its outer edge).
      await h.until(11.4)
      const map = await page.locator('.pane.primary-pane').first().boundingBox()
      h.mark('any', await carry(page, h, 'The Milky Way.map', { x: map.x + 44, y: 470 }, '.primary-pane .map-space:not(.is-loading)'))
      await h.glide({ x: 900, y: 780 }, 0.9)

      // Back to the chapter (the tree keeps the split, above the files), and close it.
      await h.until(16.6)
      await h.glide(await treeRow(page, CHAPTERS.pilgrims), 0.8)
      await press(page)
      await h.until(17.6)
      const entry = page.locator('.split-entry').first()
      await h.glide(centre(await entry.boundingBox()), 0.6)
      await page.waitForTimeout(250)
      await h.glide(centre(await entry.getByRole('button', { name: 'Close split' }).boundingBox()), 0.35)
      await press(page)
      h.mark('closed')
      await h.glide(home, 1)
      await h.until(21)
    },
  },

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
  /*
   * ---- "Color it in.": a window in each of the app's colours (Settings → Window colour),
   * each on a different document; the site moves them with the scroll. Sage, the
   * default, comes last: it is the first frame of `inks-wheel`. ----
   */
  ...[
    ['blue', PROJECT, 'The year.timeline', 'timeline'],
    ['teal', PROJECT, 'Concord.map', 'map'],
    ['green', PROJECT, 'The Milky Way.map', 'galaxy'],
    ['amber', PROJECT, CHAPTERS.christmas],
    ['rust', EARNEST, 'Act One'],
    ['red', PROJECT, CHAPTERS.laurence],
    ['violet', LIGHTHOUSE, 'Time Passes'],
    ['slate', LIGHTHOUSE, 'The Window'],
    ['sage', PROJECT, CHAPTERS.pilgrims],
  ].map(([ink, project, doc, kind]) => ({
    id: `inks-${ink}`,
    kind: 'still',
    themes: ['light', 'dark'],
    viewport: { width: 1440, height: 900 }, // 16 / 10
    prefs: { ...session(project, doc, { sidebarTab: kind === 'timeline' ? 'timeline' : 'notes' }), 'inkblot-tray-color': ink },
    async run(page) {
      const surface = { timeline: '.timeline-surface, [class*="timeline-"]', map: '.map-surface', galaxy: '.map-space:not(.is-loading)' }[kind] ?? '.ProseMirror'
      await restored(page, surface, project)
      // A galaxy draws its stars over a moment after its view mounts.
      if (kind === 'galaxy') await page.waitForTimeout(2500)
      if (kind === 'timeline') {
        await page.getByRole('button', { name: 'Inspector', exact: true }).filter({ visible: true }).first().click()
        await page.getByRole('button', { name: 'Show everything' }).first().click()
        await page.waitForTimeout(800)
      }
    },
  })),
  {
    // The Sage window, closer: the first note's colour pressed, the inks bloom, the hand
    // swipes to Teal and lets go, and the note and its phrase take it. Kept to the note
    // and its phrase; the site plays it as the reader scrolls.
    id: 'inks-wheel',
    kind: 'sequence',
    themes: ['light', 'dark'],
    viewport: { width: 1440, height: 900 },
    seconds: 3.8,
    cursor: true,
    prefs: { ...session(PROJECT, CHAPTERS.pilgrims, { sidebarTab: 'notes' }), 'inkblot-tray-color': 'sage' },
    async run(page, h) {
      await restored(page)
      const card = page.locator('.note-tile').first()
      await card.waitFor()
      const marker = await page.locator('.note-marker').first().boundingBox()
      const tile = await card.boundingBox()
      // The ring blooms about the colour dot; leave it room.
      const reach = { x: tile.x - 90, y: tile.y - 90, width: tile.width + 180, height: tile.height + 180 }
      const rect = frame([tile, marker, reach], page.viewportSize(), 24)
      h.focus(rect)
      // The pointer starts outside what's kept, so the first frame is the still's.
      const away = { x: rect.x - 60, y: rect.y + rect.height + 60 }
      await h.point(away)
      await page.waitForTimeout(300)
      await h.record()
      await page.waitForTimeout(400)

      await card.hover({ trial: true })
      const dot = await card.getByRole('button', { name: /^Note colour/ }).first().boundingBox()
      await h.glide(centre(dot), 0.7)
      await page.mouse.down()
      await page.waitForTimeout(550)
      const teal = await page.locator('.ib-ink-wheel-ring [role="option"][aria-label="Teal"]').first().boundingBox()
      await h.glide(centre(teal), 0.6)
      await page.waitForTimeout(350)
      await page.mouse.up()
      await page.waitForTimeout(250)
      await h.glide(away, 0.7)
      await h.until(3.8)
    },
  },
]
