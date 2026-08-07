/**
 * AudioNotes.jsx — voice memos attached to a note.
 *
 * Used everywhere a note appears: the notes panel, the in-line hover preview over a
 * document, and a note card on a canvas. They all hold the same note, so a memo
 * recorded in one shows up in the others.
 *
 * The clip LIST and the record BUTTON are separate exports on purpose. In the notes
 * panel the clips stay visible (you must be able to play a memo without entering edit
 * mode) while the record button lives in the footer and only appears while the note is
 * being edited. Elsewhere the two are shown together.
 *
 * Clips live in the project's asset store and are referenced by path (audioNotes.js),
 * so this needs `projectName` to resolve them for playback.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import SFIcon from './SFIcon'
import { assetUrl } from '../lib/assets'
import { formatDuration } from '../lib/audioNotes'
import { useAudioRecorder } from '../hooks/useAudioRecorder'

/** One clip: play/pause, its length, and a delete. */
function AudioClip({ clip, projectName, onRemove }) {
  const [url, setUrl] = useState(null)
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    assetUrl(projectName, clip.src).then((resolved) => {
      if (!cancelled) setUrl(resolved)
    })
    return () => {
      cancelled = true
    }
  }, [clip.src, projectName])

  const toggle = (event) => {
    event.stopPropagation()
    const audio = audioRef.current
    if (!audio) return
    if (playing) audio.pause()
    else void audio.play().catch(() => setPlaying(false))
  }

  return (
    <div className="audio-clip" onPointerDown={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="audio-clip-play"
        onClick={toggle}
        disabled={!url}
        aria-label={playing ? 'Pause' : 'Play'}
        title={playing ? 'Pause' : 'Play'}
      >
        <SFIcon name={playing ? 'pause' : 'play'} size={11} />
      </button>

      <span className="audio-clip-time">{formatDuration(clip.durationMs)}</span>

      <button
        type="button"
        className="audio-clip-remove"
        onClick={(event) => {
          event.stopPropagation()
          onRemove?.(clip.id)
        }}
        aria-label="Delete voice memo"
        title="Delete voice memo"
      >
        <SFIcon name="xmark" size={10} />
      </button>

      {url ? (
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
      ) : null}
    </div>
  )
}

/** The memos already on a note. Always visible — a memo must be playable to read. */
export function AudioClipList({ audio = [], projectName, onChange }) {
  const remove = useCallback(
    (clipId) => {
      // The asset file is deliberately left on disk: another note (or an undo) may
      // still reference the same content-addressed hash. Same policy as canvas images.
      onChange?.(audio.filter((clip) => clip.id !== clipId))
    },
    [audio, onChange]
  )

  if (!projectName || !audio.length) return null

  return (
    <div className="audio-clips">
      {audio.map((clip) => (
        <AudioClip key={clip.id} clip={clip} projectName={projectName} onRemove={remove} />
      ))}
    </div>
  )
}

/**
 * The record button. Appends the finished clip to `audio`.
 *
 * `iconOnly` is for the notes-panel footer, where it sits beside the other per-note
 * tools and has to match their size.
 */
export function AudioRecordButton({ audio = [], projectName, onChange, iconOnly = false }) {
  const { supported, recording, elapsed, error, start, stop } = useAudioRecorder(projectName)

  if (!projectName || !supported) return null

  const handle = async (event) => {
    event.preventDefault()
    event.stopPropagation()

    if (!recording) {
      await start()
      return
    }

    const clip = await stop()
    if (clip) onChange?.([...audio, clip])
  }

  return (
    <button
      type="button"
      className={`audio-record${recording ? ' is-recording' : ''}${iconOnly ? ' is-icon-only' : ''}`}
      onClick={handle}
      // A press here must never reach a draggable card underneath.
      onPointerDown={(event) => event.stopPropagation()}
      aria-label={recording ? 'Stop recording' : 'Record a voice memo'}
      title={error || (recording ? 'Stop recording' : 'Record a voice memo')}
    >
      {recording ? (
        <>
          <span className="audio-record-dot" aria-hidden="true" />
          <span className="audio-record-time">{formatDuration(elapsed)}</span>
        </>
      ) : (
        <SFIcon name="mic" size={12} />
      )}
    </button>
  )
}

/** Clips plus the record button — the default arrangement. */
export default function AudioNotes({ audio = [], projectName, onChange, compact = false }) {
  if (!projectName) return null

  return (
    <div className={`audio-notes${compact ? ' is-compact' : ''}`}>
      <AudioClipList audio={audio} projectName={projectName} onChange={onChange} />
      <AudioRecordButton audio={audio} projectName={projectName} onChange={onChange} />
    </div>
  )
}
