/**
 * Breadcrumb — where something sits in a chain of things that contain it: a galaxy,
 * then a star system, then a world. Each step but the last is a button that goes
 * there; the last is where you are.
 *
 *   <Breadcrumb label="Where this map is" onSelect={open} items={[
 *     { id: 'Milky Way.map', label: 'Milky Way', icon: 'map' },
 *     { id: 'Sol.map', label: 'Sol', icon: 'orbit' },
 *     { id: 'Earth.map', label: 'Earth' },
 *   ]} />
 *
 * A long trail keeps its first and last steps and folds the middle into "…".
 */
import Icon from './Icon.jsx'
import './ui.css'

const MAX_STEPS = 4

export default function Breadcrumb({ items, onSelect, label = 'Breadcrumb', className = '' }) {
  if (!items?.length) return null
  const folded = items.length > MAX_STEPS
    ? [items[0], { id: '…', label: '…', folded: items.slice(1, -2) }, ...items.slice(-2)]
    : items
  return (
    <nav className={`ib-breadcrumb ${className}`.trim()} aria-label={label}>
      <ol>
        {folded.map((item, index) => {
          const last = index === folded.length - 1
          return (
            <li key={item.id}>
              {last ? (
                <span className="ib-breadcrumb-here" aria-current="page">
                  {item.icon ? <Icon name={item.icon} size={16} /> : null}
                  <span>{item.label}</span>
                </span>
              ) : item.folded ? (
                <span className="ib-breadcrumb-fold" title={item.folded.map((step) => step.label).join(' › ')}>…</span>
              ) : (
                <button type="button" className="ib-breadcrumb-step" onClick={() => onSelect?.(item.id)}>
                  {item.icon ? <Icon name={item.icon} size={16} /> : null}
                  <span>{item.label}</span>
                </button>
              )}
              {last ? null : <Icon name="chevron-right" size={16} className="ib-breadcrumb-sep" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
