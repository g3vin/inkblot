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
