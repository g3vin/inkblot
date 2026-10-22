/**
 * The pieces every toolbar item is built from, so an item looks the same in any
 * toolbar and in every display mode:
 *
 *   - ItemFrame: the item's control(s), with its label under them in Icon and Text.
 *   - ToolButton: one button, drawn as its icon, or its label in Text Only.
 *   - MenuButton: a button that pops up a native menu.
 *
 * Buttons sit in a `.toolbar-group` (Toolbar.css), the segmented capsule the
 * formatting toolbar has always used.
 */
import Icon from '../../ui/Icon.jsx'
import { popUpMenu } from '../../ui/useNativeMenu'

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

/** `items` is a list for useNativeMenu, or a function returning one (built on click). */
export function MenuButton({ icon, label, title, display, disabled, items, children }) {
  return (
    <button
      type="button"
      className="tb-menu-button"
      aria-label={label}
      aria-haspopup="menu"
      title={title ?? label}
      disabled={disabled}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        const list = typeof items === 'function' ? items() : items
        void popUpMenu({ preventDefault() {}, stopPropagation() {}, clientX: rect.left, clientY: rect.bottom, target: event.currentTarget }, list)
      }}
    >
      {children ?? <Glyph icon={icon} label={label} display={display} />}
      <Icon name="chevron-down" className="tb-caret" />
    </button>
  )
}
