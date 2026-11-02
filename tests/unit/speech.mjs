/**
 * Read Aloud's speech, from the page's side (lib/readAloud.js).
 *
 *   - the voices the page offers are the ones Rust downloads (`VOICES` in
 *     pocket_speech.rs): a voice only one side knows is a voice that never speaks;
 *   - a chunk's samples come back from `generate_speech` as the Float32 they were;
 *   - a missing model is told apart from a missing backend: the first offers the
 *     download, the second reads with the system voices.
 */
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { installGlobals } from './install-globals.mjs'
import { setInvokeHandler } from './stub-core.mjs'
import { ok } from './assert.mjs'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
installGlobals(dom.window, ['window', 'document', 'navigator'])

const R = await import('../../src/lib/readAloud.js')

/* ---------------- the voices ---------------- */

const rust = readFileSync('src-tauri/crates/inkblot-models/src/pocket_speech.rs', 'utf8')
const rustVoices = [...rust.match(/pub const VOICES: &\[&str\] = &\[([^\]]*)\]/)[1].matchAll(/"([a-z_]+)"/g)]
  .map((match) => match[1])
const pageVoices = R.READ_ALOUD_VOICES.map((voice) => voice.id)
ok('the page offers the voices Rust downloads', JSON.stringify(pageVoices) === JSON.stringify(rustVoices))
ok('the default voice is one of them', pageVoices.includes(R.DEFAULT_READ_ALOUD_VOICE))
ok('every voice has a name', R.READ_ALOUD_VOICES.every((voice) => voice.name))

/* ---------------- generating ---------------- */

const samples = new Float32Array([0, 0.5, -0.25, 1])
const asBase64 = Buffer.from(samples.buffer).toString('base64')
let asked = null
setInvokeHandler(async (command, args) => {
  asked = { command, args }
  return { audioBase64: asBase64, sampleRate: 24000, engine: 'pocket-tts' }
})
const audio = await R.generateReadAloudAudio('Hello there.', { voice: 'fantine' })
ok('the text and voice go to generate_speech',
  asked.command === 'generate_speech' && asked.args.text === 'Hello there.' && asked.args.voice === 'fantine')
ok('the samples come back as they were', audio.audio instanceof Float32Array
  && audio.audio.length === 4 && audio.audio[1] === 0.5 && audio.audio[2] === -0.25)
ok('at the rate Rust names', audio.sampling_rate === 24000)

/* ---------------- what goes wrong ---------------- */

const failure = async (thrown) => {
  setInvokeHandler(async () => { throw thrown })
  try {
    await R.generateReadAloudAudio('Hello.')
    return null
  } catch (error) {
    return error
  }
}

const missing = await failure('MODEL_NOT_INSTALLED')
ok('a missing model is a missing model', R.isModelNotInstalledError(missing))
ok('which is downloaded, not read by the system voice', !R.shouldUseSystemSpeech(missing))

const noBackend = await failure(new TypeError("Cannot read properties of undefined (reading '__TAURI_INTERNALS__')"))
ok('no native backend reads with the system voice', R.shouldUseSystemSpeech(noBackend))
ok('and is not mistaken for a missing model', !R.isModelNotInstalledError(noBackend))

const broken = await failure('onnx run failed: bad input')
ok('any other failure is reported as it is', !R.shouldUseSystemSpeech(broken)
  && !R.isModelNotInstalledError(broken) && String(broken).includes('onnx run failed'))

setInvokeHandler(null)
