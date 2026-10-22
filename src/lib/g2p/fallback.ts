/**
 * The guess for a word misaki's dictionary doesn't have: mostly names, and the
 * invented words fiction is full of.
 *
 * misaki falls back to eSpeak NG or to a neural model; Inkblot can ship neither (eSpeak
 * NG is GPL, and the model is another download). `phonemize` (MIT) is a dictionary
 * and letter-to-sound rules in plain JavaScript, so it takes the word instead, and
 * this rewrites its IPA into the symbols Kokoro was trained on (misaki's
 * EN_PHONES.md): diphthongs as single letters, stress immediately before its vowel,
 * and the dialect's own vowels.
 */
import { phonemize } from 'phonemize'

import { VOWELS } from './lexicon'

const STRESSES = 'ˈˌ'

const SHARED: [string, string][] = [
  ['eɪ', 'A'], ['aɪ', 'I'], ['aʊ', 'W'], ['ɔɪ', 'Y'], ['dʒ', 'ʤ'], ['tʃ', 'ʧ'],
  ['ɫ', 'l'], ['g', 'ɡ'], ['r', 'ɹ'], ['ɐ', 'ə'],
]
const AMERICAN: [string, string][] = [['oʊ', 'O'], ['əʊ', 'O'], ['ɚ', 'əɹ'], ['ː', ''], ['ɒ', 'ɑ']]
const BRITISH: [string, string][] = [['oʊ', 'Q'], ['əʊ', 'Q'], ['ɛə', 'ɛː'], ['ɚ', 'ə'], ['æ', 'a']]

const US_SYMBOLS = new Set('AIOWYbdfhijklmnpstuvwzæðŋɑɔəɛɜɡɪɹɾʃʊʌʒʤʧˈˌθᵊᵻ')
const GB_SYMBOLS = new Set('AIQWYabdfhijklmnpstuvwzðŋɑɒɔəɛɜɡɪɹʃʊʌʒʤʧˈˌːθᵊ')

/** `phonemize`'s IPA for one word, in misaki's symbols. */
export function toMisaki(ipa: string, british: boolean): string {
  let ps = ipa
  for (const [from, to] of [...SHARED, ...(british ? BRITISH : AMERICAN)]) ps = ps.replaceAll(from, to)

  if (british) {
    // RP keeps the LOT and THOUGHT vowels apart, where General American merges them.
    ps = ps.replace(/ɑ(?!ː)/g, 'ɒ').replace(/ɔ(?![ːɹ])/g, 'ɔː')
  }

  // The NURSE vowel: stressed it is ɜɹ (ɜː in RP), unstressed it reduces to əɹ (ə).
  let out = ''
  let stressPending = false
  for (const c of ps) {
    if (STRESSES.includes(c)) stressPending = true
    if (c === 'ɝ') {
      out += stressPending ? (british ? 'ɜː' : 'ɜɹ') : (british ? 'ə' : 'əɹ')
      stressPending = false
      continue
    }
    if (VOWELS.has(c)) stressPending = false
    out += c
  }

  const placed = placeStress(out, british ? GB_SYMBOLS : US_SYMBOLS)
  // RP's stressed FLEECE and GOOSE vowels are long; phonemize writes them short.
  return british ? placed.replace(/([ˈˌ])([iu])(?!ː)/g, '$1$2ː') : placed
}

/** Move each stress mark from the start of its syllable to just before its vowel. */
function placeStress(ps: string, symbols: Set<string>): string {
  const kept = [...ps].filter((c) => symbols.has(c))
  const out: string[] = []
  let pending = ''
  for (const c of kept) {
    if (STRESSES.includes(c)) {
      pending = c
      continue
    }
    if (pending && VOWELS.has(c)) {
      out.push(pending)
      pending = ''
    }
    out.push(c)
  }
  return out.join('')
}

/** A word to misaki's phonemes, or '' when even the rules have nothing. */
export function guess(word: string, british: boolean): string {
  const plain = word.normalize('NFD').replace(/\p{M}/gu, '')
  const ipa = String(phonemize(plain, british ? 'en-GB' : 'en-US'))
  return ipa
    .split(/\s+/)
    .map((part) => toMisaki(part, british))
    .filter(Boolean)
    .join(' ')
}
