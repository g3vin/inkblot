/**
 * readAloud.js — text-to-speech engine for the read-aloud feature.
 *
 * Responsibilities:
 *  - Extract readable text from the editor along with a char→doc-position
 *    map and per-word ranges, so the UI can highlight the word being spoken.
 *  - Split that text into speakable chunks at paragraph/sentence/clause
 *    boundaries (Kokoro degrades on long inputs).
 *  - Generate audio with the Kokoro TTS model: prefers the native Rust
 *    backend (kokoro_commands), falling back to kokoro-js running in WASM.
 *    Voice .bin files ship in the app bundle (see KOKORO_VOICE_ASSETS) and
 *    fetches for them are patched to resolve locally instead of hitting
 *    HuggingFace.
 */
import { invoke } from '@tauri-apps/api/core'

const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const KOKORO_OPTIONS = {
  dtype: 'q8',
  device: 'wasm',
}
const KOKORO_MODEL_LOAD_TIMEOUT_MS = 120000
const KOKORO_GENERATE_TIMEOUT_MS = 20000
const NATIVE_KOKORO_GENERATE_TIMEOUT_MS = 180000
const NATIVE_KOKORO_PREWARM_TIMEOUT_MS = 180000
const KOKORO_GENERATE_TIMEOUT_CODE = 'KOKORO_GENERATE_TIMEOUT'
export const DEFAULT_READ_ALOUD_VOICE = 'af_heart'
export const READ_ALOUD_VOICES = [
  { id: 'af_heart', name: 'Heart', language: 'American', gender: 'Female', grade: 'A' },
  { id: 'af_bella', name: 'Bella', language: 'American', gender: 'Female', grade: 'A-' },
  { id: 'af_nicole', name: 'Nicole', language: 'American', gender: 'Female', grade: 'B-' },
  { id: 'af_sarah', name: 'Sarah', language: 'American', gender: 'Female', grade: 'C+' },
  { id: 'af_kore', name: 'Kore', language: 'American', gender: 'Female', grade: 'C+' },
  { id: 'af_aoede', name: 'Aoede', language: 'American', gender: 'Female', grade: 'C+' },
  { id: 'af_nova', name: 'Nova', language: 'American', gender: 'Female', grade: 'C' },
  { id: 'af_alloy', name: 'Alloy', language: 'American', gender: 'Female', grade: 'C' },
  { id: 'af_sky', name: 'Sky', language: 'American', gender: 'Female', grade: 'C-' },
  { id: 'af_river', name: 'River', language: 'American', gender: 'Female', grade: 'D' },
  { id: 'af_jessica', name: 'Jessica', language: 'American', gender: 'Female', grade: 'D' },
  { id: 'am_michael', name: 'Michael', language: 'American', gender: 'Male', grade: 'C+' },
  { id: 'am_fenrir', name: 'Fenrir', language: 'American', gender: 'Male', grade: 'C+' },
  { id: 'am_puck', name: 'Puck', language: 'American', gender: 'Male', grade: 'C+' },
  { id: 'am_echo', name: 'Echo', language: 'American', gender: 'Male', grade: 'D' },
  { id: 'am_eric', name: 'Eric', language: 'American', gender: 'Male', grade: 'D' },
  { id: 'am_liam', name: 'Liam', language: 'American', gender: 'Male', grade: 'D' },
  { id: 'am_onyx', name: 'Onyx', language: 'American', gender: 'Male', grade: 'D' },
  { id: 'am_santa', name: 'Santa', language: 'American', gender: 'Male', grade: 'D-' },
  { id: 'am_adam', name: 'Adam', language: 'American', gender: 'Male', grade: 'F+' },
  { id: 'bf_emma', name: 'Emma', language: 'British', gender: 'Female', grade: 'B-' },
  { id: 'bf_isabella', name: 'Isabella', language: 'British', gender: 'Female', grade: 'C' },
  { id: 'bf_alice', name: 'Alice', language: 'British', gender: 'Female', grade: 'D' },
  { id: 'bf_lily', name: 'Lily', language: 'British', gender: 'Female', grade: 'D' },
  { id: 'bm_george', name: 'George', language: 'British', gender: 'Male', grade: 'C' },
  { id: 'bm_fable', name: 'Fable', language: 'British', gender: 'Male', grade: 'C' },
  { id: 'bm_lewis', name: 'Lewis', language: 'British', gender: 'Male', grade: 'D+' },
  { id: 'bm_daniel', name: 'Daniel', language: 'British', gender: 'Male', grade: 'D' },
]
const KOKORO_VOICE_ASSETS = import.meta.glob([
  '../../node_modules/kokoro-js/voices/af_heart.bin',
  '../../node_modules/kokoro-js/voices/af_bella.bin',
  '../../node_modules/kokoro-js/voices/af_nicole.bin',
  '../../node_modules/kokoro-js/voices/af_sarah.bin',
  '../../node_modules/kokoro-js/voices/af_kore.bin',
  '../../node_modules/kokoro-js/voices/af_aoede.bin',
  '../../node_modules/kokoro-js/voices/af_nova.bin',
  '../../node_modules/kokoro-js/voices/af_alloy.bin',
  '../../node_modules/kokoro-js/voices/af_sky.bin',
  '../../node_modules/kokoro-js/voices/af_river.bin',
  '../../node_modules/kokoro-js/voices/af_jessica.bin',
  '../../node_modules/kokoro-js/voices/am_michael.bin',
  '../../node_modules/kokoro-js/voices/am_fenrir.bin',
  '../../node_modules/kokoro-js/voices/am_puck.bin',
  '../../node_modules/kokoro-js/voices/am_echo.bin',
  '../../node_modules/kokoro-js/voices/am_eric.bin',
  '../../node_modules/kokoro-js/voices/am_liam.bin',
  '../../node_modules/kokoro-js/voices/am_onyx.bin',
  '../../node_modules/kokoro-js/voices/am_santa.bin',
  '../../node_modules/kokoro-js/voices/am_adam.bin',
  '../../node_modules/kokoro-js/voices/bf_emma.bin',
  '../../node_modules/kokoro-js/voices/bf_isabella.bin',
  '../../node_modules/kokoro-js/voices/bf_alice.bin',
  '../../node_modules/kokoro-js/voices/bf_lily.bin',
  '../../node_modules/kokoro-js/voices/bm_george.bin',
  '../../node_modules/kokoro-js/voices/bm_fable.bin',
  '../../node_modules/kokoro-js/voices/bm_lewis.bin',
  '../../node_modules/kokoro-js/voices/bm_daniel.bin',
], {
  query: '?url',
  import: 'default',
  eager: true,
})
const MAX_READ_ALOUD_CHUNK_LENGTH = 220
const READ_ALOUD_SENTENCE_END_PATTERN = /[.!?]+["')\]}»”’]*$/
const READ_ALOUD_CLAUSE_END_PATTERN = /[,;:]["')\]}»”’]*$/

let kokoroPromise = null
let kokoroVoiceFetchPatched = false
let kokoroVoiceCachePatched = false
let transformersConfigured = false

export function getReadableEditorText(editor) {
  return getReadableEditorPayload(editor).text
}

/**
 * Flatten the editor doc (or current selection) into plain text plus:
 * charToPos (text offset → doc position) and word ranges, used for
 * spoken-word highlighting.
 */
export function getReadableEditorPayload(editor) {
  if (!editor || editor.isDestroyed) {
    return { text: '', originalSelection: null, words: [] }
  }

  const { selection, doc } = editor.state
  const from = selection && !selection.empty ? selection.from : selection?.from ?? 0
  const to = selection && !selection.empty ? selection.to : doc.content.size
  const originalSelection = selection ? { from: selection.from, to: selection.to } : null
  let text = ''
  let charToPos = []
  let needsParagraphBreak = false

  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isBlock && pos > from) {
      needsParagraphBreak = true
      return true
    }

    if (node.type?.name === 'hardBreak') {
      text += '\n'
      charToPos.push(null)
      needsParagraphBreak = false
      return false
    }

    if (!node.isText || !node.text) return true

    const nodeStart = pos
    const nodeEnd = pos + node.text.length
    const sliceFrom = Math.max(from, nodeStart)
    const sliceTo = Math.min(to, nodeEnd)
    if (sliceTo <= sliceFrom) return false

    if (needsParagraphBreak && text && !/\n\s*\n$/.test(text)) {
      text += '\n\n'
      charToPos.push(null)
      charToPos.push(null)
    }

    const slice = node.text.slice(sliceFrom - nodeStart, sliceTo - nodeStart)
    for (let index = 0; index < slice.length; index += 1) {
      charToPos.push(sliceFrom + index)
    }

    text += slice
    needsParagraphBreak = false
    return false
  })

  const leadingWhitespace = text.match(/^\s*/)?.[0].length || 0
  const trailingWhitespace = text.match(/\s*$/)?.[0].length || 0

  if (leadingWhitespace) {
    text = text.slice(leadingWhitespace)
    charToPos = charToPos.slice(leadingWhitespace)
  }

  if (trailingWhitespace) {
    text = text.slice(0, -trailingWhitespace)
    charToPos = charToPos.slice(0, -trailingWhitespace)
  }

  return {
    text,
    originalSelection,
    words: getReadableWordRanges(text, charToPos),
  }
}

export async function getKokoroTTS(onProgress) {
  installKokoroVoiceFetchPatch()
  installKokoroVoiceCachePatch()
  await configureTransformersForTauri()

  if (!kokoroPromise) {
    kokoroPromise = import('kokoro-js')
      .then(({ KokoroTTS }) => withTimeout(
        KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
          ...KOKORO_OPTIONS,
          progress_callback: onProgress,
        }),
        KOKORO_MODEL_LOAD_TIMEOUT_MS,
        'Kokoro model load timed out. The first load needs to download the on-device model once; check your connection or install the model locally.'
      ))
      .catch((error) => {
        kokoroPromise = null
        throw error
      })
  }

  return kokoroPromise
}

async function configureTransformersForTauri() {
  if (transformersConfigured) return

  transformersConfigured = true
  const { env } = await import('@huggingface/transformers')

  // Tauri/WebKit cache can stall model loads. Direct fetch is easier to reason about.
  env.useBrowserCache = false
  env.useCustomCache = false
  env.useFSCache = false
  env.allowLocalModels = false
  env.allowRemoteModels = true

  if (env.backends?.onnx?.wasm) {
    // Tauri/WebKit can load threaded WASM and then stall during ONNX inference.
    // Single-threaded WASM is slower, but it avoids the "model loaded, no audio" hang.
    env.backends.onnx.wasm.numThreads = 1
    env.backends.onnx.wasm.proxy = false
  }
}

function withTimeout(promise, timeoutMs, message, code = '') {
  let timeoutId = null

  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      const error = new Error(message)
      if (code) error.code = code
      reject(error)
    }, timeoutMs)
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) window.clearTimeout(timeoutId)
  })
}

export function isKokoroGenerationTimeoutError(error) {
  return error?.code === KOKORO_GENERATE_TIMEOUT_CODE
    || String(error?.message || '').includes('Kokoro got stuck while generating audio')
}

export async function generateReadAloudAudio(text, {
  voice = DEFAULT_READ_ALOUD_VOICE,
  speed = 1,
  onProgress,
  onPhase,
} = {}) {
  try {
    return await generateNativeKokoroAudio(text, { voice, speed, onPhase })
  } catch (error) {
    if (!isTauriInvokeUnavailableError(error)) {
      throw error
    }
  }

  installKokoroVoiceFetchPatch()
  installKokoroVoiceCachePatch()

  onPhase?.('Preparing Kokoro...')
  const finalizingTimer = window.setTimeout(() => {
    onPhase?.('Finalizing Kokoro setup...')
  }, 1500)

  let tts = null
  try {
    tts = await getKokoroTTS(onProgress)
  } finally {
    window.clearTimeout(finalizingTimer)
  }

  onPhase?.('Generating speech...')
  await yieldToBrowser()

  try {
    return await withTimeout(
      Promise.resolve().then(() => tts.generate(text, { voice, speed })),
      KOKORO_GENERATE_TIMEOUT_MS,
      'Kokoro got stuck while generating audio. Switching to the built-in system voice.',
      KOKORO_GENERATE_TIMEOUT_CODE
    )
  } catch (error) {
    if (isKokoroGenerationTimeoutError(error)) {
      kokoroPromise = null
    }

    throw error
  }
}

export async function prewarmReadAloud({ voice = DEFAULT_READ_ALOUD_VOICE } = {}) {
  try {
    await withTimeout(
      invoke('prewarm_kokoro_speech', { voice }),
      NATIVE_KOKORO_PREWARM_TIMEOUT_MS,
      'Native Kokoro took too long to warm up.'
    )
  } catch (error) {
    if (!isTauriInvokeUnavailableError(error)) {
      throw error
    }
  }
}

async function generateNativeKokoroAudio(text, {
  voice = DEFAULT_READ_ALOUD_VOICE,
  speed = 1,
  onPhase,
} = {}) {
  onPhase?.('Starting native Kokoro...')

  const response = await withTimeout(
    invoke('generate_kokoro_speech', { text, voice, speed }),
    NATIVE_KOKORO_GENERATE_TIMEOUT_MS,
    'Native Kokoro took too long to generate audio.'
  )

  onPhase?.('Decoding Kokoro audio...')

  return {
    audio: base64ToFloat32Array(response.audioBase64),
    sampling_rate: response.sampleRate || 24000,
    engine: response.engine || 'kokoro-python',
    graphemes: response.graphemes || [],
    phonemes: response.phonemes || [],
  }
}

function base64ToFloat32Array(base64) {
  const binary = window.atob(base64 || '')
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new Float32Array(bytes.buffer)
}

function isTauriInvokeUnavailableError(error) {
  const message = String(error?.message || error || '')

  return message.includes('__TAURI_INTERNALS__')
    || (message.toLowerCase().includes('command') && message.toLowerCase().includes('not found'))
    || message.includes('invoke is not a function')
    || message.includes('window.__TAURI__')
}

function yieldToBrowser() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })
}

export function getLocalKokoroVoiceUrl(voice) {
  const matchingEntry = Object.entries(KOKORO_VOICE_ASSETS).find(([filePath]) => (
    filePath.endsWith(`/${voice}.bin`)
  ))

  return matchingEntry?.[1] || ''
}

function installKokoroVoiceFetchPatch() {
  if (kokoroVoiceFetchPatched || typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return
  }

  kokoroVoiceFetchPatched = true
  const originalFetch = window.fetch.bind(window)

  window.fetch = (input, init) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input?.url

    const voice = getKokoroVoiceFromUrl(url)
    const localVoiceUrl = voice ? getLocalKokoroVoiceUrl(voice) : ''

    if (localVoiceUrl) {
      return originalFetch(localVoiceUrl)
    }

    return originalFetch(input, init)
  }
}

function installKokoroVoiceCachePatch() {
  if (kokoroVoiceCachePatched || typeof window === 'undefined' || !window.caches?.open) {
    return
  }

  kokoroVoiceCachePatched = true
  const originalOpen = window.caches.open.bind(window.caches)

  window.caches.open = (cacheName) => {
    if (cacheName === 'kokoro-voices') {
      return Promise.resolve({
        match: async () => undefined,
        put: async () => undefined,
      })
    }

    return originalOpen(cacheName)
  }
}

function getKokoroVoiceFromUrl(url) {
  if (!url || typeof url !== 'string') return ''

  try {
    const parsedUrl = new URL(url, window.location.href)
    const voiceMatch = parsedUrl.pathname.match(/\/voices\/([^/]+)\.bin$/)
    if (!voiceMatch) return ''

    return READ_ALOUD_VOICES.some((voice) => voice.id === voiceMatch[1]) ? voiceMatch[1] : ''
  } catch {
    return ''
  }
}

export function splitReadAloudText(text, maxLength = MAX_READ_ALOUD_CHUNK_LENGTH) {
  const normalized = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .trim()
  if (!normalized) return []

  const words = [...normalized.matchAll(/\S+/g)].map((match) => ({
    text: match[0],
    startOffset: match.index,
    endOffset: match.index + match[0].length,
  }))

  return buildReadAloudChunks({ text: normalized, words }, maxLength).map((chunk) => chunk.text)
}

export function buildReadAloudChunks(payload, maxLength = MAX_READ_ALOUD_CHUNK_LENGTH) {
  if (!payload?.text || !payload.words?.length) return []

  const chunks = []
  const text = String(payload.text || '').replace(/\r\n/g, '\n')
  const words = getWordsWithTextOffsets(text, payload.words)
  const paragraphs = groupWordsByParagraphBreaks(text, words)

  for (const paragraphWords of paragraphs) {
    chunks.push(...buildParagraphReadAloudChunks(text, paragraphWords, maxLength))
  }

  return chunks
}

function getWordsWithTextOffsets(text, words) {
  let cursor = 0

  return (words || []).map((word) => {
    if (Number.isFinite(word.startOffset) && Number.isFinite(word.endOffset)) {
      return word
    }

    const startOffset = text.indexOf(word.text, cursor)
    if (startOffset === -1) return null

    const endOffset = startOffset + word.text.length
    cursor = endOffset
    return {
      ...word,
      startOffset,
      endOffset,
    }
  }).filter(Boolean)
}

function groupWordsByParagraphBreaks(text, words) {
  const paragraphs = []
  let paragraph = []

  for (const word of words) {
    const previousWord = paragraph.at(-1)
    const gap = previousWord ? text.slice(previousWord.endOffset, word.startOffset) : ''

    if (paragraph.length && /\n+/.test(gap)) {
      paragraphs.push(paragraph)
      paragraph = []
    }

    paragraph.push(word)
  }

  if (paragraph.length) {
    paragraphs.push(paragraph)
  }

  return paragraphs
}

function buildParagraphReadAloudChunks(text, words, maxLength) {
  const chunks = []
  const sentences = splitWordsIntoSentences(words)
  let currentWords = []

  const pushCurrent = () => {
    const chunk = buildChunkFromWords(text, currentWords)
    if (chunk) chunks.push(chunk)
    currentWords = []
  }

  for (const sentenceWords of sentences) {
    if (!sentenceWords.length) continue

    if (getWordsTextLength(text, sentenceWords) > maxLength) {
      pushCurrent()
      chunks.push(...splitLongSentenceIntoChunks(text, sentenceWords, maxLength))
      continue
    }

    const nextWords = currentWords.length ? [...currentWords, ...sentenceWords] : sentenceWords
    if (currentWords.length && getWordsTextLength(text, nextWords) > maxLength) {
      pushCurrent()
      currentWords = sentenceWords
      continue
    }

    currentWords = nextWords
  }

  pushCurrent()
  return chunks
}

function splitWordsIntoSentences(words) {
  const sentences = []
  let sentence = []

  for (const word of words) {
    sentence.push(word)

    if (READ_ALOUD_SENTENCE_END_PATTERN.test(word.text)) {
      sentences.push(sentence)
      sentence = []
    }
  }

  if (sentence.length) {
    sentences.push(sentence)
  }

  return sentences
}

function splitLongSentenceIntoChunks(text, words, maxLength) {
  const chunks = []
  let currentWords = []

  const pushWords = (wordsToPush) => {
    const chunk = buildChunkFromWords(text, wordsToPush)
    if (chunk) chunks.push(chunk)
  }

  for (const word of words) {
    currentWords.push(word)

    if (getWordsTextLength(text, currentWords) <= maxLength) {
      continue
    }

    const splitIndex = findLastClauseBoundary(text, currentWords, maxLength)
    if (splitIndex > 0) {
      pushWords(currentWords.slice(0, splitIndex))
      currentWords = currentWords.slice(splitIndex)
      continue
    }

    if (currentWords.length > 1) {
      const overflowWord = currentWords.pop()
      pushWords(currentWords)
      currentWords = [overflowWord]
    }
  }

  pushWords(currentWords)
  return chunks
}

function findLastClauseBoundary(text, words, maxLength) {
  for (let index = words.length - 2; index >= 1; index -= 1) {
    const candidateWords = words.slice(0, index + 1)
    if (
      READ_ALOUD_CLAUSE_END_PATTERN.test(words[index].text)
      && getWordsTextLength(text, candidateWords) <= maxLength
    ) {
      return index + 1
    }
  }

  return -1
}

function getWordsTextLength(text, words) {
  if (!words.length) return 0

  return normalizeSpeechChunkText(
    text.slice(words[0].startOffset, words.at(-1).endOffset)
  ).length
}

function buildChunkFromWords(text, words) {
  if (!words.length) return null

  const chunkText = normalizeSpeechChunkText(
    text.slice(words[0].startOffset, words.at(-1).endOffset)
  )

  return chunkText ? { text: chunkText, words } : null
}

function normalizeSpeechChunkText(text) {
  return String(text || '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()
}

function getReadableWordRanges(text, charToPos) {
  const words = []

  for (const match of text.matchAll(/\S+/g)) {
    const startOffset = match.index
    const endOffset = startOffset + match[0].length
    const from = firstMappedPosition(charToPos, startOffset, endOffset)
    const to = lastMappedPosition(charToPos, startOffset, endOffset)

    if (from === null || to === null || to < from) continue

    words.push({
      text: match[0],
      startOffset,
      endOffset,
      from,
      to: to + 1,
    })
  }

  return words
}

function firstMappedPosition(charToPos, start, end) {
  for (let index = start; index < end; index += 1) {
    if (Number.isFinite(charToPos[index])) return charToPos[index]
  }

  return null
}

function lastMappedPosition(charToPos, start, end) {
  for (let index = end - 1; index >= start; index -= 1) {
    if (Number.isFinite(charToPos[index])) return charToPos[index]
  }

  return null
}
