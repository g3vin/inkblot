/**
 * readAloud.js — text-to-speech engine for the read-aloud feature.
 *
 * Responsibilities:
 *  - Extract readable text from the editor along with a char→doc-position
 *    map and per-word ranges, so the UI can highlight the word being spoken.
 *  - Split that text into speakable chunks at paragraph/sentence/clause
 *    boundaries, so the first audio is ready quickly and highlighting stays in step.
 *  - Generate each chunk's audio with Pocket TTS, which runs natively
 *    (`inkblot-models/src/pocket_speech.rs`) from a model downloaded once. Where there
 *    is no native backend (a plain browser), the caller uses the system voices.
 */
import { invoke } from '@tauri-apps/api/core'
import { foldedRunAt } from '../extensions/HiddenText'

// A chunk takes a second or two; this is for a backend that has stopped answering.
const SPEECH_GENERATE_TIMEOUT_MS = 120000
const SPEECH_PREWARM_TIMEOUT_MS = 120000
const SPEECH_TIMEOUT_CODE = 'SPEECH_TIMEOUT'
const SPEECH_UNAVAILABLE_CODE = 'SPEECH_UNAVAILABLE'
const MODEL_NOT_INSTALLED = 'MODEL_NOT_INSTALLED'

/**
 * The voices Read Aloud offers, by Pocket TTS's names for them. The same ids are
 * `VOICES` in `pocket_speech.rs`, which downloads them; the `speech` suite checks the
 * two lists agree.
 */
export const READ_ALOUD_VOICES = [
  { id: 'alba', name: 'Alba' },
  { id: 'azelma', name: 'Azelma' },
  { id: 'george', name: 'George' },
  { id: 'mary', name: 'Mary' },
  { id: 'peter_yearsley', name: 'Peter' },
  { id: 'stuart_bell', name: 'Stuart' },
]
export const DEFAULT_READ_ALOUD_VOICE = 'alba'

const MAX_READ_ALOUD_CHUNK_LENGTH = 220
const READ_ALOUD_SENTENCE_END_PATTERN = /[.!?]+["')\]}»”’]*$/
const READ_ALOUD_CLAUSE_END_PATTERN = /[,;:]["')\]}»”’]*$/

/**
 * Flatten the editor doc (or current selection) into plain text plus:
 * charToPos (text offset → doc position) and word ranges, used for
 * spoken-word highlighting.
 *
 * `scope` is what the Read button means by default: a non-empty selection, else from
 * the caret to the end. The bridge's `getReadAloudPayload` asks for one of the other
 * two outright — `'selection'` (nothing when the selection is empty) or `'document'`.
 */
export function getReadableEditorPayload(editor, { scope = 'auto' } = {}) {
  if (!editor || editor.isDestroyed) {
    return { text: '', originalSelection: null, words: [] }
  }

  const { selection, doc } = editor.state
  const hasSelection = selection && !selection.empty
  let from = hasSelection ? selection.from : selection?.from ?? 0
  let to = hasSelection ? selection.to : doc.content.size
  if (scope === 'document') {
    from = 0
    to = doc.content.size
  } else if (scope === 'selection' && !hasSelection) {
    to = from
  }
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
    // Folded text is out of sight, so it isn't read either. Opened, it is read like the rest.
    if (foldedRunAt(editor.state, pos)) return false

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

/** The speech model hasn't been downloaded yet: offer the download. */
export function isModelNotInstalledError(error) {
  return String(error?.message || error || '').includes(MODEL_NOT_INSTALLED)
}

/**
 * Read with the system voices instead: there is no native backend here, or it has
 * stopped answering.
 */
export function shouldUseSystemSpeech(error) {
  return error?.code === SPEECH_UNAVAILABLE_CODE || error?.code === SPEECH_TIMEOUT_CODE
}

/** `invoke`, with the missing-backend case turned into `SPEECH_UNAVAILABLE`. */
async function invokeSpeech(command, args) {
  try {
    return await invoke(command, args)
  } catch (error) {
    if (!isTauriInvokeUnavailableError(error)) throw error
    const unavailable = new Error('On-device speech isn’t available here.')
    unavailable.code = SPEECH_UNAVAILABLE_CODE
    throw unavailable
  }
}

/** Speak `text` in `voice`: Float32 samples and their rate. */
export async function generateReadAloudAudio(text, {
  voice = DEFAULT_READ_ALOUD_VOICE,
  onPhase,
} = {}) {
  onPhase?.('Getting the voice ready…')

  const response = await withTimeout(
    invokeSpeech('generate_speech', { text, voice }),
    SPEECH_GENERATE_TIMEOUT_MS,
    'Speech took too long. Switching to the system voice.',
    SPEECH_TIMEOUT_CODE
  )

  return {
    audio: base64ToFloat32Array(response.audioBase64),
    sampling_rate: response.sampleRate || 24000,
    engine: response.engine || 'pocket-tts',
  }
}

/** Load the model and voice now, so pressing play doesn't wait for it. */
export async function prewarmReadAloud({ voice = DEFAULT_READ_ALOUD_VOICE } = {}) {
  await withTimeout(
    invokeSpeech('prewarm_speech', { voice }),
    SPEECH_PREWARM_TIMEOUT_MS,
    'The voice took too long to load.',
    SPEECH_TIMEOUT_CODE
  )
}

/**
 * `{ installed, missing }` for the speech model. A backend that answers nothing (the
 * browser's Tauri mock) counts as no backend.
 */
export async function getSpeechModelStatus() {
  const status = await invokeSpeech('speech_model_status')
  if (status) return status
  const unavailable = new Error('On-device speech isn’t available here.')
  unavailable.code = SPEECH_UNAVAILABLE_CODE
  throw unavailable
}

/**
 * Download the speech model and voices, calling `onProgress` with
 * `{ asset, index, count, received, total }` as each file arrives.
 */
export async function downloadSpeechModel(onProgress) {
  const { listen } = await import('@tauri-apps/api/event')
  const unlisten = await listen('speech://download', ({ payload }) => onProgress?.(payload))
  try {
    return await invokeSpeech('download_speech_model')
  } finally {
    unlisten()
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
