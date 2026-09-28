/**
 * Segmented — one choice out of a few, on a 24pt capsule track. A segment shows an
 * icon, text or both; ←/→ move the choice, as a radio group does.
 *
 *   <Segmented value={mode} onChange={setMode} options={[
 *     { value: 'all', label: 'All' },
 *     { value: 'named', label: 'Named', symbol: 'tag' },
 *   ]} />
 */
import { useRef } from 'react'
import SFIcon from '../components/SFIcon.jsx'
import './ui.css'

export default function Segmented({
  value,
  onChange,
  options,
  label,
  iconOnly = false,
  stretch = false,
  className = '',
  onContextMenu,
}) {
  const ref = useRef(null)
  const enabled = options.filter((option) => !option.disabled)

  const onKeyDown = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const at = enabled.findIndex((option) => option.value === value)
    const step = event.key === 'ArrowRight' ? 1 : -1
    const next = enabled[(at + step + enabled.length) % enabled.length]
    if (!next) return
    onChange?.(next.value)
    const button = ref.current?.querySelector(`[data-value="${CSS.escape(String(next.value))}"]`)
    button?.focus()
  }

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      className={`ui-segmented ${className}`.trim()}
      data-stretch={stretch}
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            title={option.title ?? option.label}
            tabIndex={selected ? 0 : -1}
            disabled={option.disabled}
            data-value={option.value}
            className="ui-segment"
            onClick={() => onChange?.(option.value)}
          >
            {option.symbol ? <SFIcon name={option.symbol} size={14} /> : null}
            {iconOnly && option.symbol ? null : <span>{option.label}</span>}
          </button>
        )
      })}
    </div>
  )
}
