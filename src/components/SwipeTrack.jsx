/**
 * SwipeTrack — a row of panels that follows a sidebar's swipe (hooks/useSpaceSwipe), one
 * panel per `count`th of its width.
 *
 * It reads the swipe's progress itself, so a frame of the swipe re-renders this track
 * and nothing above it. Its children are drawn by the parent, which isn't re-rendered,
 * so the panels in it aren't either.
 */
import { useSwipeProgress } from '../hooks/useSpaceSwipe'

export default function SwipeTrack({ swipe, count, reducedMotion = false, className, style, children }) {
  const progress = useSwipeProgress(swipe)
  return (
    <div
      className={className}
      style={{
        ...style,
        '--sidebar-pane-count': count,
        width: `${count * 100}%`,
        transform: `translateX(-${progress * (100 / count)}%)`,
        // On the fingers while they swipe; otherwise sprung there on the compositor,
        // with a swipe's speed kept.
        transition: swipe.moving || reducedMotion ? 'none' : `transform ${swipe.snap}`,
      }}
    >
      {children}
    </div>
  )
}
