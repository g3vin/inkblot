/**
 * audioNotes.js — voice memos attached to a note.
 *
 * Stored in the project's content-addressed `.assets/` folder and referenced by path,
 * NOT base64-inlined the way note images are. A note image is a thumbnail; a voice
 * memo is a minute of audio, and inlining one would put ~700KB of base64 inside the
 * document JSON — which is re-parsed on every load and copied into every version
 * history entry. Same reasoning as canvas images (see assets.js).
 *
 * Because it is the same content-addressed store, recording the identical audio twice
 * writes one file.
 *
 * The recording itself is plain MediaRecorder. `NSMicrophoneUsageDescription` is
 * already declared in Info.plist (dictation needs it), so the webview can prompt for
 * the mic without any new entitlement.
 *
 * Mirrors: `src-tauri/crates/inkblot-core/src/notes.rs`; `npm run parity` asserts they agree.
 */
import { writeAssetFromBlob } from './assets'

/**
 * The container to record in, best-supported first.
 *
 * Safari/WKWebView records mp4/aac and does NOT support webm; Chromium records
 * webm/opus. Asking for an unsupported type throws, so pick one the engine admits to
 * handling and let it fall back to its own default if none match.
 */
const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
]

export function pickRecorderMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const type of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported?.(type)) return type
  }
  return ''
}

export const canRecordAudio = () =>
  typeof MediaRecorder !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices?.getUserMedia

/** `92000` → `1:32`. Always m:ss, so a list of clips lines up. */
export function formatDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0) / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = Math.floor(total % 60)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/* ---------------- the stored shape ---------------- */

export const normalizeAudioClip = (clip = {}) => {
  if (!clip || typeof clip !== 'object') return null
  // `src` is a project-relative asset path, e.g. `.assets/fnv1a2b3c4.webm`.
  if (typeof clip.src !== 'string' || !clip.src.trim()) return null

  return {
    id: typeof clip.id === 'string' && clip.id.trim() ? clip.id : crypto.randomUUID(),
    src: clip.src,
    mimeType: typeof clip.mimeType === 'string' ? clip.mimeType : 'audio/webm',
    durationMs: Number.isFinite(clip.durationMs) ? Math.max(0, clip.durationMs) : 0,
    createdAt: typeof clip.createdAt === 'string' ? clip.createdAt : new Date().toISOString(),
  }
}

export const normalizeNoteAudio = (audio = []) =>
  Array.isArray(audio) ? audio.map(normalizeAudioClip).filter(Boolean) : []

/** Write a recorded blob into the project's asset store and describe it for the note. */
export async function saveAudioClip(projectName, blob, durationMs) {
  const src = await writeAssetFromBlob(projectName, blob)
  return normalizeAudioClip({
    src,
    mimeType: blob.type || 'audio/webm',
    durationMs,
    createdAt: new Date().toISOString(),
  })
}

/* ---------------- recording ---------------- */

/**
 * Start recording. Resolves to a handle; call `stop()` for the blob, or `cancel()` to
 * throw the recording away.
 *
 * The microphone track is stopped in BOTH paths — leaving it live keeps the OS
 * recording indicator lit and holds the device open, which looks (reasonably) like
 * the app is still listening to you.
 */
export async function startAudioRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mimeType = pickRecorderMimeType()
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

  const chunks = []
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data?.size) chunks.push(event.data)
  })

  const startedAt = Date.now()
  recorder.start()

  const releaseMic = () => {
    for (const track of stream.getTracks()) track.stop()
  }

  const stop = () =>
    new Promise((resolve, reject) => {
      if (recorder.state === 'inactive') {
        releaseMic()
        resolve(null)
        return
      }

      recorder.addEventListener(
        'stop',
        () => {
          releaseMic()
          if (!chunks.length) {
            resolve(null)
            return
          }
          resolve({
            blob: new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }),
            durationMs: Date.now() - startedAt,
          })
        },
        { once: true }
      )
      recorder.addEventListener('error', (event) => {
        releaseMic()
        reject(event.error || new Error('Recording failed'))
      }, { once: true })

      recorder.stop()
    })

  const cancel = () => {
    try {
      if (recorder.state !== 'inactive') recorder.stop()
    } finally {
      releaseMic()
    }
  }

  return { stop, cancel, startedAt }
}
