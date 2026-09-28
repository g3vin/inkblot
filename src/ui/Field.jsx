/**
 * Field.jsx — form controls: Field (label + hint wrapper), Input, TextArea, Select,
 * Checkbox, Switch and SegmentedControl.
 *
 * Labels sit above controls, in sentence case. A hint says what a setting DOES in
 * plain words; publishing terms belong in hints only inside advanced tools.
 */
import { forwardRef, useId, useRef } from 'react'
import Icon from './Icon'
import { useRovingFocus } from './hooks'
import './Field.css'

export function Field({ label, hint, error, htmlFor, children, className }) {
  return (
    <div className={['ib-field', className].filter(Boolean).join(' ')}>
      {label ? <label className="ib-field-label" htmlFor={htmlFor}>{label}</label> : null}
      {children}
      {error ? <p className="ib-field-error" role="alert">{error}</p> : hint ? <p className="ib-hint">{hint}</p> : null}
    </div>
  )
}

export const Input = forwardRef(function Input({ icon, className, size = 'md', ...rest }, ref) {
  return (
    <span className={['ib-input-wrap', `ib-input-wrap--${size}`, className].filter(Boolean).join(' ')}>
      {icon ? <Icon name={icon} className="ib-input-icon" /> : null}
      <input ref={ref} className="ib-input" {...rest} />
    </span>
  )
})

export const TextArea = forwardRef(function TextArea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={['ib-textarea', className].filter(Boolean).join(' ')} {...rest} />
})

/** A native <select>, styled: the OS picker is the most familiar one there is. */
export const Select = forwardRef(function Select({ options = [], className, children, ...rest }, ref) {
  return (
    <span className={['ib-select-wrap', className].filter(Boolean).join(' ')}>
      <select ref={ref} className="ib-select" {...rest}>
        {children || options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
        ))}
      </select>
      <Icon name="chevron-down" className="ib-select-caret" />
    </span>
  )
})

export function Checkbox({ checked, onChange, label, disabled, id: idProp }) {
  const autoId = useId()
  const id = idProp || autoId
  return (
    <label className="ib-check" htmlFor={id}>
      <input id={id} type="checkbox" className="ib-check-input" checked={checked} disabled={disabled}
        onChange={(event) => onChange?.(event.target.checked)} />
      <span className="ib-check-box" aria-hidden="true"><Icon name="check" size={12} /></span>
      {label ? <span className="ib-check-label">{label}</span> : null}
    </label>
  )
}

export function Switch({ checked, onChange, label, disabled, id: idProp }) {
  const autoId = useId()
  const id = idProp || autoId
  return (
    <label className="ib-switch" htmlFor={id}>
      {label ? <span className="ib-switch-label">{label}</span> : null}
      <input id={id} type="checkbox" role="switch" className="ib-switch-input" checked={checked} disabled={disabled}
        onChange={(event) => onChange?.(event.target.checked)} />
      <span className="ib-switch-track" aria-hidden="true"><span className="ib-switch-thumb" /></span>
    </label>
  )
}

/**
 * A small set of mutually exclusive options shown side by side (2–4 short labels).
 * @param {{ value: string, onChange: (v: string) => void, label: string,
 *   options: { value: string, label: string, icon?: string }[] }} props
 */
export function SegmentedControl({ value, onChange, options, label, size = 'md' }) {
  const ref = useRef(null)
  const onKeyDown = useRovingFocus(ref, '[role="radio"]', { orientation: 'horizontal', typeahead: false })
  return (
    <div ref={ref} role="radiogroup" aria-label={label} className={`ib-segmented ib-segmented--${size}`} onKeyDown={onKeyDown}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className="ib-segment"
            onClick={() => onChange?.(option.value)}
            onFocus={() => { if (!selected) onChange?.(option.value) }}
          >
            {option.icon ? <Icon name={option.icon} active={selected} /> : null}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
