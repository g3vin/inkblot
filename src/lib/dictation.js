/**
 * dictation.js — thin JS wrapper over the Rust dictation backend
 * (whisper.cpp). Exposes the model-load/start/stop/cancel commands and a
 * helper that subscribes to all `dictation://*` events (partial/final
 * transcripts, mic level, lifecycle) and returns one unsubscribe function.
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

/**
 * Loads a whisper model. Pass nothing and Rust resolves it — $INKBLOT_DICTATION_MODEL,
 * then `<AppData>/models/ggml-small.en.bin`, then `~/inkblot-dictation/models/`.
 * Rust owns that search order so both shells resolve the same model.
 */
export async function loadDictationModel(modelPath = null) {
  return invoke('load_dictation_model', {
    modelPath,
  })
}

export async function startDictation() {
  return invoke('start_dictation_session', {
    options: {
      language: 'en',
      partialIntervalMs: 1200,
      silenceMs: 1700,
      minChunkMs: 1600,
      maxChunkMs: 30000,
      silenceRmsThreshold: 0.012,
      cleanup: true,
    },
  })
}

export async function stopDictation() {
  return invoke('stop_dictation_session')
}

export async function setupDictationListeners({
  onStarted,
  onPartial,
  onFinal,
  onLevel,
  onStopped,
  onError,
} = {}) {
  const unlistenStarted = await listen('dictation://started', (event) => {
    onStarted?.(event.payload)
  })

  const unlistenPartial = await listen('dictation://partial', (event) => {
    onPartial?.(event.payload)
  })

  const unlistenFinal = await listen('dictation://final', (event) => {
    onFinal?.(event.payload)
  })

  const unlistenLevel = await listen('dictation://level', (event) => {
    onLevel?.(event.payload)
  })

  const unlistenStopped = await listen('dictation://stopped', (event) => {
    onStopped?.(event.payload)
  })

  const unlistenError = await listen('dictation://error', (event) => {
    onError?.(event.payload)
  })

  return () => {
    unlistenStarted()
    unlistenPartial()
    unlistenFinal()
    unlistenLevel()
    unlistenStopped()
    unlistenError()
  }
}
