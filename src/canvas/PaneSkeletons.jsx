/**
 * PaneSkeletons — what a canvas, map or timeline pane shows while a slow document is
 * read. A spatial document has no layout to copy until it is open, so each suggests its
 * kind in the middle of the pane: a few cards, a sheet with pins, an axis with events.
 * They go inside a SkeletonOverlay (src/ui/Reveal.jsx), which decides when they show.
 */
import { Skeleton, SkeletonOverlay } from '../ui/Reveal.jsx'
import './PaneSkeletons.css'

/**
 * A pane's surface with its loading state: the empty surface (`backdrop`) shows at
 * once, so the pane looks like what it is; the loaded one fades in over it; the
 * skeleton shows only when the read is slow. `reveal` is the pane's useReveal(), and
 * `loaded` whether the document for the pane's current path is in.
 */
export function PaneSurfaceReveal({ reveal, loaded, backdrop, skeleton, label, children }) {
  return (
    <div className="pane-surface-reveal">
      {!loaded || reveal.phase === 'hidden' ? <div className="pane-surface-backdrop" aria-hidden="true">{backdrop}</div> : null}
      {loaded ? <div className="pane-surface-content" {...reveal.contentProps}>{children}</div> : null}
      <SkeletonOverlay visible={reveal.skeleton} label={label}>{skeleton}</SkeletonOverlay>
    </div>
  )
}

export function CanvasSkeleton() {
  return (
    <div className="pane-skeleton-stage">
      <div className="canvas-skeleton">
        <Skeleton className="pane-skeleton-block canvas-skeleton-card is-a" width="44%" height="46%" />
        <Skeleton className="pane-skeleton-block canvas-skeleton-card is-b" width="38%" height="34%" />
        <Skeleton className="pane-skeleton-block canvas-skeleton-card is-c" width="30%" height="40%" />
      </div>
    </div>
  )
}

export function MapSkeleton() {
  return (
    <div className="pane-skeleton-stage">
      <div className="map-skeleton">
        <Skeleton className="pane-skeleton-block" width="100%" height="100%" />
        <Skeleton className="map-skeleton-pin is-a" width="12px" height="12px" radius="pill" />
        <Skeleton className="map-skeleton-pin is-b" width="12px" height="12px" radius="pill" />
        <Skeleton className="map-skeleton-pin is-c" width="12px" height="12px" radius="pill" />
      </div>
    </div>
  )
}

export function TimelineSkeleton() {
  return (
    <div className="pane-skeleton-stage">
      <div className="timeline-skeleton">
        <Skeleton className="timeline-skeleton-axis" width="100%" height="2px" />
        {[0, 1, 2, 3, 4].map((index) => (
          <Skeleton key={index} className={`timeline-skeleton-event is-${index}`} width="clamp(40px, 16%, 88px)" height="22px" radius="pill" />
        ))}
      </div>
    </div>
  )
}
