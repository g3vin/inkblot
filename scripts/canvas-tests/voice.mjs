/**
 * The Read Aloud text normalizer, against kokoro-js's own.
 *
 * Read Aloud's native voice used to be a Python child process. Python is gone — it
 * only worked on the machine it was installed on, and a subprocess cannot exist on
 * iOS — so the model runs through `ort` in Rust and the grapheme-to-phoneme pass
 * stays here.
 *
 * That pass begins with a normalizer that `kokoro-js` keeps module-private. Reaching
 * it means loading the whole TTS class, which loads the model into the webview, which
 * is the thing the change exists to stop. So `readAloudVoice.js` transcribes it — and
 * a transcribed regex chain is exactly where a silent error lives.
 *
 * This suite pulls the real function out of kokoro-js's bundle **at test time**, by
 * slicing out the four functions it is made of and evaluating them, and runs both over
 * the same corpus. Nothing here is written down from memory: the reference comes from
 * the installed package, so it tracks the dependency rather than a snapshot of it.
 */
import { readFileSync } from 'node:fs'

const ok = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) process.exitCode = 1 }

/* ---------------- the reference, out of the installed bundle ---------------- */

const bundle = readFileSync('node_modules/kokoro-js/dist/kokoro.js', 'utf8')

const slice = (from, to) => {
  const start = bundle.indexOf(from)
  const end = bundle.indexOf(to)
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`kokoro-js layout changed: could not slice ${from.slice(0, 30)}`)
  }
  return bundle.slice(start, end)
}

// `o`, `c`, `g` are the number/currency/decimal helpers; `m` is the normalizer plus
// the phonemize call. Only the normalizing half of `m` is taken — up to the point it
// reaches for the phonemizer.
const helpers = slice('function o(e){', 'async function m(e,a="a",t=!0)')

// The normalizer is an IIFE inside `m`; taking it from its `return` to the call that
// applies it leaves a balanced expression, which only needs its head rewritten into a
// return of its own.
const normalizerBody = slice(
  'async function m(e,a="a",t=!0){t&&(e=function(e){return e',
  ';const r=function(e,a)'
).replace('async function m(e,a="a",t=!0){t&&(e=function(e){return e', 'return (function(e){return e')

const reference = new Function('e', `${helpers}\n${normalizerBody};`)

/* ---------------- ours ---------------- */

const { normalizeForSpeech, phonemesToTokens } = await import('../../src/lib/readAloudVoice.js')

/* ---------------- the corpus ---------------- */

const CASES = [
  '',
  'Plain prose with nothing special in it.',
  // Quotes and brackets, which are rewritten before anything else.
  'He said ‘hello’ and she said “goodbye”.',
  'A parenthetical (like this one) in the middle.',
  '«guillemets» and »reversed« ones',
  // Full-width punctuation.
  'これは、テストです。本当！',
  'カンマ，コロン：セミコロン；クエスチョン？',
  // Whitespace.
  'tabs\tand\tvertical\u000bspace',
  'double  spaces   collapsed',
  'a line\n   \nwith a blank one between',
  // Titles.
  'Dr. Watson and DR. Who',
  'Mr. Holmes, Ms. Adler, Mrs. Hudson',
  'etc. and etc. Something',
  'yeah, yeah? Yeah!',
  // Years and times.
  'It was 1984, then 1900, then 1905, then 2000s.',
  'Meet at 3:05, or 12:00, or 9:30.',
  'The 1100s and the 1000s.',
  // Money.
  '$12.50 and £1 and $1 and $3 and £0.99',
  '$1.5 million and $12 thousand',
  '$1,234.56',
  // Decimals and ranges.
  'pi is 3.14159 and e is 2.718',
  'pages 10-20 and 1984-1985',
  // Initialisms.
  'the U.S.A. and the U.K. and N.A.S.A. something',
  'CDs and DVDs and Xs',
  'B.B. king',
  // A realistic paragraph.
  'The lamplighter came down the street at dusk, as he had every evening for thirty years — and the children followed him.',
  'Chapter 11: “The House on Marsh Lane” (1953)',
]

for (const text of CASES) {
  const label = text.length > 46 ? `${text.slice(0, 46)}…` : text || '(empty)'
  ok(`normalizes: ${JSON.stringify(label)}`, normalizeForSpeech(text) === reference(text))
}

/* ---------------- tokenization ---------------- */

// A stand-in vocabulary; the real one is the model's and is fetched, never written
// down. What is checked here is the padding and the dropping, not the values.
const vocab = { a: 10, b: 11, c: 12, 'ˈ': 20 }

ok('padding brackets the ids', JSON.stringify(phonemesToTokens('abc', vocab)) === '[0,10,11,12,0]')
ok('an empty utterance is still padded', JSON.stringify(phonemesToTokens('', vocab)) === '[0,0]')
ok(
  'a phoneme the model does not know is dropped, not guessed',
  JSON.stringify(phonemesToTokens('aXbˈ', vocab)) === '[0,10,11,20,0]'
)
