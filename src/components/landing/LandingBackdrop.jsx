/**
 * LandingBackdrop — the landing page's window: leaves in summer light, frosted, under
 * a sheet of the theme's paper (docs/DESIGN.md §6, "The landing backdrop").
 *
 * The clip is the website's, made small and soft once, when it was encoded, so playing
 * and frosting it costs little:
 *
 *   ffmpeg -i leaves-summer.mp4 -an -vf "scale=480:270,gblur=sigma=6" \
 *     -c:v libx264 -profile:v main -pix_fmt yuv420p -crf 30 -movflags +faststart leaves-frost.mp4
 *   (and the same to VP9 for leaves-frost.webm; the poster is one frame of it)
 *
 * The footage holds still on its poster under Reduce motion or Save-Data, gives way to
 * the plain tray under Reduce transparency, pauses while the window is hidden, and
 * stops once a project starts opening, so the GPU is free for the flight.
 *
 * Footage: "Leaves in summer" by Joaquim Baeta, CC BY 4.0 (THIRD-PARTY-NOTICES.md).
 */
import { useEffect, useRef, useState } from 'react'
import './LandingBackdrop.css'

/** The clip plays at half speed: the leaves drift rather than flutter behind the piles. */
const PLAYBACK_RATE = 0.5

const FOOTAGE = {
  mp4: '/media/landing/leaves-frost.mp4',
  webm: '/media/landing/leaves-frost.webm',
  poster: '/media/landing/leaves-frost-poster.jpg',
}

const matches = (query) => typeof window !== 'undefined' && window.matchMedia?.(query).matches

/** Whether the footage may play: not under Reduce motion, and not on a metered connection. */
function useMayPlay() {
  const [mayPlay, setMayPlay] = useState(() => !matches('(prefers-reduced-motion: reduce)') && !navigator.connection?.saveData)
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!query) return undefined
    const update = () => setMayPlay(!query.matches && !navigator.connection?.saveData)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return mayPlay
}

export default function LandingBackdrop({ still = false }) {
  const videoRef = useRef(null)
  const mayPlay = useMayPlay()
  const [failed, setFailed] = useState(false)
  const playing = mayPlay && !still && !failed

  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined
    const sync = () => {
      if (playing && document.visibilityState === 'visible') {
        video.defaultPlaybackRate = PLAYBACK_RATE
        video.playbackRate = PLAYBACK_RATE
        // Older WebKit returns nothing from play(), not a promise.
        video.play()?.catch?.(() => {})
      } else {
        video.pause()
      }
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [playing])

  return (
    <div className="landing-backdrop" aria-hidden="true">
      <div className="landing-backdrop-footage">
        {mayPlay && !failed ? (
          <video
            ref={videoRef}
            muted
            loop
            playsInline
            preload="auto"
            poster={FOOTAGE.poster}
            onError={() => setFailed(true)}
          >
            {/* H.264 first: WebKit decodes it in hardware. */}
            <source src={FOOTAGE.mp4} type="video/mp4" />
            <source src={FOOTAGE.webm} type="video/webm" onError={() => setFailed(true)} />
          </video>
        ) : (
          <img src={FOOTAGE.poster} alt="" decoding="async" />
        )}
      </div>
      <div className="landing-backdrop-scrim" />
    </div>
  )
}
