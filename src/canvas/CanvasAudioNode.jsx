/**
 * CanvasAudioNode.jsx — a voice memo sitting on the canvas.
 *
 * A spec `file` node pointing at the recording in the project's asset store, exactly
 * like an image card. Another JSON Canvas reader sees a file reference, which is what
 * it is.
 *
 * This is the standalone memo — "think out loud, drop it on the board". A memo
 * attached to a NOTE is a different thing and lives on that note (see AudioNotes).
 */
import { useRef, useState } from 'react'
import SFIcon from '../components/SFIcon'
import { formatDuration } from '../lib/audioNotes'
import { useAssetUrl } from './useAssetUrl'

export default function CanvasAudioNode({ node, projectName }) {
  const url = useAssetUrl(projectName, node.file)
  const audioRef = useRef(null)

  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  // Prefer the duration recorded at capture time: a webm/opus blob from MediaRecorder
  // often reports Infinity for duration until it has been fully seeked.
  const [duration, setDuration] = useState(node.inkblotDurationMs || 0)

  const toggle = (event) => {
    event.stopPropagation()
    const audio = audioRef.current
    if (!audio) return
    if (playing) audio.pause()
    else void audio.play().catch(() => setPlaying(false))
  }

  const seek = (event) => {
    event.stopPropagation()
    const audio = audioRef.current
    if (!audio || !duration) return

    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    audio.currentTime = (ratio * duration) / 1000
  }

  return (
    <div className="canvas-audio" onPointerDown={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="canvas-audio-play"
        onClick={toggle}
        disabled={!url}
        aria-label={playing ? 'Pause' : 'Play'}
        title={playing ? 'Pause' : 'Play'}
      >
        <SFIcon name={playing ? 'pause' : 'play'} size={16} />
      </button>

      <div className="canvas-audio-body">
        <div className="canvas-audio-track" onClick={seek}>
          <div
            className="canvas-audio-fill"
            style={{ width: `${duration ? Math.min(100, (progress / duration) * 100) : 0}%` }}
          />
        </div>
        <span className="canvas-audio-time">
          {formatDuration(playing || progress ? progress : duration)}
        </span>
      </div>

      {url ? (
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false)
            setProgress(0)
          }}
          onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime * 1000)}
          onLoadedMetadata={(event) => {
            const seconds = event.currentTarget.duration
            if (Number.isFinite(seconds) && seconds > 0) setDuration(seconds * 1000)
          }}
        />
      ) : null}
    </div>
  )
}
