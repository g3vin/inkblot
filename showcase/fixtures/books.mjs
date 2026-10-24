/**
 * books.mjs — the sample projects every showcase shot opens: three of the owner's
 * favourite books, all public domain in the US.
 *
 *   Little Women                    Louisa May Alcott, 1868 (Project Gutenberg #514)
 *   The Importance of Being Earnest Oscar Wilde, 1895 (Project Gutenberg #844)
 *   To the Lighthouse               Virginia Woolf, 1927 (Standard Ebooks, CC0)
 *
 * To the Lighthouse stands in for The Waves (1931) until that enters the US public
 * domain on 1 January 2027.
 *
 * The passages are in books/texts.json, verbatim from those editions. Everything else
 * in a project (the cast canvas, the map, the timeline, the references, a chapter's
 * history) is built here with the app's own models (src/lib), so a fixture is always
 * a file the app itself would write, and follows the app when its formats change.
 * capture.mjs loads this through tests/unit/loader.mjs, which resolves src/'s imports.
 *
 * assets/orchard-house.jpg: Orchard House, the Alcotts' home in Concord, 1941. Frank O.
 *   Branzetti for the Historic American Buildings Survey (HABS MASS,9-CON,4-4); public
 *   domain; cropped. https://commons.wikimedia.org/wiki/File:Historic_American_Buildings_Survey_Frank_O._Branzetti,_Photographer_April_7,_1941_(a)_EXT.-_FRONT_and_SIDE,_LOOKING_NORTHEAST_-_Orchard_House,_Lexington_Road,_Concord,_Middlesex_HABS_MASS,9-CON,4-4.tif
 * assets/memo.webm: 42 s of quiet room tone, made with ffmpeg (anoisesrc).
 *
 * `book({ notes })` returns `{ files, prefs }` for the mock (tauri-mock.js).
 */
import fs from 'node:fs'
import { makeTextNode, makeEdge, normalizeCanvas, serializeCanvas } from '../../src/lib/canvasModel.js'
import { addEvent, createEmptyTimelineView, normalizeTimeline } from '../../src/lib/timeline/timelineModel.js'
import { daysFromCivil, normalizeCalendar } from '../../src/lib/map/calendar.js'
import { createEmptyMap, makePin, normalizeMap, serializeMap } from '../../src/lib/map/mapModel.js'
import { LIBRARY_FILE, normalizeReference } from '../../src/lib/references/referenceStore.js'
import { applyFormat } from '../../src/print/formats.ts'

const texts = JSON.parse(fs.readFileSync(new URL('./books/texts.json', import.meta.url), 'utf8'))
const asset = (name) => fs.readFileSync(new URL(`./assets/${name}`, import.meta.url))

export const LITTLE_WOMEN = 'Little Women'
export const EARNEST = 'The Importance of Being Earnest'
export const LIGHTHOUSE = 'To the Lighthouse'
/** The project the shots open unless they say otherwise. */
export const PROJECT = LITTLE_WOMEN

/** Every id the models mint, counted: the same fixture each run. */
let counter = 0
const seq = (prefix = 'id') => () => `${prefix}-${(++counter).toString(36).padStart(4, '0')}`
/** One fixed afternoon for every timestamp a project shows. */
const at = (day, time) => `2026-10-${String(day).padStart(2, '0')}T${time}:00Z`

/** Text with Gutenberg's _underscores_ made italic. */
const inline = (t) => t.split(/_([^_]+)_/).map((part, i) => (i % 2 ? { type: 'text', text: part, marks: [{ type: 'italic' }] } : part && { type: 'text', text: part })).filter(Boolean)
const block = (type, t, attrs) => ({ type, ...(attrs ? { attrs } : {}), content: inline(t) })
/** A block's plain text, across its runs. */
const plain = (node) => (node.content || []).map((run) => run.text || '').join('')

/** A prose chapter: its title as a heading, then paragraphs. */
const prose = (title, paragraphs) => ({ type: 'doc', content: [block('heading', title, { level: 1 }), ...paragraphs.map((p) => block('paragraph', p))] })

/** A ProseMirror position for the start of `anchor`: each block opens at +1 and is its text plus two. */
function anchorRange(doc, anchor) {
  let pos = 0
  for (const node of doc.content) {
    const t = plain(node)
    const i = t.indexOf(anchor)
    if (i >= 0) return { from: pos + 1 + i, to: pos + 1 + i + anchor.length }
    pos += t.length + 2
  }
  throw new Error(`Note anchor not in document: "${anchor}"`)
}

const htmlOf = (doc) => doc.content.map((n) => (n.type === 'heading' ? `<h1>${plain(n)}</h1>` : `<p>${plain(n)}</p>`)).join('')
const wordsOf = (doc) => htmlOf(doc).replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length

/** A named or automatic version of a text document, as versionStore writes one. */
const version = (doc, { name = null, timestamp }) => ({
  id: `v-${Date.parse(timestamp).toString(36)}`,
  timestamp,
  kind: 'text',
  name,
  auto: !name,
  sessionId: 'showcase',
  words: wordsOf(doc),
  contentHtml: htmlOf(doc),
  contentJson: doc,
})

/* ---------------- Little Women ---------------- */

const LW = texts.littleWomen
const [pilgrims, christmas, laurence] = LW.chapters
// The chapter as the showcase opens it: the first scene, up to the four sisters' portraits.
const PILGRIMS = pilgrims.paragraphs.slice(0, 40)

const NOTES = {
  // A beta reader's margin notes.
  review: [
    { anchor: 'Christmas won’t be Christmas without any presents', content: 'What an opening line. I was hooked.' },
    { anchor: 'It was a comfortable room', content: 'Could we see the room through Jo’s eyes here?' },
    { anchor: 'Marmee must have a new pair', content: 'The slippers! Lovely small detail.' },
  ],
  // The writer's own note, with a photo and a voice memo from a visit to Orchard House.
  research: [
    {
      // The end of a paragraph, so the string runs into open space to the card.
      anchor: 'a pleasant atmosphere of home peace pervaded it',
      content: 'From the visit to Orchard House. The guide on the parlour, in her words.',
      images: [{ id: 'orchard-house', src: `data:image/jpeg;base64,${asset('orchard-house.jpg').toString('base64')}`, mimeType: 'image/jpeg' }],
      audio: [{ id: 'memo', src: '.assets/memo.webm', mimeType: 'audio/webm', durationMs: 42000, createdAt: at(18, '16:20') }],
    },
  ],
}

function chapterFile(doc, notes = [], versions = []) {
  const anchored = notes.map((note, i) => ({ id: `n${i + 1}`, type: 'quote', ...anchorRange(doc, note.anchor), ...note, color: 'amber' }))
  return JSON.stringify({ content: doc, notes: anchored, ...(versions.length ? { versions } : {}) })
}

/** The cast, as cards with strings between them. */
function castCanvas() {
  const nextId = seq('card')
  const card = (x, y, title, line, color) => makeTextNode({ id: nextId(), x, y, width: 260, height: 120, text: `## ${title}\n${line}`, ...(color ? { color } : {}) })
  const cards = {
    marmee: card(380, 0, 'Marmee', 'Holds the family together while Father is at the war.', '6'),
    father: card(700, 0, 'Mr March', 'A chaplain with the Union army; writes home.', '6'),
    meg: card(0, 260, 'Meg', 'The eldest. Wishes for pretty things; governess to the Kings.', '4'),
    jo: card(320, 260, 'Jo', 'Writes plays in the garret. Wants to be a famous author.', '2'),
    beth: card(640, 260, 'Beth', 'Shy, kind, and happiest at the old piano.', '5'),
    amy: card(960, 260, 'Amy', 'The youngest. An artist, and a little vain.', '3'),
    laurie: card(320, 560, 'Laurie', 'The Laurence boy next door. Jo’s best friend.', '1'),
    laurence: card(700, 560, 'Mr Laurence', 'Laurie’s grandfather. Gives Beth his piano.'),
    brooke: card(0, 560, 'John Brooke', 'Laurie’s tutor. Falls for Meg.'),
    aunt: card(-340, 120, 'Aunt March', 'Rich, cross, and fond of Jo in her way.'),
  }
  const nextEdge = seq('string')
  const edge = (from, to, label) => makeEdge({ id: nextEdge(), fromNode: cards[from].id, toNode: cards[to].id, ...(label ? { label } : {}) })
  const edges = [
    edge('marmee', 'meg'), edge('marmee', 'jo'), edge('marmee', 'beth'), edge('marmee', 'amy'),
    edge('marmee', 'father', 'married'), edge('jo', 'laurie', 'best friends'), edge('laurie', 'laurence', 'grandson'),
    edge('beth', 'laurence', 'the piano'), edge('meg', 'brooke', 'courting'), edge('jo', 'aunt', 'companion'),
  ]
  const state = normalizeCanvas({ nodes: Object.values(cards), edges })
  // The viewport is the world point at the pane's top-left: the family, framed for a
  // pane half the window wide (the website's split), Aunt March and Amy just off it.
  return JSON.stringify(serializeCanvas(state, { x: -20, y: -600, zoom: 0.46 }))
}

/** Concord as the book has it, drawn on a blank sheet. */
function concordMap() {
  const nextId = seq('place')
  const pin = (name, x, y, icon = 'pin') => makePin({ id: nextId(), name, at: [x, y], icon })
  const pins = {
    march: pin('The March house', 1700, 1500, 'home'),
    laurence: pin('The Laurence house', 2250, 1380, 'home'),
    aunt: pin('Aunt March’s', 1250, 1350),
    hummels: pin('The Hummels’', 900, 2050),
    pond: pin('The river, where Amy fell through the ice', 2900, 2150),
  }
  const map = createEmptyMap('blank', {
    pins: Object.values(pins),
    routes: [
      { id: nextId(), name: 'Christmas morning: breakfast to the Hummels', nodes: [{ pin: pins.march.id }, { at: [1300, 1850] }, { pin: pins.hummels.id }] },
      { id: nextId(), name: 'Skating', nodes: [{ pin: pins.laurence.id }, { at: [2600, 1800] }, { pin: pins.pond.id }] },
    ],
    labels: [{ id: nextId(), text: 'Lexington Road', at: [1950, 1250], size: 28, rotation: -8, font: 'serif' }],
    style: { theme: 'parchment', cartouche: { show: true, title: 'Concord', subtitle: 'Little Women · 1861' } },
    viewport: { x: 560, y: 760, zoom: 0.34 },
  })
  return JSON.stringify(serializeMap(normalizeMap(map, seq('m'))))
}

/** The sky over Concord: our own galaxy, a barred spiral, as a map of its own. */
function milkyWay() {
  const map = createEmptyMap('galaxy', { galaxy: { type: 'SBb', seed: 1868, radiusLy: 52000, thicknessLy: 1000 } })
  return JSON.stringify(serializeMap(normalizeMap(map, seq('g'))))
}

/** The March family's year, on the project's calendar. */
function storyTimeline() {
  const epoch = daysFromCivil(1861, 12, 24)
  const day = (y, m, d) => daysFromCivil(y, m, d) - epoch
  let timeline = normalizeTimeline({
    lanes: [
      { id: 'meg', name: 'Meg', color: 'green' }, { id: 'jo', name: 'Jo', color: 'rust' },
      { id: 'beth', name: 'Beth', color: 'teal' }, { id: 'amy', name: 'Amy', color: 'amber' },
      { id: 'family', name: 'The family', color: 'violet' },
    ],
  }, seq('lane'))
  const nextId = seq('event')
  const events = [
    ['Playing Pilgrims', 'Four sisters by the fire on Christmas Eve; Marmee reads Father’s letter.', 'family', day(1861, 12, 24)],
    ['A Merry Christmas', 'They give their breakfast to the Hummels.', 'family', day(1861, 12, 25)],
    ['The Laurence Boy', 'Jo meets Laurie at the Gardiners’ New Year’s Eve dance.', 'jo', day(1861, 12, 31)],
    ['Beth finds the Palace Beautiful', 'Mr Laurence gives Beth the piano.', 'beth', day(1862, 2, 10)],
    ['Amy falls through the ice', 'Laurie and Jo pull her out of the river.', 'amy', day(1862, 2, 22)],
    ['Meg goes to Vanity Fair', 'A fortnight at the Moffats’.', 'meg', day(1862, 4, 7), day(1862, 4, 21)],
    ['Camp Laurence', 'A picnic across the river.', 'family', day(1862, 8, 15)],
    ['Jo’s first story printed', 'The Rival Painters, in the Spread Eagle.', 'jo', day(1862, 10, 20)],
    ['A telegram', 'Father is ill in Washington; Marmee goes to him.', 'family', day(1862, 11, 18)],
    ['Beth’s scarlet fever', 'Hannah and the doctor; Jo sits up with her.', 'beth', day(1862, 12, 1), day(1862, 12, 20)],
    ['Father comes home', 'On Christmas Day, a year after the letter.', 'family', day(1862, 12, 25)],
  ]
  for (const [title, summary, laneId, start, end] of events) {
    timeline = addEvent(timeline, { id: nextId(), title, summary, laneId, start, ...(end ? { end } : {}) }, { nextId }).timeline
  }
  return {
    timeline: JSON.stringify(timeline),
    calendar: JSON.stringify(normalizeCalendar({ mode: 'gregorian', gregorianEpoch: '1861-12-24' })),
    view: JSON.stringify(createEmptyTimelineView()),
  }
}

const bookRef = (family, given, title, publisher, place, issued, extra = {}) => normalizeReference({
  id: `ref-${family.toLowerCase()}-${issued}`,
  kind: 'book',
  contributors: [{ role: extra.role || 'author', family, given }],
  fields: { title, publisher, 'publisher-place': place, issued },
  status: 'complete',
  createdAt: at(12, '10:00'),
  updatedAt: at(12, '10:00'),
})

function references() {
  return JSON.stringify({
    version: 1,
    defaultStyle: 'chicago-notes-bibliography',
    references: [
      bookRef('Alcott', 'Louisa May', 'Little Women; or, Meg, Jo, Beth and Amy', 'Roberts Brothers', 'Boston', '1868'),
      bookRef('Cheney', 'Ednah D.', 'Louisa May Alcott: Her Life, Letters, and Journals', 'Roberts Brothers', 'Boston', '1889', { role: 'editor' }),
      bookRef('Matteson', 'John', 'Eden’s Outcasts: The Story of Louisa May Alcott and Her Father', 'W. W. Norton', 'New York', '2007'),
    ],
    attachments: {},
  })
}

function littleWomen(notes) {
  const root = `/mock/${LITTLE_WOMEN}`
  const one = prose(pilgrims.title, PILGRIMS)
  // The chapter's history: the scene before the portraits, named; the portraits added.
  const versions = [
    version(one, { timestamp: at(21, '09:42') }),
    version(prose(pilgrims.title, PILGRIMS.slice(0, 33)), { name: 'Before the portraits', timestamp: at(20, '17:05') }),
    version(prose(pilgrims.title, PILGRIMS.slice(0, 14)), { name: 'First draft', timestamp: at(14, '11:30') }),
  ]
  const tl = storyTimeline()
  return {
    [`${root}/${pilgrims.title}.json`]: chapterFile(one, NOTES[notes] ?? [], versions),
    [`${root}/${christmas.title}.json`]: chapterFile(prose(christmas.title, christmas.paragraphs.slice(0, 24))),
    [`${root}/${laurence.title}.json`]: chapterFile(prose(laurence.title, laurence.paragraphs.slice(0, 24))),
    [`${root}/The Marches.canvas.json`]: castCanvas(),
    [`${root}/Concord.map.json`]: concordMap(),
    [`${root}/The Milky Way.map.json`]: milkyWay(),
    [`${root}/The year.timeline.json`]: tl.view,
    [`${root}/.story/timeline.json`]: tl.timeline,
    [`${root}/.story/calendar.json`]: tl.calendar,
    [`${root}/${LIBRARY_FILE}`]: references(),
    [`${root}/.assets/memo.webm`]: { base64: asset('memo.webm').toString('base64'), type: 'audio/webm' },
  }
}

/* ---------------- The Importance of Being Earnest ---------------- */

function earnest() {
  const play = texts.earnest
  const doc = {
    type: 'doc',
    attrs: { writingFormat: 'stageplay', pageSetup: applyFormat('stageplay') },
    content: play.act.map(([element, t]) => ({ type: 'scriptElement', attrs: { element }, content: inline(t) })),
  }
  return { [`/mock/${EARNEST}/Act One.json`]: JSON.stringify({ content: doc, notes: [] }) }
}

/* ---------------- To the Lighthouse ---------------- */

function lighthouse() {
  const [window, ...timePasses] = texts.lighthouse.parts
  const root = `/mock/${LIGHTHOUSE}`
  // "Time Passes": its chapters run on, each a numbered section.
  const nightDoc = {
    type: 'doc',
    content: [
      block('heading', 'Time Passes', { level: 1 }),
      ...timePasses.flatMap((part) => [block('heading', ['I', 'II', 'III', 'IV'][part.chapter - 1], { level: 2 }), ...part.paragraphs.map((p) => block('paragraph', p))]),
    ],
  }
  return {
    [`${root}/The Window.json`]: chapterFile(prose('The Window', window.paragraphs.slice(0, 12))),
    [`${root}/Time Passes.json`]: chapterFile(nightDoc),
  }
}

/* ---------------- the projects ---------------- */

const order = (project, names) => ({ [`inkblot-order:${project}`]: JSON.stringify({ '': names.map((n) => `file:${n}`) }) })

export function book({ notes = 'review' } = {}) {
  counter = 0
  const files = { ...littleWomen(notes), ...earnest(), ...lighthouse() }
  const prefs = {
    ...order(LITTLE_WOMEN, [pilgrims.title, christmas.title, laurence.title, 'The Marches.canvas', 'Concord.map', 'The Milky Way.map', 'The year.timeline']),
    ...order(LIGHTHOUSE, ['The Window', 'Time Passes']),
  }
  return { files, prefs }
}

/** The chapter titles shots open by name. */
export const CHAPTERS = { pilgrims: pilgrims.title, christmas: christmas.title, laurence: laurence.title }
/** The line the editor loop types: the book's own next paragraph after the opening scene. */
export const NEXT_LINE = pilgrims.paragraphs[PILGRIMS.length]

/**
 * The editor session a shot starts from (lib/editorSession.ts): `project` open on
 * `doc`, as a writer left it, with the inspector on `sidebarTab` and any workbench tiles.
 */
export function session(project, doc, { sidebarTab = 'workbench', tiles = [], ...rest } = {}) {
  const projectSession = {
    currentDoc: doc, activeDoc: doc, secondaryDoc: null, splitView: null, splitOrientation: 'columns', splitRatio: 0.5,
    sidebarTab, tiles, docTabs: [], activeTabId: null, updatedAt: null, ...rest,
  }
  return { 'inkblot-session': JSON.stringify({ lastProject: project, projects: { [project]: projectSession } }) }
}

/** A workbench tile on the first occurrence of `word` in the opening chapter, as the context menu makes one. */
export function tile(type, word, id) {
  const range = anchorRange(prose(pilgrims.title, PILGRIMS), word)
  return { id, type, text: word, anchor: word, ...range, doc: pilgrims.title }
}
