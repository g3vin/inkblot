/**
 * The Lighthouse Keeper — the sample book every showcase shot opens. Its chapter 3 is the
 * text the website's book spread shows (inkblot-site src/data/home.ts), so the window
 * title and the prose agree wherever the site uses them.
 *
 * `book({ notes })` returns `{ files, prefs }` for the mock. Chapter 3 carries one set
 * of notes per shot: 'review' (a beta reader's margin notes) or 'research' (the
 * writer's own note on "light it at dusk", with a photo and a voice memo).
 *
 * assets/lamp.jpg: the lens and lamp of Faro de Punta Tuna, Puerto Rico, from the
 * Historic American Engineering Record (HAER PR,57-EMAG,1-27), public domain, cropped.
 * https://commons.wikimedia.org/wiki/File:Detail_view_of_interior_of_lens_showing_bulb_-_Faro_de_Punta_Tuna,_Punta_Tuna,_Emajagua,_Maunabo_Municipio,_PR_HAER_PR,57-EMAG,1-27.tif
 * assets/lamp-memo.webm: 42 s of quiet wind, made with ffmpeg (anoisesrc).
 */
import fs from 'node:fs'

export const PROJECT = 'The Lighthouse Keeper'
const asset = (name) => fs.readFileSync(new URL(`./assets/${name}`, import.meta.url))

const CHAPTERS = {
  'Chapter 1': {
    title: 'The Mail Boat',
    body: [
      'The mail boat came on Tuesdays when the sea allowed it, and on the Tuesdays it did not, Ada walked to the end of the jetty anyway, to show the water she had not forgotten.',
      'Her father kept the log in a hand so small it looked like stitching. Wind, west by south. Visibility, moderate. Lamp lit 18:42. Nothing in it ever happened, which he said was the point.',
    ],
  },
  'Chapter 2': {
    title: 'Salt',
    body: [
      'Everything on the island tasted of salt: the bread, the blankets, the inside of her own wrist. In winter the windows grew a crust of it, and she wrote her name there with a fingertip and watched the weather take it back.',
    ],
  },
  'Chapter 3': {
    title: 'The Lamp Room',
    body: [
      'down to the harbour, where the boats knocked together like loose teeth. Nobody looked up. Nobody ever looked up at a lighthouse until it went out.',
      '“You’ll learn the weather,” her father had said, the spring she turned twelve. “The weather won’t learn you.” She had thought it was a joke. Most of what he said turned out not to be.',
      'By autumn she knew the gulls by their quarrels and the tide by its smell, and she could tell from the colour of the morning whether the mail boat would come.',
      'The stairs turned seven times before the lamp room, and Ada counted every one, because counting kept the dark at the window where it belonged. Above her the lens waited, cold and patient, a cathedral of glass no wider than a kitchen table.',
      'She had promised her father she would light it at dusk. It was well past dusk. The sea had gone the colour of slate, then of nothing at all.',
      'Her hands knew the brass before her eyes did. The wick, the trimmer, the little door that stuck in wet weather and had to be persuaded with the heel of a palm. She struck the match and held it there until it burned her fingers, and then a moment longer.',
      'Out on the water, something answered.',
    ],
    notes: {
      // A beta reader's margin notes.
      review: [
        { anchor: 'a cathedral of glass', content: 'This image stopped me. Keep it.' },
        { anchor: 'Nobody ever looked up at a lighthouse until it went out.', content: 'Lovely line, but could it close the chapter instead?' },
        { anchor: 'and then a moment longer', content: 'I felt this in my own hand.' },
      ],
      // The writer's own note, from a visit to a real lighthouse.
      research: [
        {
          anchor: 'light it at dusk',
          content: 'From the lighthouse tour. The keeper on lighting it, in his words.',
          images: [{ id: 'lamp', src: `data:image/jpeg;base64,${asset('lamp.jpg').toString('base64')}`, mimeType: 'image/jpeg' }],
          audio: [{ id: 'memo', src: '.assets/lamp-memo.webm', mimeType: 'audio/webm', durationMs: 42000, createdAt: '2026-10-18T16:20:00Z' }],
        },
      ],
    },
  },
}

const text = (t) => [{ type: 'text', text: t }]

/** A chapter as the app stores it: the TipTap document, with notes anchored by position. */
function chapter({ title, body, notes = {} }, set) {
  const blocks = [
    { type: 'heading', attrs: { level: 1 }, content: text(title) },
    ...body.map((t) => ({ type: 'paragraph', content: text(t) })),
  ]
  // ProseMirror positions: each block opens at +1 and is its text plus two.
  const starts = []
  let pos = 0
  for (const b of blocks) { starts.push(pos); pos += b.content[0].text.length + 2 }
  const anchored = (notes[set] ?? []).map((note, i) => {
    const at = blocks.findIndex((b) => b.content[0].text.includes(note.anchor))
    if (at < 0) throw new Error(`Note anchor not in chapter: "${note.anchor}"`)
    const from = starts[at] + 1 + blocks[at].content[0].text.indexOf(note.anchor)
    return { id: `n${i + 1}`, type: 'quote', from, to: from + note.anchor.length, ...note, color: 'amber' }
  })
  return JSON.stringify({ content: { type: 'doc', content: blocks }, notes: anchored })
}

export function book({ notes = 'review' } = {}) {
  const files = Object.fromEntries(
    Object.entries(CHAPTERS).map(([name, c]) => [`/mock/${PROJECT}/${name}.json`, chapter(c, notes)]),
  )
  files[`/mock/${PROJECT}/.assets/lamp-memo.webm`] = { base64: asset('lamp-memo.webm').toString('base64'), type: 'audio/webm' }
  const prefs = {
    [`inkblot-order:${PROJECT}`]: JSON.stringify({ '': Object.keys(CHAPTERS).map((n) => `file:${n}`) }),
  }
  return { files, prefs }
}
