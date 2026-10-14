/**
 * The controls the Finishing tabs share (FinishingControls.swift).
 *
 * Every field commits when it is left — Return, focus leaving it, or the field going
 * away — not on each keystroke: a running head typed and then swiped away from must
 * not be lost, and the page should not re-lay the book per character.
 */
import { useEffect, useRef, useState } from 'react'
import { FormRow, SelectMenu, Stepper, Toggle } from '../../../ui'
import Icon from '../../../ui/Icon.jsx'
import { fromMm, roundTo, toMm, UNITS } from './units'

/** Text applied when committed, not per keystroke. */
export function CommitText({ value, onCommit, placeholder, label, multiline = false, rows = 3, className = '' }) {
  const [draft, setDraft] = useState(value ?? '')
  const focused = useRef(false)
  const latest = useRef({ draft, value, onCommit })
  useEffect(() => { latest.current = { draft, value, onCommit } })
  useEffect(() => { if (!focused.current) setDraft(value ?? '') }, [value])
  const commit = () => {
    const { draft: text, value: current, onCommit: apply } = latest.current
    if (text !== (current ?? '')) apply(text)
  }
  useEffect(() => () => commit(), [])

  const props = {
    className: `fin-input ${className}`.trim(),
    value: draft,
    placeholder,
    'aria-label': label,
    onFocus: () => { focused.current = true },
    onBlur: () => { focused.current = false; commit() },
    onChange: (event) => setDraft(event.target.value),
  }
  if (multiline) return <textarea rows={rows} {...props} />
  return <input {...props} onKeyDown={(event) => { if (event.key === 'Enter') { event.currentTarget.blur() } }} />
}

/** A number typed as text, applied on commit; not a number puts the last value back. */
export function CommitNumber({ value, onCommit, digits = 2, min, max, label, className = '' }) {
  const shown = (n) => (Number.isFinite(n) ? String(roundTo(n, digits)) : '')
  return (
    <CommitText
      className={`fin-number ${className}`.trim()}
      label={label}
      value={shown(value)}
      onCommit={(text) => {
        const parsed = Number(String(text).replace(',', '.'))
        if (!Number.isFinite(parsed)) return
        let next = parsed
        if (min != null) next = Math.max(min, next)
        if (max != null) next = Math.min(max, next)
        if (shown(next) !== shown(value)) onCommit(next)
      }}
    />
  )
}

/** A length: the number in the author's unit, and the unit. */
export function LengthInput({ mm, onCommit, unit, digits, label }) {
  return (
    <span className="fin-length">
      <CommitNumber value={fromMm(mm ?? 0, unit)} digits={digits ?? UNITS[unit].digits} min={0} label={label} onCommit={(value) => onCommit(Math.max(0, toMm(value, unit)))} />
      <span className="fin-unit">{unit}</span>
    </span>
  )
}

export function LengthRow({ label, mm, onCommit, unit, digits }) {
  return (
    <FormRow label={label}>
      <LengthInput mm={mm} onCommit={onCommit} unit={unit} digits={digits} label={label} />
    </FormRow>
  )
}

/** A whole number, typed or stepped. */
export function NumberRow({ label, value, onCommit, min = 0, max = 99999 }) {
  return (
    <FormRow label={label}>
      <Stepper label={label} value={value} min={min} max={max} step={1} onChange={(n) => onCommit(Math.round(n))} />
    </FormRow>
  )
}

export function Note({ children }) {
  return <p className="fin-note">{children}</p>
}

export function Caution({ children }) {
  return <p className="fin-caution"><Icon name="warning" /> {children}</p>
}

/** A menu in a row. `options`: [{ value, label }] or [{ label, options }]. */
export function PickerRow({ label, value, onChange, options, disabled }) {
  return (
    <FormRow label={label}>
      <SelectMenu label={label} value={value ?? ''} disabled={disabled} onChange={onChange} options={options} />
    </FormRow>
  )
}

export function ToggleRow({ label, checked, onChange, disabled, title }) {
  return (
    <div title={title}>
      <FormRow label={label}>
        <Toggle label={label} checked={Boolean(checked)} disabled={disabled} onChange={onChange} />
      </FormRow>
    </div>
  )
}
