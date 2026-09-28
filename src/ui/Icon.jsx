/**
 * Icon.jsx — every icon in Inkblot. Glyphs are registered by meaning in ./icons.js.
 *
 * Phosphor Light at rest, Fill for an active/selected state; 16px inline and in dense
 * toolbars, 20px in primary toolbars and empty states. See docs/DESIGN.md → Iconography.
 */
import { ICONS } from './icons'

/**
 * @param {object} props
 * @param {keyof typeof ICONS} props.name
 * @param {16|20|number} [props.size=16]
 * @param {boolean} [props.active] Fill weight, for a selected/on state.
 * @param {string} [props.label] Accessible name. Omit for a decorative icon (the
 *   usual case — the control around it carries the name).
 */
export default function Icon({ name, size = 16, active = false, label, className, style }) {
  const Glyph = ICONS[name]
  if (!Glyph) {
    if (import.meta.env?.DEV) console.warn(`[Icon] unknown icon "${name}"`)
    return null
  }
  return (
    <Glyph
      size={size}
      weight={active ? 'fill' : 'light'}
      className={['ib-icon', className].filter(Boolean).join(' ')}
      style={style}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
    />
  )
}
