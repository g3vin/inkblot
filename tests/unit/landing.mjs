/**
 * The landing page: piles of paper drawn from what was remembered, and a sheet
 * growing into the document card.
 *
 *   - excerpts keep to their budget, skip blank lines, follow a renamed document and
 *     forget a deleted one
 *   - the recent list survives a launch (it once saved "[object Object]")
 *   - a pile's sheets lie the same way every time
 *   - the flight's keyframes start on the sheet and end on the card
 *   - the frost over the footage leaves the landing's text AA in every theme
 *   - the page mounted: a pile per project, the document it reopens on on top, its
 *     words on the sheet, the counts, and the slot for a new project
 */
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'
import { setInvokeHandler } from './stub-core.mjs'
import { ok } from './assert.mjs'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
installGlobals(dom.window, ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'DOMParser',
  'requestAnimationFrame', 'cancelAnimationFrame', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent',
  'MutationObserver', 'getComputedStyle'])
globalThis.IS_REACT_ACT_ENVIRONMENT = true
window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} })

const wordCounts = { 'Pile Test': [{ docPath: 'Chapter one', words: 1200, chars: 0 }, { docPath: 'Notes', words: 34, chars: 0 }] }
setInvokeHandler(async (command, args) => {
  if (command === 'preferences_load') return { app: {} }
  if (command === 'project_word_counts') return wordCounts[args?.projectName] ?? []
  return null
})
const prefs = await import('../../src/lib/preferences.ts')
if (!prefs.isHydrated()) await prefs.hydratePreferences()

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const excerpts = await import('../../src/lib/docExcerpts.js')
const recents = await import('../../src/lib/recentDocs.js')
const summaries = await import('../../src/lib/projectSummaries.js')
const { renameEntry, deleteEntry, setEntryOperations, entryOperationsOnDisk } = await import('../../src/lib/entryOperations.ts')
const { flightKeyframes, retargetKeyframes, paperPoint, cubicBezier } = await import('../../src/lib/sheetFlight.js')
const { sheetPose } = await import('../../src/ui/paperPose.js')
const { createProject, saveDocument } = await import('../../src/lib/FileSystem.js')
const { default: ProjectLanding } = await import('../../src/components/ProjectLanding.jsx')

const h = React.createElement
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* ---------------- excerpts ---------------- */

const doc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Chapter One' }] },
    { type: 'paragraph' },
    { type: 'paragraph', content: [{ type: 'text', text: 'The rain had ' }, { type: 'text', text: 'not stopped.', marks: [{ type: 'bold' }] }] },
    ...Array.from({ length: 10 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `Line ${i} `.repeat(20) }] })),
  ],
}
const blocks = excerpts.excerptOfContent(doc)
ok('an excerpt keeps a heading as a heading', blocks[0]?.t === 'h1' && blocks[0]?.x === 'Chapter One')
ok('blank lines are not part of it', blocks[1]?.t === 'p' && blocks[1]?.x === 'The rain had not stopped.')
ok('it stops at its block budget', blocks.length <= excerpts.EXCERPT_BLOCKS)
ok('and at its length, ending on an ellipsis',
  blocks.reduce((sum, block) => sum + block.x.length, 0) <= excerpts.EXCERPT_CHARS + 1 && blocks[blocks.length - 1].x.endsWith('…'))
ok('an empty document has no excerpt', excerpts.excerptOfContent({ type: 'doc', content: [{ type: 'paragraph' }] }).length === 0)

const node = (name, text, level) => ({ type: { name }, attrs: { level }, textContent: text })
const pmDoc = { childCount: 3, child: (i) => [node('heading', 'Two', 2), node('paragraph', 'Words'), node('paragraph', 'More')][i] }
const live = excerpts.excerptOfNode(pmDoc)
ok('a live document is read the same way', live.length === 3 && live[0].t === 'h2' && live[1].x === 'Words')

excerpts.noteExcerpt('Excerpt Test', 'Part/Chapter', blocks)
ok('an excerpt noted can be read back', excerpts.excerptFor('Excerpt Test', 'Part/Chapter')?.blocks.length === blocks.length)
const before = excerpts.excerptsSnapshot()
excerpts.noteExcerpt('Excerpt Test', 'Part/Chapter', blocks)
ok('noting the same words again changes nothing', excerpts.excerptsSnapshot() === before)
for (let i = 0; i < 12; i += 1) excerpts.noteExcerpt('Excerpt Test', `Doc ${i}`, [{ t: 'p', x: `words ${i}` }])
ok('a project keeps only its latest few', Object.keys(excerpts.excerptsSnapshot()['Excerpt Test']).length <= 8)

// Straight to disk: no page is holding these documents.
const restoreOperations = setEntryOperations(entryOperationsOnDisk)
const stopObserving = excerpts.observeExcerptPaths(recents.remapRecents)
await createProject('Excerpt Test')
await saveDocument('Excerpt Test', 'Folder/Kept', { content: [], notes: [] })
excerpts.noteExcerpt('Excerpt Test', 'Folder/Kept', [{ t: 'p', x: 'kept' }])
recents.noteOpened('Excerpt Test', 'Folder/Kept')
await renameEntry('Excerpt Test', 'Folder', 'Renamed', 'folder')
ok('a renamed folder carries its documents’ excerpts', excerpts.excerptFor('Excerpt Test', 'Renamed/Kept')?.blocks[0].x === 'kept'
  && !excerpts.excerptFor('Excerpt Test', 'Folder/Kept'))
ok('and their place in the recent list', recents.recentDocs('Excerpt Test')[0] === 'Renamed/Kept')
await deleteEntry('Excerpt Test', 'Renamed/Kept', 'file')
ok('a deleted document is forgotten', !excerpts.excerptFor('Excerpt Test', 'Renamed/Kept') && !recents.recentDocs('Excerpt Test').includes('Renamed/Kept'))
stopObserving()
restoreOperations()

/* ---------------- the recent list ---------------- */

prefs.setPreference('inkblot.tree.recent', '[object Object]')
ok('what the recent list once saved reads as nothing', recents.recentDocs('Novel').length === 0)
recents.noteOpened('Novel', 'One')
recents.noteOpened('Novel', 'Two')
ok('the recent list is saved as JSON', JSON.parse(prefs.getPreference('inkblot.tree.recent')).Novel.join() === 'Two,One')
recents.renameProjectRecents('Novel', 'Book')
ok('it follows a renamed project', recents.recentDocs('Book').join() === 'Two,One' && recents.recentDocs('Novel').length === 0)
recents.dropProjectRecents('Book')
ok('and forgets a deleted one', recents.recentDocs('Book').length === 0)

/* ---------------- a pile's sheets ---------------- */

const pose = sheetPose('Novel/Chapter', 1, 3)
ok('a sheet lies the same way every time', JSON.stringify(pose) === JSON.stringify(sheetPose('Novel/Chapter', 1, 3)))
ok('the top sheet is nearly square', Math.abs(sheetPose('Novel/Chapter', 0, 3).rest.rotate) <= 1.2)
ok('fanned, the sheets beneath open to either side', sheetPose('a', 1, 3).fan.x < 0 && sheetPose('a', 2, 3).fan.x > 0)

/* ---------------- the flight ---------------- */

const from = { left: 100, top: 300, width: 168, height: 218, rotate: 3 }
const to = { left: 240, top: 8, width: 900, height: 700 }
const frames = flightKeyframes({ from, to, sheet: { width: 168, height: 218 } })
const near = (a, b) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5
const turn = (point, centre, degrees) => {
  const r = (degrees * Math.PI) / 180
  const dx = point.x - centre.x
  const dy = point.y - centre.y
  return { x: centre.x + dx * Math.cos(r) - dy * Math.sin(r), y: centre.y + dx * Math.sin(r) + dy * Math.cos(r) }
}
const sheetCentre = { x: from.left + from.width / 2, y: from.top + from.height / 2 }
ok('the paper starts on the sheet, turned as it was',
  near(paperPoint(frames, to, 0, { x: 0, y: 0 }), turn({ x: from.left, y: from.top }, sheetCentre, 3))
  && near(paperPoint(frames, to, 0, { x: 1, y: 1 }), turn({ x: from.left + from.width, y: from.top + from.height }, sheetCentre, 3)))
const last = frames.frame.length - 1
ok('and ends exactly on the card',
  near(paperPoint(frames, to, last, { x: 0, y: 0 }), { x: to.left, y: to.top })
  && near(paperPoint(frames, to, last, { x: 1, y: 1 }), { x: to.left + to.width, y: to.top + to.height }))
ok('the page face ends at its own size', frames.pageFace[last].transform === 'scale(1, 1)')
const sheetStart = /scale\(([-\d.]+), ([-\d.]+)\)/.exec(frames.sheetFace[0].transform).slice(1).map(Number)
const paperStart = /scale\(([-\d.]+), ([-\d.]+)\)/.exec(frames.paper[0].transform).slice(1).map(Number)
ok('the sheet face starts at the sheet’s own size, unstretched',
  Math.abs(sheetStart[0] * paperStart[0] - 1) < 0.01 && Math.abs(sheetStart[1] * paperStart[1] - 1) < 0.01)
// Aimed where the card was last time, it learns a third of the way that the card is elsewhere.
const real = { left: 8, top: 8, width: 1132, height: 884 }
const atThird = paperPoint(flightKeyframes({ from, to, sheet: { width: 168, height: 218 }, steps: 3 }), to, 1, { x: 0, y: 0 })
const bent = retargetKeyframes({ from, was: to, to: real, sheet: { width: 168, height: 218 }, at: 1 / 3 })
ok('a flight that learns where the card really is bends from where it is', near(paperPoint(bent, real, 0, { x: 0, y: 0 }), atThird))
ok('and still lands exactly on the card', near(paperPoint(bent, real, bent.frame.length - 1, { x: 1, y: 1 }), { x: real.left + real.width, y: real.top + real.height }))
const ease = cubicBezier(0.2, 0.7, 0.2, 1)
ok('--ease-out is solved: it starts at 0, ends at 1, and is ahead of time halfway', ease(0) === 0 && ease(1) === 1 && ease(0.5) > 0.5)

/* ---------------- the frost is AA ---------------- */

// The darkest and brightest of the frosted footage (public/media/landing/leaves-frost.mp4),
// sampled with ffmpeg at 2 fps: the 0.5th and 99.5th percentiles of luminance.
const FOOTAGE_DARK = '#3a5211'
const FOOTAGE_BRIGHT = '#ecf7d8'
const tokens = readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8')
const block = (selector) => tokens.slice(tokens.indexOf(selector), tokens.indexOf('\n}', tokens.indexOf(selector)))
const value = (css, name) => new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1].trim()
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const luminance = (channels) => {
  const [r, g, b] = channels.map((c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const themes = {
  dark: block(":root[data-theme='dark']"),
  light: block(":root[data-theme='light']"),
  midnight: block(":root[data-theme='midnight']"),
}
for (const [theme, css] of Object.entries(themes)) {
  const share = Number(/var\(--paper-0\)\s+(\d+)%/.exec(value(css, '--landing-scrim') || '')?.[1]) / 100
  const paper = rgb(value(css, '--paper-0'))
  const text = ['--ink-0', '--ink-1'].map((name) => rgb(value(css, name)))
  const over = [FOOTAGE_DARK, FOOTAGE_BRIGHT].map((hex) => rgb(hex).map((c, i) => paper[i] * share + c * (1 - share)))
  const worst = Math.min(...text.flatMap((ink) => over.map((ground) => contrast(ink, ground))))
  ok(`${theme}: the landing's text is AA over the frosted footage (${worst.toFixed(2)}:1)`, share > 0 && worst >= 4.5)
}

/* ---------------- the page mounted ---------------- */

await createProject('Pile Test')
await saveDocument('Pile Test', 'Chapter one', { content: doc.content, notes: [] })
await saveDocument('Pile Test', 'Notes', { content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a list' }] }], notes: [] })
excerpts.noteExcerpt('Pile Test', 'Chapter one', blocks)
recents.noteOpened('Pile Test', 'Notes')
recents.noteOpened('Pile Test', 'Chapter one')
await createProject('Empty Pile')
summaries.resetSummariesForTests()
await summaries.refreshSummary('Pile Test')
ok('a project is counted from its documents', summaries.summaryFor('Pile Test')?.files === 2 && summaries.summaryFor('Pile Test')?.words === 1234)

const opened = []
const container = document.getElementById('root')
const root = createRoot(container)
const sessions = { 'Pile Test': { currentDoc: 'Chapter one', updatedAt: new Date().toISOString() } }
await act(async () => {
  root.render(h(ProjectLanding, {
    projectSessions: sessions,
    onOpenProject: (name, options) => opened.push({ name, ...options }),
    onCreateProject: () => {},
  }))
})
for (let i = 0; i < 30 && !container.querySelector('[data-pile-id="Pile Test"]'); i += 1) await act(async () => { await wait(20) })

const pile = container.querySelector('[data-pile-id="Pile Test"]')
ok('a project is a pile', Boolean(pile))
ok('the most recent project comes first', container.querySelector('.ib-paper-pile')?.getAttribute('data-pile-id') === 'Pile Test')
const sheets = [...(pile?.querySelectorAll('.ib-paper-sheet') ?? [])]
ok('its sheets are the documents opened lately', sheets.length === 2)
ok('the one it reopens on is on top', pile?.querySelector('[data-sheet-index="0"]')?.getAttribute('data-sheet-id') === 'Chapter one')
ok('with its words on it', pile?.querySelector('[data-sheet-index="0"]')?.textContent.includes('The rain had not stopped.'))
ok('a sheet whose words aren’t known yet is ruled', Boolean(pile?.querySelector('[data-sheet-index="1"] .ib-paper-sheet-rules')))
ok('under it, its files and words', pile?.querySelector('.ib-paper-pile-meta')?.textContent === '2 files · 1,234 words')
ok('an empty project is one blank sheet', container.querySelectorAll('[data-pile-id="Empty Pile"] .ib-paper-sheet').length === 1)
ok('the last place is for a new project', [...container.querySelectorAll('.ib-paper-pile')].pop()?.getAttribute('data-pile-id') === 'new')
ok('there is no app icon, and the name is signed small', !container.querySelector('.picker-logo') && Boolean(container.querySelector('.landing-signature svg')))

await act(async () => {
  pile.querySelector('[data-sheet-index="1"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
})
ok('clicking a sheet opens the project at that document', opened[0]?.name === 'Pile Test' && opened[0]?.docPath === 'Notes')
ok('and hands over where the sheet lies, for it to grow from', Boolean(opened[0]?.flight?.rect) && opened[0]?.flight?.sheet?.title === 'Notes')

await act(async () => { root.unmount() })
