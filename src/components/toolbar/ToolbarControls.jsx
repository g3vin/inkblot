/**
 * The pieces every toolbar item is built from, so an item looks the same in any
 * toolbar and in every display mode:
 *
 *   - ItemFrame: the item's control(s), with its label under them in Icon and Text.
 *   - ToolButton: one button, drawn as its icon, or its label in Text Only.
 *   - MenuButton: a button whose menu opens in the toolbar, as a row of its items.
 *   - ChoiceButton: a button whose own controls open in the toolbar (swatches).
 *
 * Buttons sit in a `.toolbar-group` (Toolbar.css), the segmented capsule the
 * formatting toolbar has always used.
 */
import { useRef, useState } from 'react'
import Icon from '../../ui/Icon.jsx'
import Popover from '../../ui/Popover.jsx'
import MenuRow from './MenuRow'

export function ItemFrame({ id, label, display, grouped = true, className = '', children }) {
  return (
    <div className={`tb-item ${className}`.trim()} data-item={id} data-display={display}>
      {grouped ? <div className="toolbar-group">{children}</div> : children}
      {display === 'iconAndLabel' ? <span className="tb-item-label">{label}</span> : null}
    </div>
  )
}

export function Glyph({ icon, label, display, filled = false, size = 16 }) {
  if (display === 'label') return <span className="tb-text">{label}</span>
  return <Icon name={icon} active={filled} size={size} />
}

export function ToolButton({ icon, label, title, display, active, disabled, onClick, filled, className = '' }) {
  return (
    <button
      type="button"
      className={`${active ? 'active' : ''} ${className}`.trim()}
      aria-label={label}
      aria-pressed={typeof active === 'boolean' ? active : undefined}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
    >
      <Glyph icon={icon} label={label} display={display} filled={filled ?? active} />
    </button>
  )
}

/**
 * A button that opens its controls in place beside it (DESIGN.md §6). `children` is a
 * function of `close`, called while it is open.
 */
export function ChoiceButton({ label, title, disabled, glyph, className = '', children }) {
  const ref = useRef(null)
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`tb-menu-button ${className}`.trim()}
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        title={title ?? label}
        disabled={disabled}
        onClick={() => setOpen((was) => !was)}
      >
        {glyph}
      </button>
      <Popover open={open} anchorRef={ref} onClose={close} eyebrow={label}>
        {open ? children(close) : null}
      </Popover>
    </>
  )
}

/**
 * `items` is a list for useNativeMenu, or a function returning one (built on click). It
 * opens as a MenuRow in a Popover, which the card's toolbar takes in (DESIGN.md §6).
 */
export function MenuButton({ icon, label, title, display, disabled, items, rowClassName, children }) {
  const ref = useRef(null)
  const [open, setOpen] = useState(null)
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="tb-menu-button"
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={Boolean(open)}
        title={title ?? label}
        disabled={disabled}
        onClick={() => setOpen((was) => (was ? null : typeof items === 'function' ? items() : items))}
      >
        {children ?? <Glyph icon={icon} label={label} display={display} />}
        <Icon name="chevron-down" className="tb-caret" />
      </button>
      {/* A label may carry the current value ("Alignment: Align left"); the row is named for the item. */}
      <Popover open={Boolean(open)} anchorRef={ref} onClose={() => setOpen(null)} eyebrow={label.split(':')[0]}>
        <MenuRow label={label.split(':')[0]} items={typeof items === 'function' ? open ?? [] : items} onDone={() => setOpen(null)} display={display} className={rowClassName} />
      </Popover>
    </>
  )
}
