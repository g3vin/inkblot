/**
 * The grouped-form controls an inspector section is built from: a labelled row, and
 * the Toggle, Stepper and SelectMenu that go in one.
 */
import { useEffect, useState } from 'react'
import './ui.css'

export function FormRow({ label, stacked = false, htmlFor, className = '', children }) {
  return (
    <div className={`ui-form-row ${className}`.trim()} data-stacked={stacked}>
      {label ? <label className="ui-form-row-label" htmlFor={htmlFor}>{label}</label> : null}
      <div className="ui-form-row-control">{children}</div>
    </div>
  )
}

export function Toggle({ checked, onChange, label, disabled = false, id }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={Boolean(checked)}
      aria-label={label}
      disabled={disabled}
      className="ui-toggle"
      onClick={() => onChange?.(!checked)}
    />
  )
}

const clamp = (value, min, max) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value))
const roundTo = (value, step) => {
  const decimals = String(step).split('.')[1]?.length ?? 0
  return Number(value.toFixed(decimals))
}

/** A number with − and + either side. Commits on Enter, blur, or a step. */
export function Stepper({ value, onChange, min, max, step = 1, unit, label, disabled = false, id }) {
  const [draft, setDraft] = useState(String(value ?? ''))
  useEffect(() => { setDraft(String(value ?? '')) }, [value])

  const commit = (next) => {
    const parsed = Number(next)
    if (!Number.isFinite(parsed)) { setDraft(String(value ?? '')); return }
    const settled = roundTo(clamp(parsed, min, max), step)
    setDraft(String(settled))
    if (settled !== value) onChange?.(settled)
  }

  const current = Number(value) || 0
  return (
    <span className="ui-stepper">
      <button type="button" aria-label={`Decrease ${label ?? ''}`.trim()} disabled={disabled || (min != null && current <= min)} onClick={() => commit(current - step)}>−</button>
      <input
        id={id}
        inputMode="decimal"
        aria-label={label}
        disabled={disabled}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit(draft)
          if (event.key === 'ArrowUp') { event.preventDefault(); commit(current + step) }
          if (event.key === 'ArrowDown') { event.preventDefault(); commit(current - step) }
        }}
      />
      {unit ? <span className="ui-stepper-unit">{unit}</span> : null}
      <button type="button" aria-label={`Increase ${label ?? ''}`.trim()} disabled={disabled || (max != null && current >= max)} onClick={() => commit(current + step)}>+</button>
    </span>
  )
}

/** A native <select> dressed as a capsule. Options: [{ value, label, disabled? }] or groups. */
export function SelectMenu({ value, onChange, options, label, disabled = false, id, className = '' }) {
  const renderOption = (option) => (
    <option key={String(option.value)} value={option.value} disabled={option.disabled}>{option.label}</option>
  )
  return (
    <select
      id={id}
      aria-label={label}
      className={`ui-select ${className}`.trim()}
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onChange?.(event.target.value)}
    >
      {options.map((option) => (option.options
        ? <optgroup key={option.label} label={option.label}>{option.options.map(renderOption)}</optgroup>
        : renderOption(option)))}
    </select>
  )
}
