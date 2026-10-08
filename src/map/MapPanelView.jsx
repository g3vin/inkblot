/**
 * MapPanelView.jsx — the map inspector as the page draws it, down the right of a map.
 *
 * It draws the form `useMapPanel` builds, and nothing else: every field calls the
 * handler filed under its id.
 */
import Icon from '../ui/Icon.jsx'
import { PinGlyph } from './mapGlyphs'
import { CheckField, ColorField, Field, NumberField, Section, SelectField, Stat, TextField } from './inspector/fields'
import { inkColor } from '../lib/palette'

const buttonClass = (button) =>
  `map-button${button.role === 'primary' ? ' is-primary' : button.role === 'destructive' ? ' is-danger' : ''}`

function PanelButton({ button, run, style }) {
  return (
    <button
      type="button"
      className={buttonClass(button)}
      disabled={button.disabled}
      title={button.help}
      aria-label={button.help || button.label}
      style={style}
      onClick={() => run(button.id)}
    >
      {button.label}
    </button>
  )
}

/** Options with `group`s, as `SelectField` takes them. */
function selectOptions(options) {
  const out = []
  for (const option of options) {
    if (!option.group) {
      out.push({ value: option.value, label: option.label })
      continue
    }
    const last = out[out.length - 1]
    if (last?.group === option.group) last.options.push(option)
    else out.push({ group: option.group, options: [option] })
  }
  return out
}

const Swatch = ({ color, round = true }) => (
  <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: round ? 5 : 2, background: inkColor(color), marginRight: 6 }} />
)

function DateField({ field, commit }) {
  const { label, value, mode, months, allowEmpty, placeholder } = field
  if (!value) {
    return (
      <div className="map-field">
        <span>{label}</span>
        <button type="button" className="map-button" onClick={() => commit({ year: 0, month: 1, day: 1, hour: 0, minute: 0 })}>{placeholder || 'Set a date'}</button>
      </div>
    )
  }
  const set = (patch) => commit({ ...value, ...patch })
  return (
    <div className="map-field">
      <span>{label}</span>
      <span className="map-row" style={{ flexWrap: 'nowrap', gap: 4 }}>
        {mode === 'day' ? (
          <input className="map-input" type="number" value={value.day} step={1} onChange={(event) => set({ day: Number(event.target.value) || 1 })} aria-label="Day" />
        ) : (
          <>
            <input className="map-input" type="number" style={{ width: 52 }} value={value.day} min={1} onChange={(event) => set({ day: Number(event.target.value) || 1 })} aria-label="Day" />
            <select className="map-input" value={value.month} onChange={(event) => set({ month: Number(event.target.value) })} aria-label="Month">
              {months.map((name, index) => (
                <option key={`${name}-${index}`} value={index + 1}>{name.slice(0, 3)}</option>
              ))}
            </select>
            <input className="map-input" type="number" style={{ width: 64 }} value={value.year} onChange={(event) => set({ year: Number(event.target.value) || 0 })} aria-label="Year" />
          </>
        )}
        <input
          className="map-input"
          type="time"
          style={{ width: 84 }}
          value={`${String(value.hour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}`}
          onChange={(event) => {
            const [hour, minute] = event.target.value.split(':').map(Number)
            set({ hour: hour || 0, minute: minute || 0 })
          }}
          aria-label="Time"
        />
        {allowEmpty ? <button type="button" className="map-button" title="Leave when the previous leg arrives" onClick={() => commit(null)}>×</button> : null}
      </span>
    </div>
  )
}

function PanelField({ field: { type, payload: field }, commit, run }) {
  const set = (value) => commit(field.id, value)
  switch (type) {
    case 'text':
      return <TextField label={field.label} value={field.value} placeholder={field.placeholder} multiline={field.multiline} autoFocusKey={field.focusKey || undefined} onCommit={set} />
    case 'number':
      return (
        <NumberField
          label={field.label}
          value={field.value ?? null}
          min={field.min}
          max={field.max}
          step={field.step ?? 'any'}
          suffix={field.suffix}
          allowEmpty={field.allowEmpty}
          title={field.help}
          onCommit={set}
        />
      )
    case 'choice':
      return <SelectField label={field.label} value={field.value} title={field.help} options={selectOptions(field.options)} onChange={set} />
    case 'toggle':
      return <CheckField label={field.label} checked={field.value} onChange={set} />
    case 'color':
      return <ColorField label={field.label} value={field.value} fallback={field.fallback} onChange={set} />
    case 'stat':
      return <Stat label={field.label}>{field.action ? <PanelButton button={field.action} run={run} /> : field.value}</Stat>
    case 'note':
      return (
        <p className={field.tone === 'warning' ? 'map-warning' : 'map-note'}>
          {field.swatch ? <Swatch color={field.swatch} /> : null}
          {field.text}
          {field.action ? <> <PanelButton button={field.action} run={run} /></> : null}
        </p>
      )
    case 'button':
      return <PanelButton button={field} run={run} />
    case 'buttons':
      return (
        <div className="map-row">
          {field.buttons.map((button) => <PanelButton key={button.id} button={button} run={run} />)}
        </div>
      )
    case 'listRow':
      return (
        <button
          type="button"
          className="map-button map-list-item"
          style={{ width: '100%', textAlign: 'left', margin: '2px 0', paddingLeft: 10 + field.indent * 12 }}
          onClick={() => run(field.id)}
        >
          {field.swatch ? <Swatch color={field.swatch} /> : null}
          {field.subtitle ? <strong>{field.title}</strong> : field.title}
          {field.subtitle ? <span className="map-note" style={{ display: 'block', margin: '2px 0 0' }}>{field.subtitle}</span> : null}
        </button>
      )
    case 'markers':
      return (
        <div className="map-row" role="radiogroup" aria-label="Marker">
          {field.options.map((icon) => (
            <button
              key={icon.value}
              type="button"
              title={icon.label}
              aria-label={icon.label}
              aria-checked={field.value === icon.value}
              role="radio"
              className={`map-tool${field.value === icon.value ? ' is-active' : ''}`}
              style={{ width: 34, height: 40 }}
              onClick={() => set(icon.value)}
            >
              <svg width="30" height="36" viewBox="-15 -31 30 36" style={{ overflow: 'visible' }}>
                <PinGlyph icon={icon.value} color={field.color} />
              </svg>
            </button>
          ))}
        </div>
      )
    case 'date':
      return <DateField field={field} commit={set} />
    case 'table':
      return (
        <div style={{ overflowX: 'auto' }} data-map-scrolls>
          <table className="map-table">
            <thead>
              <tr>
                <th />
                {field.columns.map((column, index) => <th key={index}>{column}</th>)}
              </tr>
            </thead>
            <tbody>
              {field.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <td>{row.label}</td>
                  {row.cells.map((cell, index) => (
                    <td key={index} style={cell.strong ? { fontWeight: 600 } : undefined}>
                      {cell.text}
                      {cell.detail ? <><br /><span className="map-note">{cell.detail}</span></> : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'preview':
      return (
        <svg viewBox={`0 0 ${field.width} ${field.height}`} style={{ width: '100%', height: 150, background: 'var(--map-sheet)', borderRadius: 8, marginTop: 6 }} aria-label="Trace preview">
          <path
            d={field.path}
            fill={field.filled ? 'currentColor' : 'none'}
            fillOpacity={0.2}
            fillRule="evenodd"
            stroke="currentColor"
            strokeWidth={Math.max(1, field.width / 300)}
          />
        </svg>
      )
    case 'group': {
      const fields = field.fields.map((inner, index) => <PanelField key={inner.payload?.id || index} field={inner} commit={commit} run={run} />)
      if (field.collapsible) {
        return (
          <details className="map-list-item">
            <summary>
              {field.swatch ? <Swatch color={field.swatch} round={false} /> : null}
              {field.title}
            </summary>
            {fields}
          </details>
        )
      }
      return (
        <div className="map-list-item">
          <div className="map-row" style={{ justifyContent: 'space-between' }}>
            <strong>{field.title}</strong>
            <span className="map-row">
              {field.actions.map((button) => <PanelButton key={button.id} button={button} run={run} />)}
            </span>
          </div>
          {fields}
        </div>
      )
    }
    default:
      return <Field label="">{null}</Field>
  }
}

export default function MapPanelView({ panel, handlers, onClose }) {
  const commit = (id, value) => handlers.get(id)?.(value)
  const run = (id) => handlers.get(id)?.()
  return (
    <aside className="map-floating map-inspector" data-map-scrolls aria-label="Map inspector">
      <div className="map-inspector-header">
        {panel.canGoBack ? (
          <button type="button" className="map-tool" style={{ marginLeft: 0 }} title="Back to the map" aria-label="Back to the map" onClick={() => handlers.get('@back')?.()}>
            <Icon name="chevron-left" />
          </button>
        ) : null}
        <span>{panel.title}</span>
        {panel.problems ? (
          <span title={`${panel.problems} problem${panel.problems === 1 ? '' : 's'} in the journeys`} style={{ color: 'var(--status-warning)' }}>
            <Icon name="warning" />
          </span>
        ) : null}
        {onClose ? (
          <button type="button" className="map-tool" title="Hide the inspector" aria-label="Hide the inspector" onClick={onClose}>
            <Icon name="close" />
          </button>
        ) : null}
      </div>
      {panel.tabs.length ? (
        <div className="map-row" role="tablist" style={{ padding: '8px 12px 0', gap: 4 }}>
          {panel.tabs.map((option) => (
            <button key={option.id} type="button" role="tab" aria-selected={panel.tab === option.id} className={`map-button${panel.tab === option.id ? ' is-primary' : ''}`} onClick={() => handlers.get('@tab')?.(option.id)}>
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="map-inspector-body">
        {panel.sections.map((section) => (
          <Section
            key={section.id}
            title={section.title}
            actions={section.actions.length ? <span className="map-row">{section.actions.map((button) => <PanelButton key={button.id} button={button} run={run} />)}</span> : null}
          >
            {section.fields.map((field, index) => <PanelField key={field.payload?.id || `${field.type}-${index}`} field={field} commit={commit} run={run} />)}
          </Section>
        ))}
      </div>
    </aside>
  )
}
