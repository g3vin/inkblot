/**
 * panelBuilder.js — the map inspector described as a form rather than drawn.
 *
 * The inspector is built once, as data (`MapPanel` in `bridge/map.rs`): sections of
 * typed fields, each named by an id. Two things draw it — `MapPanelView.jsx` here,
 * and the Swift app's inspector, natively — and both send an edit back the same way,
 * by id. The closures that do the edits never leave the page: the builder files each
 * one under its field's id in `handlers`, and `runPanelCommand` finds it there.
 *
 * Every field comes out as `{ type, payload }`, the protocol's own shape, so a built
 * panel crosses the bridge as it is.
 */

const field = (type, payload) => ({ type, payload })

const clamp = (value, min, max) => {
  let next = value
  if (Number.isFinite(min)) next = Math.max(min, next)
  if (Number.isFinite(max)) next = Math.min(max, next)
  return next
}

/** A button as the protocol has it (`MapPanelButton`). */
const buttonOf = (id, label, { role = 'normal', disabled = false, symbol, help } = {}) => ({
  id, label, role, disabled: Boolean(disabled), symbol, help,
})

export function createPanelBuilder() {
  const handlers = new Map()
  const on = (id, handler) => {
    if (handler) handlers.set(id, handler)
    return id
  }
  const button = (id, label, onClick, options) => {
    on(id, onClick)
    return buttonOf(id, label, options)
  }

  return {
    handlers,
    button,

    section: (id, title, fields, actions = []) => ({
      id,
      title,
      actions: actions.filter(Boolean),
      fields: fields.flat().filter(Boolean),
    }),

    /** Committed whole — on Return or blur, never per keystroke. */
    text: (id, label, value, onCommit, { placeholder, multiline = false, focusKey = 0 } = {}) =>
      field('text', {
        id: on(id, (next) => {
          const text = String(next ?? '')
          if (text !== (value ?? '')) onCommit(text)
        }),
        label,
        value: value ?? '',
        placeholder,
        multiline,
        focusKey: focusKey || 0,
      }),

    /** Clamped, and only committed when it changed; `null` clears an `allowEmpty` one. */
    number: (id, label, value, onCommit, { min, max, step, suffix, allowEmpty = false, help } = {}) =>
      field('number', {
        id: on(id, (next) => {
          if (next === null || next === undefined || next === '') {
            if (allowEmpty && value !== null && value !== undefined) onCommit(null)
            return
          }
          const number = Number(next)
          if (!Number.isFinite(number)) return
          const clamped = clamp(number, min, max)
          if (clamped !== value) onCommit(clamped)
        }),
        label,
        value: Number.isFinite(value) ? value : undefined,
        min,
        max,
        step: Number.isFinite(step) ? step : undefined,
        suffix,
        allowEmpty,
        help,
      }),

    /** `options` are `{ value, label, group? }`; `''` is the usual "none". */
    choice: (id, label, value, options, onChange, { help } = {}) =>
      field('choice', {
        id: on(id, (next) => onChange(String(next ?? ''))),
        label,
        value: value ?? '',
        options: options.map((option) => ({ value: String(option.value), label: option.label, group: option.group })),
        help,
      }),

    toggle: (id, label, value, onChange) =>
      field('toggle', { id: on(id, (next) => onChange(Boolean(next))), label, value: Boolean(value) }),

    /** `null` is Reset, back to `fallback`. */
    color: (id, label, value, fallback, onChange) =>
      field('color', { id: on(id, (next) => onChange(next || null)), label, value: value || undefined, fallback }),

    stat: (label, value, action) => field('stat', { label, value: String(value), action }),

    note: (text, { swatch, action } = {}) => field('note', { text, tone: 'note', swatch, action }),

    warning: (text, { action } = {}) => field('note', { text, tone: 'warning', action }),

    buttonField: (id, label, onClick, options) => field('button', button(id, label, onClick, options)),

    buttons: (buttons) => field('buttons', { buttons: buttons.filter(Boolean) }),

    listRow: (id, title, onClick, { subtitle, swatch, indent = 0 } = {}) =>
      field('listRow', { id: on(id, onClick), title, subtitle, swatch, indent }),

    markers: (id, value, color, options, onChange) =>
      field('markers', { id: on(id, onChange), value, color: color || undefined, options }),

    /** `value` is `MapDateParts` or null; the handler gets parts back, or null. */
    date: (id, label, value, calendar, onCommit, { allowEmpty = false, placeholder } = {}) =>
      field('date', {
        id: on(id, onCommit),
        label,
        value: value || undefined,
        mode: calendar.mode,
        months: calendar.months,
        allowEmpty,
        placeholder,
      }),

    table: (columns, rows) => field('table', { columns, rows }),

    preview: (width, height, path, filled) => field('preview', { width, height, path, filled }),

    group: (id, title, fields, { actions = [], swatch, collapsible = false } = {}) =>
      field('group', { id, title, swatch, actions: actions.filter(Boolean), fields: fields.flat().filter(Boolean), collapsible }),
  }
}

/**
 * Run a panel command against the handlers the panel was last built with. `false`
 * when the id names nothing — a panel rebuilt between the click and its arrival.
 */
export function runPanelCommand(handlers, command, detail = {}) {
  const handler = handlers.get(detail.id)
  if (!handler) return false
  if (command === 'panel-field') handler(detail.value)
  else if (command === 'panel-action') handler()
  else return false
  return true
}
