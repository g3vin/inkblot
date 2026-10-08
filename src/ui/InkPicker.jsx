/**
 * InkPicker.jsx — choose one ink from the palette (note colour, card colour, accent).
 *
 * A row of swatches with roving arrow-key focus. Every colour choice in Inkblot goes
 * through this, so the same gesture looks the same everywhere.
 */
import { useRef } from 'react'
import { INKS, inkVar } from '../lib/palette'
import { useRovingFocus } from './hooks'
import Icon from './Icon'
import './InkPicker.css'

/**
 * @param {{ value: string, onChange: (id: string) => void, label: string,
 *   inks?: readonly string[], showLabels?: boolean }} props
 */
export default function InkPicker({ value, onChange, label, inks, showLabels = false }) {
  const ref = useRef(null)
  const onKeyDown = useRovingFocus(ref, '[role="radio"]', { orientation: 'horizontal', typeahead: false })
  const options = inks ? INKS.filter((ink) => inks.includes(ink.id)).sort((a, b) => inks.indexOf(a.id) - inks.indexOf(b.id)) : INKS
  const hasSelection = options.some((ink) => ink.id === value)
  return (
    <div ref={ref} role="radiogroup" aria-label={label} className={['ib-ink-picker', showLabels && 'has-labels'].filter(Boolean).join(' ')} onKeyDown={onKeyDown}>
      {options.map((ink, index) => {
        const selected = ink.id === value
        return (
          <button
            key={ink.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={ink.label}
            title={ink.label}
            tabIndex={selected || (!hasSelection && index === 0) ? 0 : -1}
            className="ib-ink-swatch"
            style={{ '--swatch': inkVar(ink.id) }}
            onClick={() => onChange?.(ink.id)}
          >
            <span className="ib-ink-dot">{selected ? <Icon name="check" size={12} active /> : null}</span>
            {showLabels ? <span className="ib-ink-label">{ink.label}</span> : null}
          </button>
        )
      })}
    </div>
  )
}
