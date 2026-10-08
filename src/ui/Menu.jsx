/**
 * Menu.jsx — a list of actions in the one pop-up surface.
 *
 *   <Menu open anchorRef={buttonRef} onClose={close} label="Note actions">
 *     <MenuLabel>Arrange</MenuLabel>
 *     <MenuItem icon="pin" shortcut="⌘P" onSelect={pin}>Pin note</MenuItem>
 *     <MenuSeparator />
 *     <MenuItem icon="delete" danger onSelect={remove}>Delete note</MenuItem>
 *   </Menu>
 *
 * Arrow keys, Home/End and typeahead move between items; Enter/Space select; Escape
 * or an outside click closes and focus returns to the anchor. The "More" overflow
 * menu on every toolbar is this component — it is how advanced tools stay one step
 * away without crowding the surface (docs/DESIGN.md → Progressive disclosure).
 */
import { createContext, useContext, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismiss, useRovingFocus } from './hooks'
import Icon from './Icon'
import Kbd from './Kbd'
import './Popover.css'
import './Menu.css'

const MenuContext = createContext({ close: () => {} })

const ITEM_SELECTOR = '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]'

export default function Menu({ open, onClose, anchorRef, point, placement = 'bottom-start', label, className, children }) {
  const ref = useRef(null)
  const style = useAnchoredPosition(open, ref, { anchorRef, point, placement })
  useDismiss(open, onClose, anchorRef ? [ref, anchorRef] : [ref])
  const onKeyDown = useRovingFocus(ref, ITEM_SELECTOR)

  useEffect(() => {
    if (!open) return undefined
    const anchor = anchorRef?.current
    const frame = window.requestAnimationFrame(() => ref.current?.querySelector(ITEM_SELECTOR)?.focus())
    return () => {
      window.cancelAnimationFrame(frame)
      anchor?.focus?.({ preventScroll: true })
    }
  }, [open, anchorRef])

  if (!open) return null
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className={['ib-menu', className].filter(Boolean).join(' ')}
      style={style}
      onKeyDown={(event) => {
        if (event.key === 'Tab') { event.preventDefault(); onClose?.() }
        onKeyDown(event)
      }}
    >
      <MenuContext.Provider value={{ close: () => onClose?.() }}>
        {typeof children === 'function' ? children({ close: onClose }) : children}
      </MenuContext.Provider>
    </div>,
    document.body,
  )
}

/**
 * @param {{ onSelect?: () => void, icon?: string, shortcut?: string, danger?: boolean,
 *   checked?: boolean, disabled?: boolean, closeOnSelect?: boolean }} props
 */
export function MenuItem({ onSelect, icon, shortcut, danger, checked, disabled, closeOnSelect = true, children, hint }) {
  const { close } = useContext(MenuContext)
  const role = checked === undefined ? 'menuitem' : 'menuitemcheckbox'
  const select = (event) => {
    if (disabled) return
    onSelect?.(event)
    if (closeOnSelect) close()
  }
  return (
    <button
      type="button"
      role={role}
      aria-checked={checked === undefined ? undefined : Boolean(checked)}
      aria-disabled={disabled || undefined}
      tabIndex={-1}
      className={['ib-menu-item', danger && 'is-danger'].filter(Boolean).join(' ')}
      onClick={select}
    >
      <span className="ib-menu-item-icon">
        {checked ? <Icon name="check" /> : icon ? <Icon name={icon} /> : null}
      </span>
      <span className="ib-menu-item-label">
        {children}
        {hint ? <span className="ib-menu-item-hint">{hint}</span> : null}
      </span>
      {shortcut ? <Kbd>{shortcut}</Kbd> : null}
    </button>
  )
}

export function MenuSeparator() {
  return <div role="separator" className="ib-menu-separator" />
}

/** A typewriter eyebrow over a group of items. */
export function MenuLabel({ children }) {
  return <div role="presentation" className="ib-menu-label ib-eyebrow">{children}</div>
}
