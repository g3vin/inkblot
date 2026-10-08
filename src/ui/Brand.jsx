/**
 * Brand.jsx — the Inkblot logo, drawn inline so it takes the page's colour.
 *
 *   <AppIcon size={96} />   the black mark on its white rounded tile (welcome window,
 *                           about box; the same artwork as the app icon and favicon)
 *   <Mark size={32} />      the mark alone: a lowercase i whose dot is an ink spray
 *   <Wordmark height={28} /> the mark's i followed by "nkblot" in Courier Prime Bold
 *
 * The mark and wordmark draw in `currentColor`: black (--brand-mark) on white or paper,
 * and the page's ink colour on a dark surface. Never recolour them in an ink or the
 * accent, add effects, or set the name in another face. See docs/DESIGN.md → Brand.
 */
import { ICON_TRANSFORM, MARK_PATHS, WORDMARK } from './brandPaths.js'

// An empty label marks the logo as decoration (beside a visible name, say).
const a11y = (label) => (label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })

export function Mark({ size = 32, label = 'Inkblot', className, style }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} fill="currentColor" {...a11y(label)}
      className={className} style={style}>
      {MARK_PATHS.map((d, i) => <path key={i} d={d} />)}
    </svg>
  )
}

export function AppIcon({ size = 96, label = 'Inkblot', className, style }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} {...a11y(label)} className={className} style={style}>
      <rect width="64" height="64" rx="14" fill="var(--brand-tile)" />
      <g fill="var(--brand-mark)" transform={ICON_TRANSFORM}>
        {MARK_PATHS.map((d, i) => <path key={i} d={d} />)}
      </g>
    </svg>
  )
}

export function Wordmark({ height = 28, label = 'Inkblot', className, style }) {
  const [, , w, h] = WORDMARK.viewBox.split(' ').map(Number)
  return (
    <svg viewBox={WORDMARK.viewBox} height={height} width={(height * w) / h} fill="currentColor"
      {...a11y(label)} className={className} style={style}>
      <g transform={WORDMARK.flip}>
        <path d={WORDMARK.shapes} />
        <g transform={WORDMARK.sprayTransform}>
          {WORDMARK.spray.map((d, i) => <path key={i} d={d} />)}
        </g>
      </g>
    </svg>
  )
}
