/**
 * fields.jsx — the inspector's form controls.
 *
 * Text and number fields keep a local draft and commit on blur or Enter, so typing a
 * name is one undo step rather than one per keystroke, and a half-typed number
 * ("1.") never reaches the map.
 */
import { useEffect, useRef, useState } from 'react'
import { INKS, inkColor, isInkId, legacyInkFor, resolveInkHex } from '../../lib/palette'
import InkWheel from '../../ui/InkWheel.jsx'
import { MAP_DEFAULT_COLORS } from '../../lib/map/mapColors'

export function Field({ label, children, title }) {
  return (
    <label className="map-field" title={title}>
      <span>{label}</span>
      {children}
    </label>
  )
}

export function TextField({ label, value, onCommit, placeholder, autoFocusKey, multiline = false }) {
  const [draft, setDraft] = useState(value ?? '')
  const inputRef = useRef(null)
  useEffect(() => {
    setDraft(value ?? '')
  }, [value])
  useEffect(() => {
    if (autoFocusKey) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [autoFocusKey])
  const commit = () => {
    if ((draft ?? '') !== (value ?? '')) onCommit(draft)
  }
  const Tag = multiline ? 'textarea' : 'input'
  return (
    <Field label={label}>
      <Tag
        ref={inputRef}
        type={multiline ? undefined : 'text'}
        className="map-input"
        value={draft}
        placeholder={placeholder}
        rows={multiline ? 2 : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            commit()
            event.currentTarget.blur()
          }
          if (event.key === 'Escape') {
            setDraft(value ?? '')
            event.currentTarget.blur()
          }
        }}
      />
    </Field>
  )
}

export function NumberField({ label, value, onCommit, min, max, step = 'any', suffix, allowEmpty = false, title }) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => {
    setDraft(value ?? '')
  }, [value])
  const commit = () => {
    if (draft === '' || draft === null) {
      if (allowEmpty && value !== null) onCommit(null)
      else setDraft(value ?? '')
      return
    }
    let next = Number(draft)
    if (!Number.isFinite(next)) {
      setDraft(value ?? '')
      return
    }
    if (Number.isFinite(min)) next = Math.max(min, next)
    if (Number.isFinite(max)) next = Math.min(max, next)
    if (next !== value) onCommit(next)
    setDraft(next)
  }
  return (
    <Field label={label} title={title}>
      <span className="map-row" style={{ flexWrap: 'nowrap' }}>
        <input
          type="number"
          className="map-input"
          value={draft}
          min={min}
          max={max}
          step={step}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            }
          }}
        />
        {suffix ? <span className="map-note" style={{ margin: 0 }}>{suffix}</span> : null}
      </span>
    </Field>
  )
}

export function SelectField({ label, value, options, onChange, title }) {
  return (
    <Field label={label} title={title}>
      <select className="map-input" value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) =>
          option.group ? (
            <optgroup key={option.group} label={option.group}>
              {option.options.map((inner) => (
                <option key={inner.value} value={inner.value}>{inner.label}</option>
              ))}
            </optgroup>
          ) : (
            <option key={option.value} value={option.value}>{option.label}</option>
          )
        )}
      </select>
    </Field>
  )
}

export function CheckField({ label, checked, onChange }) {
  return (
    <label className="map-field">
      <span>{label}</span>
      <input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

/**
 * A colour from the ink palette, or the default back. A map stores literal colours (its
 * content is drawn by SVG, a 2D canvas and exported as GeoJSON), so where the default
 * is a hex the pick is stored as one; elsewhere (the timeline) as the ink's id.
 */
export function ColorField({ label, value, fallback = MAP_DEFAULT_COLORS.pin, onChange }) {
  const asHex = !isInkId(fallback)
  const ink = value ? inkFor(value) : null
  return (
    <Field label={label}>
      <InkWheel
        label={label}
        value={value ? ink ?? value : null}
        none={{ label: 'Default', color: inkColor(fallback) }}
        onChange={(id) => onChange(id === null ? null : asHex ? resolveInkHex(id) : id)}
      />
    </Field>
  )
}

/** The ink a stored colour is: an id, an old palette's hex, or an ink's hex as picked here. */
const inkFor = (value) => {
  if (isInkId(value)) return value
  const legacy = legacyInkFor(value)
  if (legacy) return legacy
  const hex = String(value).trim().toLowerCase()
  return INKS.find((ink) => resolveInkHex(ink.id, '').toLowerCase() === hex)?.id ?? null
}

export function Section({ title, children, actions }) {
  return (
    <section className="map-section">
      <div className="map-row" style={{ justifyContent: 'space-between' }}>
        <h3 className="map-section-title">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  )
}

export function Stat({ label, children }) {
  return (
    <div className="map-stat">
      <span>{label}</span>
      <span>{children}</span>
    </div>
  )
}
