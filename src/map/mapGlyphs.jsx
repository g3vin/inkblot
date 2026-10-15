/**
 * mapGlyphs.jsx — the little pictures a map is made of: pin markers and compass
 * roses. Drawn in screen pixels around the origin (a pin's point is at 0,0, the
 * glyph above it), inside a `.map-mark` group that cancels the world's zoom.
 */

/** The glyph drawn inside a round badge for each icon (a 16×16 box around 0,0). */
const BADGES = {
  city: <path d="M-6 5V-2l3-2v-3h3v2l3-2v12z M-1 5v-3h2v3" />,
  town: <path d="M-6 5V-1l6-5 6 5v6z M-1.5 5v-4h3v4" />,
  castle: <path d="M-6 6V-5h2.4v2h1.2v-2h2.8v2h1.2v-2H6V6z M-1.5 6V2a1.5 1.5 0 0 1 3 0v4" />,
  port: <path d="M0-6v11 M-5 1a5 5 0 0 0 10 0 M-3-4h6 M0-6a1.3 1.3 0 1 0 0 .1" fill="none" strokeWidth="1.6" />,
  temple: <path d="M-7-2 0-7 7-2z M-5-1v6 M-1.7-1v6 M1.7-1v6 M5-1v6 M-7 6h14" fill="none" strokeWidth="1.5" />,
  tower: <path d="M-3 6l1-10h4l1 10z M-4-4h8v-3h-2v1.5h-1.3V-7h-1.4v1.5H-2V-7h-2z" />,
  mountain: <path d="M-7 5l5-9 3 5 2-3 4 7z" />,
  cave: <path d="M-7 5a7 8 0 0 1 14 0z M-3 5a3 4 0 0 1 6 0z" fillRule="evenodd" />,
  ruin: <path d="M-6 6V-3h2v9 M-1 6V-6h2v12 M4 6V0h2v6 M-7 6h14" fill="none" strokeWidth="1.6" />,
  camp: <path d="M-7 5L0-6l7 11z M0-6v11" fill="none" strokeWidth="1.6" strokeLinejoin="round" />,
  battle: <path d="M-6-6l12 12 M6-6L-6 6 M-6 3l3 3 M3 6l3-3" fill="none" strokeWidth="1.8" strokeLinecap="round" />,
  star: <path d="M0-7l2 4.8 5.2.5-4 3.5 1.2 5.1L0 3.4-4.4 6.4-3.2 1.3l-4-3.5 5.2-.5z" />,
  system: <path d="M0-2.2a2.2 2.2 0 1 0 .1 0z M-6.5 0a6.5 3 0 1 0 13 0a6.5 3 0 1 0-13 0z M5 -2.2a1.3 1.3 0 1 0 .1 0z" fill="none" strokeWidth="1.4" />,
  galaxy: <path d="M0 0c1.8-1.6 4.2-.4 4.2 1.8 0 3-4 4.6-6.8 3C-6 3-6.4-1.6-4.4-4c2.6-3 8-3 10 .6 M0 0c-1.8 1.6-4.2.4-4.2-1.8 0-3 4-4.6 6.8-3 3.4 1.8 3.8 6.4 1.8 8.8-2.6 3-8 3-10-.6" fill="none" strokeWidth="1.3" strokeLinecap="round" />,
  skull: <path d="M0-6a6 6 0 0 0-6 6c0 2 1 3 2 3.6V6h8V3.6c1-.6 2-1.6 2-3.6a6 6 0 0 0-6-6z M-2.5-.5a1.3 1.3 0 1 0 .1 0z M2.5-.5a1.3 1.3 0 1 0 .1 0z" fillRule="evenodd" />,
}

/**
 * A pin: the classic teardrop for `pin`, otherwise a round badge on a short stem
 * with the icon inside. The point it marks is the tip, at 0,0.
 */
export function PinGlyph({ icon = 'pin', color }) {
  const fill = color || 'var(--map-pin)'
  if (!BADGES[icon]) {
    return (
      <g>
        <path className="map-pin-body" style={{ fill }} d="M0 0C-1.6-5-8-8.6-8-15.4a8 8 0 0 1 16 0C8-8.6 1.6-5 0 0z" />
        <circle className="map-pin-eye" cy={-15.5} r={3.2} />
      </g>
    )
  }
  return (
    <g>
      <path className="map-pin-body" style={{ fill }} d="M-1.2 0h2.4l1-6h-4.4z" />
      <circle className="map-pin-body" style={{ fill }} cy={-17} r={11} />
      <g transform="translate(0 -17)" fill="var(--map-sheet)" stroke="var(--map-sheet)" strokeWidth="0">
        {BADGES[icon]}
      </g>
    </g>
  )
}

/** A compass rose `size` px across, with north up (rotate the group for a globe). */
export function CompassRose({ size = 96, variant = 'rose8' }) {
  const r = size / 2
  const point = (angle, length, width) => {
    const a = (angle * Math.PI) / 180
    const tip = [Math.sin(a) * length, -Math.cos(a) * length]
    const left = [Math.sin(a - Math.PI / 2) * width, -Math.cos(a - Math.PI / 2) * width]
    const right = [Math.sin(a + Math.PI / 2) * width, -Math.cos(a + Math.PI / 2) * width]
    return { tip, left, right }
  }
  const blade = (angle, length, width, key) => {
    const { tip, left, right } = point(angle, length, width)
    return (
      <g key={key}>
        <path d={`M0 0L${left[0]} ${left[1]}L${tip[0]} ${tip[1]}z`} fill="currentColor" />
        <path d={`M0 0L${right[0]} ${right[1]}L${tip[0]} ${tip[1]}z`} fill="var(--map-sheet)" stroke="currentColor" strokeWidth="0.8" />
      </g>
    )
  }
  if (variant === 'simple') {
    return (
      <svg width={size * 0.5} height={size} viewBox={`${-r / 2} ${-r} ${r} ${size}`} aria-label="North">
        <path d={`M0 ${-r * 0.55}L${r * 0.28} ${r * 0.5}L0 ${r * 0.3}L${-r * 0.28} ${r * 0.5}z`} fill="currentColor" />
        <text y={-r * 0.65} textAnchor="middle" fontSize={r * 0.42} fontWeight="700" fill="currentColor" fontFamily="var(--map-label-font)">N</text>
      </svg>
    )
  }
  return (
    <svg width={size} height={size} viewBox={`${-r} ${-r} ${size} ${size}`} aria-label="Compass rose">
      <circle r={r * 0.62} fill="none" stroke="currentColor" strokeWidth="0.8" />
      <circle r={r * 0.56} fill="none" stroke="currentColor" strokeWidth="0.4" />
      {variant === 'rose8' ? [45, 135, 225, 315].map((angle) => blade(angle, r * 0.5, r * 0.08, `d${angle}`)) : null}
      {[0, 90, 180, 270].map((angle) => blade(angle, r * 0.8, r * 0.12, `c${angle}`))}
      <text y={-r * 0.84} textAnchor="middle" fontSize={r * 0.26} fontWeight="700" fill="currentColor" fontFamily="var(--map-label-font)">N</text>
    </svg>
  )
}

const KEY_DASHES = { dashed: '6 4', dotted: '1 4' }
const KEY_ROW = 22
const KEY_PAD = 12

/** How wide the key's box is for `entries`: the longest label, roughly. */
const mapKeySize = (entries) => ({
  width: KEY_PAD * 2 + 34 + Math.max(40, ...entries.map((entry) => entry.label.length * 6.4)),
  height: KEY_PAD * 2 + 18 + entries.length * KEY_ROW,
})

/**
 * The map's key (mapLegend.js's entries), as SVG in the map's own ink and sheet:
 * drawn the same on screen and in an exported picture.
 */
export function MapKey({ entries }) {
  const { width, height } = mapKeySize(entries)
  return (
    <svg className="map-key-card" width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <rect x={0.5} y={0.5} width={width - 1} height={height - 1} rx={4} fill="var(--map-sheet)" stroke="var(--map-ink)" strokeOpacity={0.5} />
      <text x={KEY_PAD} y={KEY_PAD + 9} fill="var(--map-ink)" fontSize={10} fontWeight={700} letterSpacing={1.2} fontFamily="var(--font-ui, system-ui)">KEY</text>
      {entries.map((entry, index) => {
        const y = KEY_PAD + 18 + index * KEY_ROW + KEY_ROW / 2
        let swatch
        if (entry.kind === 'pin') {
          swatch = <g transform="translate(14 8) scale(0.62)"><PinGlyph icon={entry.icon} color={entry.color} /></g>
        } else if (entry.kind === 'region') {
          const fill = entry.fill || 'var(--map-region)'
          swatch = <rect x={3} y={-6} width={22} height={12} rx={2} fill={fill} fillOpacity={0.45} stroke={fill} />
        } else if (entry.kind === 'route') {
          const stroke = entry.stroke || 'var(--map-route)'
          swatch = <path d="M2 0h24" stroke={stroke} strokeWidth={Math.min(4, entry.width || 2)} strokeDasharray={KEY_DASHES[entry.dash]} strokeLinecap="round" fill="none" />
        } else {
          swatch = <circle cx={14} cy={0} r={5} fill={entry.color} stroke="var(--map-sheet)" strokeWidth={1.5} />
        }
        return (
          <g key={`${entry.kind}-${index}`} transform={`translate(${KEY_PAD} ${y})`}>
            {swatch}
            <text x={34} y={4} fill="var(--map-ink)" fontSize={11.5} fontFamily="var(--map-label-font, serif)">{entry.label}</text>
          </g>
        )
      })}
    </svg>
  )
}
