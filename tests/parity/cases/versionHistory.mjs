/**
 * versionHistory.js's diff engine against `inkblot_core::version_history`.
 *
 * The JS and Rust diff engines run over the same corpus of real documents and must
 * produce identical chunk output.
 *
 * "Real documents" means prose, not `['a','b','c']`. The corpus starts from four
 * passages and derives the edits a writer actually makes — a word swapped, a sentence
 * cut, a paragraph moved, a typo fixed, a whole section rewritten — because the LCS
 * only behaves interestingly when the two sides mostly agree. It also carries the
 * degenerate cases that break diff engines: one side empty, both empty, a document
 * whose every word is the same word, and a pair large enough to trip the cell limit
 * and fall back to a whole-run replace.
 *
 * jsdom is here for one reason: `htmlToBlocks` needs a real `DOMParser` and stays in
 * the webview, so the harness has to produce the blocks the Rust `diff_block_lists`
 * is handed.
 */
import { JSDOM } from 'jsdom'
import { installGlobals } from '../../unit/install-globals.mjs'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
installGlobals(dom.window, ['document', 'DOMParser', 'Node', 'Element', 'HTMLElement'])

const {
  htmlToText, textWords, countWords, countCanvasWords, versionWords, sessionColor,
  diffTokens, diffWords, wordDelta, htmlToBlocks, diffBlockLists, mergeChunksToHtml,
  canvasNodeText, diffCanvases, canvasDiffIsEmpty, describeCanvasDiff, mergeCanvases,
} = await import('../../../src/lib/versionHistory.js')

/* ---------------- real documents ---------------- */

const PASSAGE_A = `The lamplighter came down the street at dusk, as he had every evening
for thirty years, and the children followed him the way children follow anything that
carries fire. He did not mind. He had long ago stopped minding.`

const PASSAGE_B = `She had written the letter four times. The first was honest and cruel.
The second was kind and false. The third said nothing at all, which was worse than
either. The fourth she sent.`

const PASSAGE_C = `Chapter Eleven\n\nThe house on Marsh Lane had been empty since the war,
and the garden had taken it back — ivy through the sash windows, a birch growing out of
what used to be the parlour hearth.`

const PASSAGE_D = 'the the the the the the the the the the the the'

/** The edits a writer actually makes, applied to a passage. */
const EDITS = [
  (text) => text,
  (text) => text.replace('the', 'a'),
  (text) => text.replace(/\bhe\b/g, 'she'),
  (text) => text.split('. ').slice(0, -1).join('. '),
  (text) => text.split('. ').reverse().join('. '),
  (text) => `A new opening sentence. ${text}`,
  (text) => `${text} And then, at last, an ending.`,
  (text) => text.replace(/,/g, ''),
  (text) => text.toUpperCase(),
  (text) => text.split(/\s+/).filter((_, i) => i % 3 !== 0).join(' '),
  () => '',
]

const PASSAGES = [PASSAGE_A, PASSAGE_B, PASSAGE_C, PASSAGE_D, '', '   ', 'one']

/** Long enough that midA * midB passes LCS_CELL_LIMIT and the middle becomes a replace. */
const LONG_A = Array.from({ length: 700 }, (_, i) => `word${i}`).join(' ')
const LONG_B = Array.from({ length: 700 }, (_, i) => `word${(i * 7) % 700}`).join(' ')

const HTML_DOCUMENTS = [
  '',
  '<p>One paragraph.</p>',
  '<p>One paragraph.</p><p>Two paragraphs.</p>',
  '<h1>Title</h1><p>Body text with <strong>bold</strong> and <em>emphasis</em>.</p>',
  '<p>One paragraph.</p><p>An inserted one.</p><p>Two paragraphs.</p>',
  '<p>One paragraph.</p><blockquote><p>A quote.</p></blockquote>',
  '<ul><li>first</li><li>second</li></ul>',
  'loose text outside any element',
  '<p>&amp;nbsp; entities &lt;here&gt;</p>',
  '<table><tr><td>a</td><td>b</td></tr></table>',
  '<p>   </p>',
]

const STRINGS = [
  '', ' ', 'one', 'one two', '  padded  ', 'tab\tseparated', 'newline\nseparated',
  'nbsp separated', 'bom﻿separated', 'ideographic　space',
  'émigré café', '日本語 の 文章', 'emoji 🎨 here', 'trailing paragraph',
]

const SESSION_IDS = [
  '', 's-1', 'abc', 'ABC', '0', 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  '🎨', '日本語', 'a'.repeat(200), '\u0000',
]

/* ---------------- canvases ---------------- */

const card = (id, extra = {}) => ({
  id, type: 'text', x: 0, y: 0, width: 260, height: 140, ...extra,
})

const CANVAS_LEFT = {
  type: 'canvas',
  nodes: [
    card('a', { text: 'Act One' }),
    card('b', { text: 'Act Two', x: 400 }),
    card('c', { text: 'cut me', x: 800 }),
    card('d', { type: 'file', file: 'Novel/Chapter One', inkblotNoteId: 'n1', x: 1200 }),
    card('e', { type: 'group', label: 'Structure', width: 2000, height: 600 }),
  ],
  edges: [
    { id: 'e1', fromNode: 'a', toNode: 'b', fromSide: 'right', toSide: 'left' },
    { id: 'e2', fromNode: 'b', toNode: 'c' },
  ],
}

const CANVAS_RIGHT = {
  type: 'canvas',
  nodes: [
    card('a', { text: 'Act One' }),
    card('b', { text: 'Act Two, revised', x: 400 }),
    card('d', { type: 'file', file: 'Novel/Chapter One', inkblotNoteId: 'n1', x: 1250, y: 40 }),
    card('e', { type: 'group', label: 'Structure', width: 2000, height: 600 }),
    card('f', { text: 'and a new one', x: 1600, color: '4' }),
  ],
  edges: [
    { id: 'e1', fromNode: 'a', toNode: 'b', fromSide: 'right', toSide: 'left' },
    { id: 'e3', fromNode: 'b', toNode: 'f' },
  ],
}

const EMPTY_CANVAS = { type: 'canvas', nodes: [], edges: [] }

const CANVAS_PAIRS = [
  [CANVAS_LEFT, CANVAS_RIGHT],
  [CANVAS_RIGHT, CANVAS_LEFT],
  [CANVAS_LEFT, CANVAS_LEFT],
  [EMPTY_CANVAS, CANVAS_RIGHT],
  [CANVAS_LEFT, EMPTY_CANVAS],
  [EMPTY_CANVAS, EMPTY_CANVAS],
]

const NODES_FOR_TEXT = [
  card('a', { text: 'spoken' }),
  card('a', { text: '', label: 'labelled' }),
  card('a', { text: '', label: '', url: 'https://example.com/board' }),
  card('a', { type: 'file', file: 'Folder/Sub/Document' }),
  card('a', { type: 'file', file: 'trailing/' }),
  card('a', { type: 'file', file: 'bare' }),
  card('a'),
]

/** Every combination of per-change decisions, over a diff with one of each kind. */
const DECISION_SETS = [
  {},
  { 'added:f': 'left' },
  { 'removed:c': 'left' },
  { 'edited:b': 'left' },
  { 'moved:d': 'left' },
  { 'edgeAdded:e3': 'left' },
  { 'edgeRemoved:e2': 'left' },
  { 'added:f': 'left', 'removed:c': 'left', 'edited:b': 'left', 'moved:d': 'left' },
  { 'removed:c': 'left', 'edgeRemoved:e2': 'left' },
  { 'added:f': 'right', 'edited:b': 'both' },
]

const CHOICE_SETS = [{}, { 0: 'left' }, { 1: 'left' }, { 0: 'both' }, { 0: 'right', 1: 'both' }, { 5: 'left' }]

export default {
  name: 'versionHistory',
  *cases() {
    for (const text of STRINGS) {
      yield { fn: 'textWords', args: [text], expected: textWords(text) }
      yield { fn: 'countWords', args: [text, false], expected: countWords(text, false) }
    }

    for (const html of HTML_DOCUMENTS) {
      yield { fn: 'htmlToText', args: [html], expected: htmlToText(html) }
      yield { fn: 'countWords', args: [html, true], expected: countWords(html, true) }
    }

    for (const id of SESSION_IDS) {
      yield { fn: 'sessionColor', args: [id], expected: sessionColor(id) }
    }

    // The diff engine over real prose and its plausible edits.
    for (const passage of PASSAGES) {
      for (const edit of EDITS) {
        const after = edit(passage)
        yield { fn: 'diffWords', args: [passage, after], expected: diffWords(passage, after) }
        yield { fn: 'wordDelta', args: [passage, after], expected: wordDelta(passage, after) }
      }
    }
    yield { fn: 'diffWords', args: [LONG_A, LONG_B], expected: diffWords(LONG_A, LONG_B) }
    yield { fn: 'wordDelta', args: [LONG_A, LONG_B], expected: wordDelta(LONG_A, LONG_B) }

    // Token diff on raw token lists, where the trimming edge cases live.
    const TOKEN_LISTS = [
      [], ['a'], ['a', 'b', 'c'], ['a', 'a', 'a'], ['a', 'b', 'a', 'b'],
      ['x', 'a', 'b', 'c', 'y'], ['a', 'c'], ['', 'a'],
    ]
    for (const a of TOKEN_LISTS) {
      for (const b of TOKEN_LISTS) {
        yield { fn: 'diffTokens', args: [a, b], expected: diffTokens(a, b) }
      }
    }

    // Block diff, over the blocks a real DOMParser produces.
    for (const left of HTML_DOCUMENTS) {
      for (const right of HTML_DOCUMENTS) {
        const a = htmlToBlocks(left)
        const b = htmlToBlocks(right)
        const chunks = diffBlockLists(a, b)
        yield { fn: 'diffBlockLists', args: [a, b], expected: chunks }
        for (const choices of CHOICE_SETS) {
          yield {
            fn: 'mergeChunksToHtml',
            args: [chunks, choices],
            expected: mergeChunksToHtml(chunks, choices),
          }
        }
      }
    }

    for (const node of NODES_FOR_TEXT) {
      yield { fn: 'canvasNodeText', args: [node], expected: canvasNodeText(node) }
    }

    for (const [left, right] of CANVAS_PAIRS) {
      const diff = diffCanvases(left, right)
      yield { fn: 'diffCanvases', args: [left, right], expected: diff }
      yield { fn: 'canvasDiffIsEmpty', args: [left, right], expected: canvasDiffIsEmpty(diff) }
      yield { fn: 'describeCanvasDiff', args: [left, right], expected: describeCanvasDiff(diff) }
      yield { fn: 'countCanvasWords', args: [left], expected: countCanvasWords(left) }
      for (const decisions of DECISION_SETS) {
        yield {
          fn: 'mergeCanvases',
          args: [left, right, decisions],
          expected: mergeCanvases(left, right, diff, decisions),
        }
      }
    }

    const ENTRIES = [
      { id: '1', timestamp: '2026-01-01T00:00:00.000Z', kind: 'text', name: null, auto: true, words: 12, contentHtml: '<p>a b c</p>' },
      { id: '2', timestamp: '2026-01-01T00:00:00.000Z', kind: 'text', name: 'Draft', auto: false, contentHtml: '<p>one two three four</p>' },
      { id: '3', timestamp: '2026-01-01T00:00:00.000Z', kind: 'canvas', name: null, auto: true, canvas: CANVAS_LEFT },
      { id: '4', timestamp: '2026-01-01T00:00:00.000Z', kind: 'text', name: null, auto: true },
    ]
    for (const entry of ENTRIES) {
      yield { fn: 'versionWords', args: [entry], expected: versionWords(entry) }
    }
  },
}
