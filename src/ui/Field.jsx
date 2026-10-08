/**
 * Field.jsx — form fields for dialogs and sheets: Field (label + hint wrapper), Input,
 * TextArea and Checkbox. For on/off use Toggle, for a choice of a few use Segmented, and
 * for a list use SelectMenu (FormRow.jsx, Segmented.jsx); inspector rows use FormRow.
 *
 * Labels sit above controls, in sentence case. A hint says what a setting DOES in
 * plain words; publishing terms belong in hints only inside advanced tools.
 */
import { forwardRef, useId } from 'react'
import Icon from './Icon'
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
