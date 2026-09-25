/**
 * The pure half of the persistence layer against `inkblot_core::store`.
 *
 * Only the pure half: the I/O is verified by Rust tests against a real filesystem
 * (`store/tests.rs`), because "the JS does the same thing" is only interesting for I/O
 * if the thing is right, and the JS runs against an in-memory stub that does not model
 * directories. What is here is everything that *decides* — where a path lands on disk,
 * and what the version list becomes when something is pushed onto it.
 *
 * `pushVersionEntry` is the one to care about. It is the only place in the app that
 * deletes a user's version history, and the rule it enforces — evict oldest-first, but
 * never a named version — is the difference between losing an autosave and losing
 * "Final Submission".
 */
import {
  stripTrailingSlash, stripLeadingSlash, joinPath, parentOf, normalizePath,
} from '../../../src/lib/projectPaths.ts'
import {
  versionsSidecarPath, pushVersionEntry, buildTextVersionEntry, buildCanvasVersionEntry,
} from '../../../src/lib/versionStore.js'

const PATHS = [
  '', '/', '//', 'a', '/a', 'a/', '/a/', 'a//b', 'a//b//c', '///a///b///',
  'a\\b', 'a\\', '\\a', 'C:\\Users\\writer', '/Users/writer/Library/Application Support',
  'Folder/board.canvas', 'Folder//board.canvas', 'spaces in it/and more',
  'émigré/café.canvas', '日本語/フォルダ', '.hidden/doc',
]

const JOINS = [
  ['/root', 'a', 'b'],
  ['/root/', '/a/', '/b/'],
  ['/root', '', 'b'],
  ['/root'],
  [],
  ['', '', ''],
  ['/root', 'a//b'],
  ['C:\\Users\\writer\\', '\\Novel', 'Chapter One.json'],
  ['/root', '.versions', 'Folder/board.canvas.versions.json'],
]

/** A version entry as the app writes them. */
const textEntry = (id, html, name = null, auto = true) => ({
  id,
  timestamp: `2026-01-0${(id.length % 9) + 1}T00:00:00.000Z`,
  kind: 'text',
  name,
  auto,
  sessionId: 's-1',
  words: html.split(/\s+/).filter(Boolean).length,
  contentHtml: html,
  contentJson: null,
})

const canvasEntry = (id, nodeId, name = null) => ({
  id,
  timestamp: '2026-01-01T00:00:00.000Z',
  kind: 'canvas',
  name,
  auto: name === null,
  sessionId: 's-1',
  words: 0,
  canvas: {
    type: 'canvas',
    nodes: [{ id: nodeId, type: 'text', x: 0, y: 0, width: 260, height: 140, text: nodeId }],
    edges: [],
  },
})

/** A history at the cap, with two named landmarks buried in it. */
const atTheCap = () => {
  const entries = []
  for (let i = 0; i < 205; i++) {
    const name = i === 4 ? 'Final Submission' : i === 180 ? 'Before the cut' : null
    entries.push(textEntry(`v${i}`, `<p>revision ${i}</p>`, name, name === null))
  }
  return entries
}

const HISTORIES = [
  [],
  [textEntry('v1', '<p>one</p>')],
  [textEntry('v1', '<p>one</p>', 'Draft', false)],
  [textEntry('v1', ''), textEntry('v2', '')],
  [canvasEntry('c1', 'a')],
  [canvasEntry('c1', 'a', 'Layout')],
  [textEntry('v1', '<p>one</p>'), textEntry('v2', '<p>two</p>'), textEntry('v3', '<p>three</p>')],
  atTheCap(),
]

const PUSHED = [
  textEntry('new', '<p>fresh</p>'),
  textEntry('new', '<p>one</p>'),
  textEntry('new', '<p>one</p>', 'Named', false),
  textEntry('new', '', null),
  textEntry('new', '<p>fresh</p>', '', true),
  canvasEntry('new', 'a'),
  canvasEntry('new', 'b'),
  canvasEntry('new', 'a', 'Layout'),
]

const BUILD_TEXT = [
  { contentHtml: '<p>one two three</p>', contentJson: null, name: null, auto: true },
  { contentHtml: '<p>one</p>', contentJson: [{ type: 'paragraph' }], name: 'Draft', auto: false },
  { contentHtml: null, contentJson: null, name: '', auto: true },
  { contentHtml: '<h1>Title</h1><p>and a body</p>', contentJson: null, name: 'A', auto: false },
]

/** id, timestamp and sessionId come from the clock; neither side can match the other. */
const blankStamps = (value) => {
  if (Array.isArray(value)) return value.map(blankStamps)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) =>
        key === 'id' || key === 'timestamp' || key === 'sessionId'
          ? [key, 'stamped']
          : [key, blankStamps(inner)]
      )
    )
  }
  return value
}

/**
 * Drop null-valued keys, because the two sides spell "absent" differently and nothing
 * that reads this format can tell the difference.
 *
 * A version entry's optional fields are `Option<T>` in Rust and serialize as an absent
 * key; the JS builders write them as an explicit `null`. The shape also varies by kind
 * — `buildTextVersionEntry` emits `contentHtml`/`contentJson` and no `canvas`, and
 * `buildCanvasVersionEntry` the reverse — so one Rust struct cannot match both without
 * a hand-written serializer.
 *
 * Every reader of these fields treats null and absent alike: `entry.name` is falsy
 * either way, `Number.isFinite(entry.words)` is false either way, `contentJson || []`
 * is `[]` either way, and serde reads both as `None`. Erasing that distinction here is
 * an equivalence in the format, not a blind spot — it is applied to both sides, so it
 * cannot hide a value that differs.
 */
const dropNulls = (value) => {
  if (Array.isArray(value)) return value.map(dropNulls)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, inner]) => inner !== null)
        .map(([key, inner]) => [key, dropNulls(inner)])
    )
  }
  return value
}

export default {
  name: 'store',

  canon(value, { fn }) {
    if (fn.startsWith('build')) return dropNulls(blankStamps(value))
    if (fn === 'pushVersionEntry') return dropNulls(value)
    return value
  },

  *cases() {
    for (const path of PATHS) {
      yield { fn: 'stripTrailingSlash', args: [path], expected: stripTrailingSlash(path) }
      yield { fn: 'stripLeadingSlash', args: [path], expected: stripLeadingSlash(path) }
      yield { fn: 'parentOf', args: [path], expected: parentOf(path) }
      yield { fn: 'normalizePath', args: [path], expected: normalizePath(path) }
      yield {
        fn: 'versionsSidecarPath',
        args: ['/root', path],
        expected: versionsSidecarPath('/root', path),
      }
    }

    for (const parts of JOINS) {
      yield { fn: 'joinPath', args: [parts], expected: joinPath(...parts) }
    }

    for (const versions of HISTORIES) {
      for (const entry of PUSHED) {
        yield {
          fn: 'pushVersionEntry',
          args: [versions, entry],
          expected: pushVersionEntry(versions, entry),
        }
      }
    }

    for (const request of BUILD_TEXT) {
      yield {
        fn: 'buildTextVersionEntry',
        args: [request],
        expected: buildTextVersionEntry(request),
      }
    }

    for (const entry of [canvasEntry('c', 'a'), canvasEntry('c', 'b', 'Layout')]) {
      for (const name of [null, 'Snapshot']) {
        yield {
          fn: 'buildCanvasVersionEntry',
          args: [entry.canvas, name, name === null],
          expected: buildCanvasVersionEntry({ canvas: entry.canvas, name, auto: name === null }),
        }
      }
    }
  },
}
