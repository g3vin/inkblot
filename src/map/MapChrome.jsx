/**
 * MapChrome.jsx — what sits on a map rather than in it: the scale bar, the compass
 * rose and the title cartouche. Each is anchored at a fraction of the view
 * (`style.*.at`), so it stays put while the map moves under it.
 *
 * The scale bar is measured, not assumed: it asks the map's space how far apart two
 * points 100 px either side of the view's centre are, so it is right on a calibrated
 * picture, on a projection whose scale changes with latitude, and on a star system.
 */
import { useEffect, useState } from 'react'
import { CompassRose } from './mapGlyphs'
import { scaleBarFor } from './mapChromeMath'

export default function MapChrome({ map, projector, space, viewport, surfaceRef }) {
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const element = surfaceRef.current
    if (!element) return undefined
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [surfaceRef])

  const { style } = map
  const place = (at) => ({ left: `${at[0] * 100}%`, top: `${at[1] * 100}%`, transform: 'translate(-50%, -50%)' })

  let bar = null
  if (style.scaleBar.show && size.width) {
    const nice = scaleBarFor(map, projector, space, viewport, size.width, size.height)
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
