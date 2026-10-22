/**
 * readAloudVoice.ts — text to phoneme token ids, for Kokoro.
 *
 * The Kokoro model runs through `ort` in Rust (`inkblot-models/src/kokoro_speech.rs`),
 * or in the webview when there is no native backend. This is the half before it:
 *
 *   text -> phonemes (lib/g2p) -> token ids  ->  Rust: ONNX -> samples
 *
 * The phonemes come from a port of misaki, the grapheme-to-phoneme pass Kokoro was
 * trained with, over its gold dictionary for the voice's dialect. It is plain
 * JavaScript, so the same path works on every platform the app targets.
 *
 * ## The vocabulary is never transcribed
 *
 * The phoneme→id map is the model's, downloaded with it and read back through
 * `kokoro_vocab`. Writing it out here from memory is the one mistake that would
 * produce confident, fluent, wrong audio.
 */
import { invoke } from '@tauri-apps/api/core'

import { createG2P, type G2P } from './g2p/g2p'
import type { LexiconData } from './g2p/lexicon'

/** A voice's first letter: 'a' for American English, 'b' for British. */
export type VoiceLanguage = 'a' | 'b'

/** The model's phoneme → token id map, as `kokoro_vocab` returns it. */
export type KokoroVocab = Record<string, number>

/* ---------------- phonemes ---------------- */

// Each dialect's dictionary is a 2.5 MB asset of its own, fetched the first time a voice
// of that dialect speaks. As a plain asset rather than an imported module: Vite would
// otherwise turn its 90,000 keys into named exports.
const LEXICONS: Record<VoiceLanguage, () => Promise<{ default: string }>> = {
  a: () => import('./g2p/data/us_gold.json?url'),
  b: () => import('./g2p/data/gb_gold.json?url'),
}
const g2ps = new Map<VoiceLanguage, Promise<G2P>>()

async function loadLexicon(language: VoiceLanguage): Promise<LexiconData> {
  const { default: url } = await LEXICONS[language]()
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Couldn't load the pronunciation dictionary (HTTP ${response.status}).`)
  return response.json()
}

function getG2P(language: VoiceLanguage): Promise<G2P> {
  let g2p = g2ps.get(language)
  if (!g2p) {
    g2p = loadLexicon(language).then((data) => createG2P(data, { british: language === 'b' }))
    g2p.catch(() => g2ps.delete(language))
    g2ps.set(language, g2p)
  }
  return g2p
}

/**
 * Text → Kokoro's phonemes.
 *
 * `language` is the voice's first letter: 'a' for American English, 'b' for British.
 */
export async function textToPhonemes(text: string, language: VoiceLanguage = 'a'): Promise<string> {
  const g2p = await getG2P(language)
  return g2p(String(text))
}

/* ---------------- the vocabulary ---------------- */

let vocabPromise: Promise<KokoroVocab> | null = null

/**
 * The model's own phoneme→id map, read back from the downloaded tokenizer.
 *
 * Deliberately not a constant in this file. The vocabulary is part of the weights: a
 * transcription error in it would not throw, it would shift every phoneme by one and
 * produce fluent, confident, wrong speech.
 */
export function getKokoroVocab(): Promise<KokoroVocab> {
  if (!vocabPromise) {
    vocabPromise = invoke<KokoroVocab>('kokoro_vocab').catch((error) => {
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
export function phonemesToTokens(phonemes: string, vocab: KokoroVocab): number[] {
  const ids = [0]
  for (const symbol of String(phonemes)) {
    const id = vocab[symbol]
    if (typeof id === 'number') ids.push(id)
  }
  ids.push(0)
  return ids
}

/** Text → the token ids for `voice`, ready to synthesize. */
export async function textToTokens(
  text: string,
  voice: string,
): Promise<{ phonemes: string; tokens: number[] }> {
  const language: VoiceLanguage = String(voice || 'a').charAt(0) === 'b' ? 'b' : 'a'
  const [phonemes, vocab] = await Promise.all([textToPhonemes(text, language), getKokoroVocab()])
  return { phonemes, tokens: phonemesToTokens(phonemes, vocab) }
}
