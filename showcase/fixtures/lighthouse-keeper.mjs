/**
 * The Lighthouse Keeper — the sample book every showcase shot opens. Its chapter 3 is the
 * text the website's book spread shows (inkblot-site src/data/home.ts), so the window
 * title and the prose agree wherever the site uses them.
 *
 * Exports `files` ({ '/mock/<project>/<file>': text }) and `prefs` for the mock.
 */
export const PROJECT = 'The Lighthouse Keeper'

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
    // A beta reader's margin notes, for the review shot.
    notes: [
      { anchor: 'a cathedral of glass', content: 'This image stopped me. Keep it.' },
      { anchor: 'Nobody ever looked up at a lighthouse until it went out.', content: 'Lovely line, but could it close the chapter instead?' },
      { anchor: 'and then a moment longer', content: 'I felt this in my own hand.' },
    ],
  },
}

const text = (t) => [{ type: 'text', text: t }]

/** A chapter as the app stores it: the TipTap document, with notes anchored by position. */
function chapter({ title, body, notes = [] }) {
  const blocks = [
    { type: 'heading', attrs: { level: 1 }, content: text(title) },
    ...body.map((t) => ({ type: 'paragraph', content: text(t) })),
  ]
  // ProseMirror positions: each block opens at +1 and is its text plus two.
  const starts = []
  let pos = 0
  for (const b of blocks) { starts.push(pos); pos += b.content[0].text.length + 2 }
  const anchored = notes.map((note, i) => {
    const at = blocks.findIndex((b) => b.content[0].text.includes(note.anchor))
    if (at < 0) throw new Error(`Note anchor not in chapter: "${note.anchor}"`)
    const from = starts[at] + 1 + blocks[at].content[0].text.indexOf(note.anchor)
    return { id: `n${i + 1}`, type: 'quote', from, to: from + note.anchor.length, anchor: note.anchor, content: note.content, color: 'amber' }
  })
  return JSON.stringify({ content: { type: 'doc', content: blocks }, notes: anchored })
}

export const files = Object.fromEntries(
  Object.entries(CHAPTERS).map(([name, c]) => [`/mock/${PROJECT}/${name}.json`, chapter(c)]),
)

export const prefs = {
  [`inkblot-order:${PROJECT}`]: JSON.stringify({ '': Object.keys(CHAPTERS).map((n) => `file:${n}`) }),
}
