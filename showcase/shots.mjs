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
import { PROJECT } from './fixtures/lighthouse-keeper.mjs'

/** Open the sample book and one of its chapters. */
async function openChapter(page, name) {
  await page.getByText(PROJECT, { exact: true }).first().dblclick()
  await page.getByText(name, { exact: true }).first().click()
  await page.locator('.ProseMirror').first().waitFor()
  await page.waitForTimeout(1200)
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
      await openChapter(page, 'Chapter 3')
      await caretAfter(page, 'Out on the water, something answered.')
      await h.record()
      await page.waitForTimeout(1500)
      await page.keyboard.press('Enter')
      await write(page, 'It was only the mail boat, late and lost, turning toward the light. But Ada stood at the glass a long time anyway, and did not count anything at all.')
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
      await openChapter(page, 'Chapter 3')
      await caretAfter(page, 'She had promised her father')
    },
  },
  {
    // The website's "Notes that stay with the words.": the writer's note on "light it at
    // dusk", pinned open beside the phrase, with its photo and voice memo.
    id: 'notes',
    kind: 'still',
    themes: ['light', 'dark'],
    // Wide enough that the text column (it stops growing) leaves a margin for the note.
    viewport: { width: 1800, height: 1000 },
    fixture: { notes: 'research' },
    async run(page) {
      await openChapter(page, 'Chapter 3')
      await page.getByRole('button', { name: 'Hide inspector' }).click()
      await page.waitForTimeout(600)
      await page.locator('.note-marker').first().click()
      const card = page.locator('.note-preview-card').first()
      await card.waitFor()
      await page.waitForTimeout(600)
      // The note opens beside its phrase, over the text; drag it out into the margin,
      // level with the passage, as a writer would. Its string follows.
      const column = await page.locator('.ProseMirror').first().boundingBox()
      const passage = await page.locator('.ProseMirror p', { hasText: 'She had promised' }).boundingBox()
      const from = await card.boundingBox()
      const grab = { x: from.x + from.width / 2, y: from.y + 10 }
      // Raised, so the string climbs into the space above the line instead of crossing it.
      const to = { x: grab.x + (column.x + column.width + 28 - from.x), y: grab.y + (passage.y - 210 - from.y) }
      await page.mouse.move(grab.x, grab.y)
      await page.mouse.down()
      await page.mouse.move((grab.x + to.x) / 2, (grab.y + to.y) / 2, { steps: 10 })
      await page.mouse.move(to.x, to.y, { steps: 10 })
      await page.mouse.up()
      await page.mouse.move(4, 996)
      await page.waitForTimeout(900)
    },
    // The passage and its note, not the window: whole paragraphs, from the one beside
    // the card's top to the chapter's last line.
    async clip(page) {
      const column = await page.locator('.ProseMirror').first().boundingBox()
      const card = await page.locator('.note-preview-card').first().boundingBox()
      const paragraphs = await page.locator('.ProseMirror p').evaluateAll((ps) => ps.map((p) => { const r = p.getBoundingClientRect(); return { top: r.top, bottom: r.bottom } }))
      const i = Math.max(0, paragraphs.findLastIndex((p) => p.top <= card.y))
      const last = paragraphs.at(-1)
      // Cut in the middle of the gap above it, clear of the line before.
      const top = i > 0 ? (paragraphs[i - 1].bottom + paragraphs[i].top) / 2 : paragraphs[0].top - 28
      const bottom = Math.max(last.bottom, card.y + card.height) + 32
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
      await openChapter(page, 'Chapter 3')
      await page.getByRole('button', { name: 'Notes', exact: true }).first().click()
      await page.waitForTimeout(800)
    },
  },
]
