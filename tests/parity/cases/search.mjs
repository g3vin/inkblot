/**
 * sidebarSearch.js and canvasSearch.js against `inkblot_core::search`.
 *
 * The matcher is the reason this file is long. `useRegex` hands the user's own pattern
 * to two different regex engines, and JavaScript's dialect is not Rust's — `\w` and
 * `\d` are ASCII in one and Unicode in the other, `\s` disagrees over U+FEFF, and `\b`
 * follows whichever `\w` its engine has. The Rust side translates those eight escapes
 * before compiling; this corpus is what says whether the translation is right, so it
 * runs every pattern against text chosen to catch each class boundary: accented
 * letters, Arabic-Indic digits, a byte order mark, an emoji.
 *
 * Offsets are the other half. A JS string index and a ProseMirror position are both
 * counts of UTF-16 code units, and Rust's natural offset is neither — so every text
 * here that has an astral character in it is checking that a match reports 3 where the
 * character count says 2.
 */
import {
  createMatcher, buildPreview, getEntryLabel, collectMatchesFromDocJson,
} from '../../../src/lib/sidebarSearch.js'
import { collectCanvasMatches } from '../../../src/lib/canvasSearch.js'

/* ---- what the matcher is run over ---- */

const HAYSTACKS = [
  '',
  'the quick brown fox',
  'The Quick Brown Fox',
  'cafe and café and cafeteria',
  'ab12 and ٥٥ and ½',
  'one\u{feff}two three',
  '🎨 art and 🎭 drama',
  'line one\nline two\nline three',
  'a.c and abc and a|c',
  'letter letter bookkeeper',
  'foobar foobaz foo',
  '  padded  ',
  'repeat repeat repeat repeat',
  'CamelCaseIdentifier and snake_case_name',
  'trailing space at end ',
  '日本語のテキストと English',
  'price: $12.50, was $19.99',
  'a\tb c　d',
]

/* ---- the queries ---- */

const LITERAL_QUERIES = [
  '', '   ', 'the', 'The', 'fox', 'a.c', 'a|c', '$12.50', 'café', 'cafe',
  '🎨', 'one two', '\u{feff}', '.', '*', '\\', '[', '(', 'repeat', '_name',
]

const REGEX_QUERIES = [
  'the', 'f.x', '^the', 'fox$', 'a|c', '[a-z]+', '\\w+', '\\W', '\\d+', '\\D',
  '\\s', '\\S+', '\\bfox\\b', '\\Bo\\B', '[\\w]+', '[\\d]+', '[\\s]', '[\\dA-F]+',
  'o{2}', 'o+?', '(?:quick|brown)', '(\\w)\\1', 'foo(?=bar)', 'foo(?!bar)',
  '(?<=foo)bar', '(?<!foo)bar', '\\$\\d+\\.\\d{2}', 'a*', '', '^', '$',
  '[^a-z]+', 'é', '\\u00e9', '(?:)', 'foo(', '[', '*bad', '(?<name>o)',
]

const OPTION_SETS = [
  { matchCase: false, wholeWord: false, useRegex: false },
  { matchCase: true, wholeWord: false, useRegex: false },
  { matchCase: false, wholeWord: true, useRegex: false },
  { matchCase: true, wholeWord: true, useRegex: false },
  { matchCase: false, wholeWord: false, useRegex: true },
  { matchCase: true, wholeWord: false, useRegex: true },
  { matchCase: false, wholeWord: true, useRegex: true },
]

/* ---- documents ---- */

const paragraph = (...text) => ({
  type: 'paragraph',
  content: text.map((value) => ({ type: 'text', text: value })),
})

const DOCUMENTS = [
  null,
  {},
  { type: 'doc', content: [] },
  { type: 'doc', content: [paragraph('the quick brown fox')] },
  {
    type: 'doc',
    content: [
      paragraph('the quick brown fox'),
      paragraph('jumps over ', 'the lazy dog'),
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'the title' }] },
    ],
  },
  // An astral character before the match, so the reported position differs from the
  // character count.
  { type: 'doc', content: [paragraph('🎨 the art of the fox')] },
  // And an astral character in an EARLIER sibling, which is the only thing that
  // exercises the node-size walk: a paragraph's own text carries its offsets from the
  // matcher, but the next paragraph's start is the previous one's size.
  { type: 'doc', content: [paragraph('🎨🎨 emoji first'), paragraph('the fox')] },
  // An empty node counts 1, which shifts everything after it.
  { type: 'doc', content: [{ type: 'horizontalRule' }, paragraph('the fox')] },
  // Nested structure: a list adds two tokens per level.
  {
    type: 'doc',
    content: [{
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [paragraph('the first')] },
        { type: 'listItem', content: [paragraph('the second')] },
      ],
    }],
  },
  // Content without the doc wrapper, which the JS coerces.
  { content: [paragraph('the fox')] },
]

const CANVASES = [
  null,
  {},
  { nodes: [], edges: [] },
  {
    nodes: [
      { id: 'a', type: 'text', text: 'the quick brown fox\nsecond line' },
      { id: 'b', type: 'text', text: '' },
      { id: 'c', type: 'group', label: 'the structure' },
      { id: 'd', type: 'group' },
      { id: 'e', type: 'file', file: 'Novel/the chapter' },
      { id: 'f', type: 'file' },
      { id: 'g', type: 'text', text: '🎨 the art' },
      { id: '', type: 'text', text: 'the unaddressable' },
      null,
      'not a node',
      {
        id: 'h',
        type: 'text',
        text: 'a very long first line that runs past the sixty character limit the title uses',
      },
    ],
    edges: [
      { id: 'e1', fromNode: 'a', toNode: 'c', label: 'then the next' },
      { id: 'e2', fromNode: 'a', toNode: 'c' },
      { id: '', fromNode: 'a', toNode: 'c', label: 'the unaddressable edge' },
    ],
  },
]

const PREVIEW_CASES = [
  ['', 0, 0],
  ['the quick brown fox jumps over the lazy dog and keeps going for a while', 30, 34],
  ['short', 0, 5],
  ['  padded text  ', 2, 8],
  ['\u{feff}bom at the edges\u{feff}', 1, 4],
  ['🎨🎨🎨 emoji prefix then the word', 7, 12],
  ['exactly at the end', 12, 18],
]

const LABEL_PATHS = ['', '/', 'a', 'a/b', 'a/b/', '//a//b//', 'Folder/board.canvas', 'émigré']

export default {
  name: 'search',
  *cases() {
    for (const options of OPTION_SETS) {
      const queries = options.useRegex ? REGEX_QUERIES : LITERAL_QUERIES
      for (const query of queries) {
        const matcher = createMatcher(query, options)

        // Whether it compiled at all, before what it finds. The error TEXT is each
        // engine's own wording and is not compared.
        yield {
          fn: 'matcherState',
          args: [query, options],
          expected: { isEmpty: matcher.isEmpty, valid: matcher.valid },
        }

        for (const haystack of HAYSTACKS) {
          yield {
            fn: 'findAll',
            args: [query, options, haystack],
            expected: matcher.findAll(haystack),
          }
        }
      }
    }

    for (const [text, from, to] of PREVIEW_CASES) {
      yield { fn: 'buildPreview', args: [text, from, to, 34], expected: buildPreview(text, from, to, 34) }
      yield { fn: 'buildPreview', args: [text, from, to, 2], expected: buildPreview(text, from, to, 2) }
    }

    for (const path of LABEL_PATHS) {
      yield { fn: 'getEntryLabel', args: [path], expected: getEntryLabel(path) }
    }

    const docOptions = { matchCase: false, wholeWord: false, useRegex: false }
    for (const content of DOCUMENTS) {
      for (const query of ['the', 'fox', 'art', 'zzz']) {
        const matcher = createMatcher(query, docOptions)
        yield {
          fn: 'collectMatchesFromDocJson',
          args: [content, query, docOptions, 'Novel/Chapter One'],
          expected: collectMatchesFromDocJson(content, matcher, 'Novel/Chapter One'),
        }
      }
    }

    for (const raw of CANVASES) {
      for (const query of ['the', 'art', 'zzz']) {
        for (const limit of [24, 2]) {
          const matcher = createMatcher(query, docOptions)
          yield {
            fn: 'collectCanvasMatches',
            args: [raw, query, docOptions, 'Board.canvas', limit],
            expected: collectCanvasMatches(raw, matcher, 'Board.canvas', { limit }),
          }
        }
      }
    }
  },
}
