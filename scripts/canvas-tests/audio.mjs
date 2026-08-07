/**
 * Voice memos on notes.
 *
 * The thing worth pinning is the storage decision: a memo goes into the project's
 * content-addressed asset store and the note keeps a PATH. Note images are base64 in
 * the note; audio must not be, or a one-minute memo would put ~700KB of base64 inside
 * the document JSON — re-parsed on every load and copied into every version-history
 * entry. A regression here is invisible until someone's project gets slow.
 */
const C = '../../src'
const { normalizeNote } = await import(`${C}/lib/noteUtils.js`)
const {
  normalizeNoteAudio,
  normalizeAudioClip,
  formatDuration,
  saveAudioClip,
} = await import(`${C}/lib/audioNotes.js`)
const { isAudioPath, isImagePath, mimeToExt, isAssetPath } = await import(`${C}/lib/assets.js`)
const ok = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) process.exitCode = 1 }

/* ---- mime → extension ---- */

// A MediaRecorder mime carries codec parameters; a naive lookup misses them entirely
// and every memo would land as a .png.
ok('mime with codecs resolves', mimeToExt('audio/webm;codecs=opus') === 'webm')
ok('bare audio mime resolves', mimeToExt('audio/mp4') === 'm4a')
ok('mime with whitespace resolves', mimeToExt('audio/webm; codecs=opus') === 'webm')
ok('images still resolve', mimeToExt('image/png') === 'png')
ok('an unknown mime resolves to nothing', mimeToExt('application/zip') === '')

ok('isAudioPath knows a memo', isAudioPath('.assets/abc123.webm'))
ok('isAudioPath rejects an image', !isAudioPath('.assets/abc123.png'))
ok('isImagePath rejects a memo', !isImagePath('.assets/abc123.webm'))

/* ---- the stored clip shape ---- */

const clip = normalizeAudioClip({ src: '.assets/x.webm', mimeType: 'audio/webm', durationMs: 4200 })
ok('a clip gets an id', typeof clip.id === 'string' && clip.id.length > 0)
ok('a clip keeps its path', clip.src === '.assets/x.webm')
ok('a clip keeps its duration', clip.durationMs === 4200)
ok('a clip is timestamped', typeof clip.createdAt === 'string')

ok('a clip with no src is rejected', normalizeAudioClip({ durationMs: 10 }) === null)
ok('garbage is rejected', normalizeAudioClip(null) === null)
ok('a bad duration falls back to 0', normalizeAudioClip({ src: 'a.webm', durationMs: NaN }).durationMs === 0)
ok('normalizeNoteAudio drops bad entries', normalizeNoteAudio([{ src: 'a.webm' }, null, {}]).length === 1)
ok('normalizeNoteAudio tolerates a non-array', normalizeNoteAudio('nope').length === 0)

/* ---- audio is a first-class note field ---- */

const note = normalizeNote({ id: 'n1', content: 'hi', audio: [{ src: '.assets/x.webm', durationMs: 1000 }] })
ok('a note carries its memos', note.audio.length === 1)
ok('a note with no memos gets an empty list', normalizeNote({ id: 'n2' }).audio.length === 0)
ok('legacy notes (no audio key) survive', Array.isArray(normalizeNote({ id: 'n3', content: 'old' }).audio))

/* ---- the storage decision: a path, not base64 ---- */

const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
const blob = { type: 'audio/webm;codecs=opus', arrayBuffer: async () => bytes.buffer }

const saved = await saveAudioClip('proj', blob, 3500)
ok('a memo is stored in the asset folder', isAssetPath(saved.src))
ok('...with the right extension', saved.src.endsWith('.webm'))
ok('...and the note holds a PATH, not base64', !saved.src.startsWith('data:') && saved.src.length < 80)
ok('the duration is recorded', saved.durationMs === 3500)

// Content-addressed: the same audio recorded twice is one file on disk.
const again = await saveAudioClip('proj', blob, 9999)
ok('identical audio dedupes to one file', again.src === saved.src)
ok('...but each clip is its own entry on the note', again.id !== saved.id)

/* ---- duration formatting ---- */

ok('formats seconds', formatDuration(4200) === '0:04')
ok('formats minutes', formatDuration(92000) === '1:32')
ok('pads seconds', formatDuration(65000) === '1:05')
ok('handles zero', formatDuration(0) === '0:00')
ok('handles nonsense', formatDuration(undefined) === '0:00')
