/**
 * The Read Aloud chunker and the note/audio normalizers against
 * `inkblot_core::read_aloud` and `inkblot_core::notes`.
 *
 * The chunker decides where the voice pauses, so the corpus is prose with the shapes
 * that make the rules fire against each other: paragraphs, sentences that pack, a
 * sentence too long to speak in one call, one with commas to break at and one with
 * none, quotes and brackets trailing the full stop, and a chunk limit small enough to
 * force every branch.
 *
 * The normalizers are the other half of the same risk as `normalizeCanvas`: they run on
 * whatever is in an old document, so the corpus is mostly malformed notes.
 */
import { splitReadAloudText, buildReadAloudChunks } from '../../../src/lib/readAloud.js'
import { normalizeNote, normalizeNotes, collectNoteBranchIds, compareNotes } from '../../../src/lib/noteUtils.js'
import { normalizeAudioClip, normalizeNoteAudio, formatDuration } from '../../../src/lib/audioNotes.js'
import { encode } from '../encode.mjs'

const PASSAGES = [
  '',
  '   \n  \t ',
  'One short sentence.',
  'One. Two. Three.',
  'First para.\n\nSecond para.',
  'First para.\nSecond line of the same idea.\n\nA third.',
  'He said "stop!" Then he left.',
  'She asked (did she?) and nobody answered.',
  'A sentence with, several clauses, separated by commas, that runs on for a while before it ends.',
  'Awordwithnobreaksatallthatjustkeepsgoingandgoingandgoingandgoingandgoing.',
  'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi',
  'Ends without punctuation',
  'Multiple!!! Exclamation??? Marks...',
  'A line\r\nwith windows breaks\r\n\r\nand a paragraph.',
  'Spaces   collapsed   between   words.',
  'Trailing space before a comma , and a period .',
  '🎨 An emoji opens this sentence. And another follows.',
  'Café, naïve, résumé — accented words in a clause.',
  `The lamplighter came down the street at dusk, as he had every evening for thirty years, and the children followed him the way children follow anything that carries fire. He did not mind. He had long ago stopped minding.`,
]

const LIMITS = [220, 40, 20, 10, 1]

/** A payload as getReadableEditorPayload builds it: text plus positioned words. */
const payloadFor = (text) => {
  const words = []
  for (const match of text.matchAll(/\S+/g)) {
    words.push({
      text: match[0],
      startOffset: match.index,
      endOffset: match.index + match[0].length,
      from: match.index + 1,
      to: match.index + match[0].length + 1,
    })
  }
  return { text, words }
}

/** And one where the offsets are missing, so they have to be found in the text. */
const payloadWithoutOffsets = (text) => ({
  text,
  words: [...text.matchAll(/\S+/g)].map((match) => ({ text: match[0] })),
})

/**
 * Objects only. `normalizeNote(note = {})` defaults on `undefined` and not on `null`,
 * so `normalizeNotes([null])` throws in JS — a pre-existing bug on a function
 * documented as safe for untrusted data, and a plausible crash on a corrupt document.
 * The Rust version returns a default note instead; the divergence is pinned by
 * `notes::tests::a_note_that_is_not_an_object_is_still_a_note` rather than compared
 * here, because there is nothing on the JS side to compare against.
 */
const RAW_NOTES = [
  {},
  { id: 'n1' },
  { id: '', type: 'quote', from: 3, to: 9, anchor: 'the quick', content: 'a comment' },
  { id: 'n2', type: 'QUOTE' },
  { id: 'n3', type: 'quote', from: '3', to: null },
  { id: 'n4', from: 1.5, to: Infinity },
  { id: 'n5', color: '#ABC' },
  { id: 'n6', color: '  #abcdef  ' },
  { id: 'n7', color: 'rebeccapurple' },
  { id: 'n8', color: 7 },
  { id: 'n9', pinned: 'yes', collapsedChildren: 1 },
  { id: 'n10', parentNoteId: '  ' },
  { id: 'n11', parentNoteId: '  p1  ' },
  { id: 'n12', previewLayout: { offsetX: 5, offsetY: 'nope' } },
  { id: 'n13', previewLayout: 'nope' },
  { id: 'n14', previewSize: { width: 10, height: 1000 } },
  { id: 'n15', previewSize: {} },
  { id: 'n16', images: [{ src: 'data:image/png;base64,AAA' }, { src: '  ' }, {}, null, 7] },
  { id: 'n17', images: 'nope' },
  { id: 'n18', images: [{ id: '  ', src: 'x', mimeType: 'image/jpeg' }] },
  { id: 'n19', audio: [{ src: '.assets/a.webm', durationMs: 1234, createdAt: '2026-01-01T00:00:00.000Z' }] },
  { id: 'n20', audio: [{ src: '.assets/b.webm', durationMs: -5 }, { mimeType: 'audio/mp4' }] },
  { id: 'n21', audio: 'nope' },
  { id: 'n22', createdAt: '2026-01-02T03:04:05.678Z', updatedAt: '2026-01-03T00:00:00.000Z' },
  { id: 'n23', createdAt: 'yesterday' },
  { id: 'n24', updatedAt: '2026-01-05T00:00:00.000Z' },
  { id: 'n25', content: 42, anchor: ['a'] },
  { id: 'n26', futureField: { added: 'by a newer build' }, another: [1, 2, 3] },
]

const CLIPS = [
  {},
  null,
  { src: '' },
  { src: '   ' },
  { src: '.assets/a.webm' },
  { id: 'c1', src: '.assets/a.webm', mimeType: 'audio/mp4', durationMs: 92000, createdAt: '2026-01-01T00:00:00.000Z' },
  { id: '   ', src: '.assets/b.webm' },
  { src: '.assets/c.webm', durationMs: 'long' },
  { src: '.assets/d.webm', durationMs: -1 },
]

const DURATIONS = [0, -0, 1, 499, 500, 999, 1000, 1500, 9000, 59999, 60000, 92000, 3600000, -1, -500, -1500, NaN, Infinity, 1.4, 1.5, 2.5, -0.5]

/** A branch of notes, plus a cycle that must not hang. */
const NOTE_TREE = [
  { id: 'root' },
  { id: 'a', parentNoteId: 'root' },
  { id: 'b', parentNoteId: 'root' },
  { id: 'a1', parentNoteId: 'a' },
  { id: 'orphan', parentNoteId: 'missing' },
  { id: 'x', parentNoteId: 'y' },
  { id: 'y', parentNoteId: 'x' },
]

const SORTABLE = [
  { id: 's1', type: 'quote', from: 10, updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 's2', type: 'quote', from: 2, updatedAt: '2026-01-02T00:00:00.000Z' },
  { id: 's3', type: 'quote', from: null, updatedAt: '2026-01-03T00:00:00.000Z' },
  { id: 's4', type: 'free', updatedAt: '2026-01-04T00:00:00.000Z' },
  { id: 's5', type: 'free', updatedAt: '2026-01-05T00:00:00.000Z' },
  { id: 's6', type: 'quote', from: 2, pinned: true, updatedAt: '2026-01-06T00:00:00.000Z' },
  { id: 's7', type: 'free', pinned: true, updatedAt: '2026-01-07T00:00:00.000Z' },
]

/** Every string anywhere in a value — used to tell an input date from a clock date. */
const stringsIn = (value, found = new Set()) => {
  if (typeof value === 'string') found.add(value)
  else if (Array.isArray(value)) value.forEach((inner) => stringsIn(inner, found))
  else if (value && typeof value === 'object') {
    Object.values(value).forEach((inner) => stringsIn(inner, found))
  }
  return found
}

/**
 * Blank the three things the shell supplies, and only those.
 *
 * A generated id, a locale-formatted `timestamp`, and a date that came from the clock
 * rather than from the input are each unreproducible across the seam. A date the input
 * DID supply is left alone and compared exactly — which is the half that matters, since
 * it is where the coercion rules live.
 */
const blankShellValues = (value, supplied = new Set()) => {
  if (Array.isArray(value)) return value.map((inner) => blankShellValues(inner, supplied))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => {
        if (key === 'timestamp') return [key, 'formatted']
        if (key === 'id' && typeof inner === 'string' && /^[0-9a-f-]{36}$/i.test(inner)) {
          return [key, 'generated']
        }
        if (
          (key === 'createdAt' || key === 'updatedAt') &&
          typeof inner === 'string' &&
          !supplied.has(inner)
        ) {
          return [key, 'from the clock']
        }
        return [key, blankShellValues(inner, supplied)]
      })
    )
  }
  return value
}

/** Pinned so the JS and Rust "now" fallbacks start from the same instant. */
const NOW = new Date().toISOString()

export default {
  name: 'readAloudNotes',

  canon(value, { fn, args }) {
    if (!fn.startsWith('normalize') && fn !== 'sortNotes') return value
    return blankShellValues(value, stringsIn(args[0]))
  },

  *cases() {
    for (const text of PASSAGES) {
      for (const maxLength of LIMITS) {
        yield {
          fn: 'splitReadAloudText',
          args: [text, maxLength],
          expected: splitReadAloudText(text, maxLength),
        }
        const payload = payloadFor(text)
        yield {
          fn: 'buildReadAloudChunks',
          args: [encode(payload), maxLength],
          expected: buildReadAloudChunks(payload, maxLength),
        }
        const loose = payloadWithoutOffsets(text)
        yield {
          fn: 'buildReadAloudChunks',
          args: [encode(loose), maxLength],
          expected: buildReadAloudChunks(loose, maxLength),
        }
      }
    }

    for (const raw of RAW_NOTES) {
      yield { fn: 'normalizeNote', args: [raw, NOW], expected: normalizeNote(raw ?? {}) }
    }
    yield { fn: 'normalizeNotes', args: [RAW_NOTES, NOW], expected: normalizeNotes(RAW_NOTES) }
    yield { fn: 'normalizeNotes', args: ['nope', NOW], expected: normalizeNotes('nope') }

    for (const clip of CLIPS) {
      yield { fn: 'normalizeAudioClip', args: [clip, NOW], expected: normalizeAudioClip(clip ?? {}) }
    }
    yield { fn: 'normalizeNoteAudio', args: [CLIPS, NOW], expected: normalizeNoteAudio(CLIPS) }

    for (const millis of DURATIONS) {
      yield { fn: 'formatDuration', args: [encode(millis)], expected: formatDuration(millis) }
    }

    const tree = normalizeNotes(NOTE_TREE)
    for (const rootId of ['root', 'a', 'orphan', 'x', 'missing', '']) {
      yield {
        fn: 'collectNoteBranchIds',
        args: [NOTE_TREE, rootId, NOW],
        expected: collectNoteBranchIds(tree, rootId),
      }
    }

    yield {
      fn: 'sortNotes',
      args: [SORTABLE, NOW],
      expected: normalizeNotes(SORTABLE).sort(compareNotes),
    }
  },
}
