/**
 * SFIcon.jsx — legacy adapter: SF-Symbols-style names → src/ui/Icon.
 *
 * Kept so the ~100 existing call sites keep working while surfaces migrate. New code
 * imports `Icon` from src/ui and uses its semantic names; when the last SFIcon call
 * site is gone, delete this file (docs/DESIGN.md → Migration).
 */
import Icon from '../ui/Icon.jsx'
import { resolveSFIcon } from './sfIconNames.js'

export default function SFIcon({ name, filled = false, className = '', title, size = 16 }) {
  const isFillVariant = /\.fill$/.test(name)
  const semantic = resolveSFIcon(name) || 'search'
  return (
    <span className="sf-icon" aria-hidden="true" title={title}>
      <Icon name={semantic} size={size} active={filled || isFillVariant} className={className || undefined} />
    </span>
  )
}
