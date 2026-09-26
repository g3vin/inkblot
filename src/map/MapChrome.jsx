/**
 * MapChrome.jsx — what sits on a map rather than in it: the scale bar, the compass
 * rose and the title cartouche. Each is anchored at a fraction of the view
 * (`style.*.at`), so it stays put while the map moves under it.
 *
 * They are placed in the part of the map nothing else covers (`useVisibleBox`): under
 * the Swift shell the map runs on beneath its glass sidebars and toolbar.
 *
 * The scale bar is measured, not assumed: it asks the map's space how far apart two
 * points 100 px either side of the view's centre are, so it is right on a calibrated
 * picture, on a projection whose scale changes with latitude, and on a star system.
 */
import { CompassRose } from './mapGlyphs'
import { scaleBarFor } from './mapChromeMath'

export default function MapChrome({ map, projector, space, viewport, box }) {
  const { style } = map
  const place = (at) => ({
    left: `${box.left + at[0] * box.width}px`,
    top: `${box.top + at[1] * box.height}px`,
    transform: 'translate(-50%, -50%)',
  })

  let bar = null
  if (style.scaleBar.show && box.surfaceWidth) {
    const nice = scaleBarFor(map, projector, space, viewport, box.surfaceWidth, box.surfaceHeight)
    if (nice) {
      const half = nice.px / 2
      bar = (
        <div className="map-scale-bar" style={{ ...place(style.scaleBar.at), transform: 'translate(0, -50%)' }}>
          <svg width={nice.px + 2} height={10} style={{ display: 'block' }}>
            <rect x={1} y={2} width={half} height={5} fill="currentColor" />
            <rect x={1 + half} y={2} width={half} height={5} fill="none" stroke="currentColor" strokeWidth={1} />
            <rect x={1} y={2} width={nice.px} height={5} fill="none" stroke="currentColor" strokeWidth={1} />
          </svg>
          <div style={{ marginTop: 3 }}>{nice.label}</div>
        </div>
      )
    }
  }

  return (
    <>
      {bar}
      {style.compass.show && map.mapKind !== 'system' ? (
        <div className="map-compass" style={place(style.compass.at)}>
          <CompassRose size={style.compass.size} variant={style.compass.style} />
        </div>
      ) : null}
      {style.cartouche.show && (style.cartouche.title || style.cartouche.subtitle) ? (
        <div className="map-cartouche" style={{ ...place(style.cartouche.at), transform: 'none' }}>
          {style.cartouche.title ? <div className="map-cartouche-title">{style.cartouche.title}</div> : null}
          {style.cartouche.subtitle ? <div className="map-cartouche-subtitle">{style.cartouche.subtitle}</div> : null}
        </div>
      ) : null}
    </>
  )
}
