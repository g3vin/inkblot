/**
 * readAloudVoice.js — text to phoneme token ids, for the native speech path.
 *
 * Read Aloud's native voice used to be a **long-lived Python child process**, which
 * worked on the machine it was set up on, silently fell back to WASM everywhere else,
 * and — the reason it had to go — cannot exist on iOS, where subprocesses are not a
 * thing. The model now runs through `ort` in Rust. This is the half that stayed here:
 *
 *   text -> normalize -> phonemize -> token ids  ->  Rust: ONNX -> samples
 *
 * Phonemization stays in the webview because a correct English grapheme-to-phoneme
 * pass is a lexicon and several thousand rules, `phonemizer` already implements one,
 * and none of it is a subprocess — so none of it blocks the new targets.
 *
 * ## Why this is a transcription, and how it is checked
 *
 * `kokoro-js` does the same normalization before phonemizing, in a module-private
 * function it does not export. Reaching it would mean loading the whole TTS class,
 * which loads the model into the webview — the thing this change exists to stop.
 *
 * So it is transcribed. Transcription is exactly where a silent error lives, so the
 * `voice` suite runs this side by side with the real function, pulled out of
 * kokoro-js's own bundle at test time, over a corpus of the inputs it exists to
 * handle. Do not "tidy" a regex here: every one of them is that function's.
 *
 * ## The vocabulary is never transcribed
 *
 * The phoneme→id map is the model's, downloaded with it and read back through
 * `kokoro_vocab`. Writing it out here from memory is the one mistake that would
 * produce confident, fluent, wrong audio.
 */
import { invoke } from '@tauri-apps/api/core'
import { phonemize } from 'phonemizer'

/** Split on punctuation runs; those are kept verbatim rather than phonemized. */
const PUNCTUATION = ';:,.!?¡¿—…"«»“”(){}[]'
const PUNCTUATION_SPLIT = new RegExp(
  `(\\s*[${PUNCTUATION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]+\\s*)+`,
  'g'
)

/** A year or a time: "1984" -> "19 84", "3:05" -> "3 oh 5". */
const speakNumber = (value) => {
  if (value.includes('.')) return value
  if (value.includes(':')) {
    const [hour, minute] = value.split(':').map(Number)
    if (minute === 0) return `${hour} o'clock`
    return minute < 10 ? `${hour} oh ${minute}` : `${hour} ${minute}`
  }

  const year = parseInt(value.slice(0, 4), 10)
  if (year < 1100 || year % 1000 < 10) return value

  const century = value.slice(0, 2)
  const rest = parseInt(value.slice(2, 4), 10)
  const plural = value.endsWith('s') ? 's' : ''

  if (year % 1000 >= 100 && year % 1000 <= 999) {
    if (rest === 0) return `${century} hundred${plural}`
    if (rest < 10) return `${century} oh ${rest}${plural}`
  }
  return `${century} ${rest}${plural}`
}

/** "$12.50" -> "12 dollars and 50 cents". */
const speakMoney = (value) => {
  const unit = value[0] === '$' ? 'dollar' : 'pound'
  if (isNaN(Number(value.slice(1)))) return `${value.slice(1)} ${unit}s`

  if (!value.includes('.')) {
    const plural = value.slice(1) === '1' ? '' : 's'
    return `${value.slice(1)} ${unit}${plural}`
  }

  const [whole, fraction] = value.slice(1).split('.')
  const minor = parseInt(fraction.padEnd(2, '0'), 10)
  const minorUnit = value[0] === '$'
    ? (minor === 1 ? 'cent' : 'cents')
    : (minor === 1 ? 'penny' : 'pence')
  return `${whole} ${unit}${whole === '1' ? '' : 's'} and ${minor} ${minorUnit}`
}

/** "3.14" -> "3 point 1 4". */
const speakDecimal = (value) => {
  const [whole, fraction] = value.split('.')
  return `${whole} point ${fraction.split('').join(' ')}`
}

/** The pre-phonemize pass. Every replacement below is kokoro-js's, in its order. */
export const normalizeForSpeech = (text) =>
  String(text)
    .replace(/[‘’]/g, "'")
    .replace(/«/g, '“')
    .replace(/»/g, '”')
    .replace(/[“”]/g, '"')
    .replace(/\(/g, '«')
    .replace(/\)/g, '»')
    .replace(/、/g, ', ')
    .replace(/。/g, '. ')
    .replace(/！/g, '! ')
    .replace(/，/g, ', ')
    .replace(/：/g, ': ')
    .replace(/；/g, '; ')
    .replace(/？/g, '? ')
    .replace(/[^\S \n]/g, ' ')
    .replace(/  +/, ' ')
    .replace(/(?<=\n) +(?=\n)/g, '')
    .replace(/\bD[Rr]\.(?= [A-Z])/g, 'Doctor')
    .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, 'Mister')
    .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, 'Miss')
    .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, 'Mrs')
    .replace(/\betc\.(?! [A-Z])/gi, 'etc')
    .replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, speakNumber)
    .replace(/(?<=\d),(?=\d)/g, '')
    .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, speakMoney)
    .replace(/\d*\.\d+/g, speakDecimal)
    .replace(/(?<=\d)-(?=\d)/g, ' to ')
    .replace(/(?<=\d)S/g, ' S')
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
    .replace(/(?<=X')S\b/g, 's')
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (run) => run.replace(/\./g, '-'))
    .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, '-')
    .trim()

/** Split into the runs that get phonemized and the punctuation that does not. */
const splitOnPunctuation = (text) => {
  const parts = []
  let cursor = 0
  for (const match of text.matchAll(PUNCTUATION_SPLIT)) {
    if (cursor < match.index) parts.push({ match: false, text: text.slice(cursor, match.index) })
    if (match[0].length > 0) parts.push({ match: true, text: match[0] })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) parts.push({ match: false, text: text.slice(cursor) })
  return parts
}

/** Fixes applied after phonemizing, again kokoro-js's and in its order. */
const fixPhonemes = (phonemes, language) => {
  let fixed = phonemes
    .replace(/kəkˈoːɹoʊ/g, 'kˈoʊkəɹoʊ')
    .replace(/kəkˈɔːɹəʊ/g, 'kˈəʊkəɹəʊ')
    .replace(/ʲ/g, 'j')
    .replace(/r/g, 'ɹ')
    .replace(/x/g, 'k')
    .replace(/ɬ/g, 'l')
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ')
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, 'z')

  if (language === 'a') fixed = fixed.replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di')
  return fixed.trim()
}

/**
 * Text → IPA phonemes.
 *
 * `language` is the voice's first letter: 'a' for American English, 'b' for British.
 */
export async function textToPhonemes(text, language = 'a', normalize = true) {
  const prepared = normalize ? normalizeForSpeech(text) : String(text)
  const dialect = language === 'a' ? 'en-us' : 'en'

  const parts = await Promise.all(
    splitOnPunctuation(prepared).map(async (part) =>
      part.match ? part.text : (await phonemize(part.text, dialect)).join(' ')
    )
  )

  return fixPhonemes(parts.join(''), language)
}

/* ---------------- the vocabulary ---------------- */

let vocabPromise = null

/**
 * The model's own phoneme→id map, read back from the downloaded tokenizer.
 *
 * Deliberately not a constant in this file. The vocabulary is part of the weights: a
 * transcription error in it would not throw, it would shift every phoneme by one and
 * produce fluent, confident, wrong speech.
 */
export function getKokoroVocab() {
  if (!vocabPromise) {
    vocabPromise = invoke('kokoro_vocab').catch((error) => {
      vocabPromise = null
      throw error
    })
  }
  return vocabPromise
}

/**
 * Phonemes → the token ids the model takes.
 *
 * The leading and trailing zeros are the padding the model expects, and they are also
 * what its voice-style lookup subtracts back off — so they must be in the array that
 * goes to Rust, not added there. A phoneme the vocabulary does not have is dropped,
 * which is what the tokenizer does with it too.
 */
export function phonemesToTokens(phonemes, vocab) {
  const ids = [0]
  for (const symbol of String(phonemes)) {
    const id = vocab[symbol]
    if (typeof id === 'number') ids.push(id)
  }
  ids.push(0)
  return ids
}

/** Text → the token ids for `voice`, ready to synthesize. */
export async function textToTokens(text, voice) {
  const language = String(voice || 'a').charAt(0) === 'b' ? 'b' : 'a'
  const [phonemes, vocab] = await Promise.all([textToPhonemes(text, language), getKokoroVocab()])
  return { phonemes, tokens: phonemesToTokens(phonemes, vocab) }
}
