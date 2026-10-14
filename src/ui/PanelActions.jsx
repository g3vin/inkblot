/**
 * PanelActions — a panel's own controls in its header row, beside the eyebrow title.
 *
 * Every inspector panel has the same top (DESIGN.md §6, panel anatomy): the eyebrow,
 * then on its right at most one ScopeMenu (what the panel shows: "This document ▾")
 * and one MoreMenu (⋯, the rarer options). They never stack into rows or bands of
 * their own inside the panel.
 *
 * The header row belongs to the shell (the inspector draws one title row for all its
 * panels), so a panel hands its controls up: the shell wraps each panel in a
 * PanelActionsProvider pointing at its header slot, and the panel renders
 * <PanelActions>…</PanelActions> wherever is convenient. Only the panel that is
 * showing puts anything there.
 */
import { createContext, useContext, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import IconButton from './IconButton.jsx'
import Menu, { MenuItem } from './Menu.jsx'
import './Surfaces.css'

const PanelActionsContext = createContext({ inline: true, slot: null, active: true })

export function PanelActionsProvider({ slot, active, children }) {
  return <PanelActionsContext.Provider value={{ inline: false, slot, active }}>{children}</PanelActionsContext.Provider>
}

/** Put the children in the panel's header row. Outside a provider they render in place. */
export function PanelActions({ children }) {
  const { inline, slot, active } = useContext(PanelActionsContext)
  if (inline) return <div className="ib-panel-actions">{children}</div>
  if (!active || !slot) return null
  return createPortal(<div className="ib-panel-actions">{children}</div>, slot)
}

/**
 * What a panel is showing, as quiet text with a chevron: "This document ▾". A menu of
 * the choices opens under it. Use it for a panel's scope, in place of a second
 * Segmented row.
 */
export function ScopeMenu({ value, onChange, options, label }) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef(null)
  const current = options.find((option) => option.value === value) ?? options[0]
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="ib-scope-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label ?? ''}`}
        title={label}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="ib-scope-menu-value">{current?.label}</span>
        <Icon name="chevron-down" size={16} />
      </button>
      <Menu open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} placement="bottom-end" label={label}>
        {options.map((option) => (
          <MenuItem
            key={String(option.value)}
            checked={option.value === value}
            disabled={option.disabled}
            hint={option.hint}
            onSelect={() => onChange?.(option.value)}
          >
            {option.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

/** ⋯: a panel's rarer options. Children are MenuItems (or a function of { close }). */
export function MoreMenu({ label = 'More', children }) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef(null)
  return (
    <>
      <IconButton
        ref={anchorRef}
        icon="more"
        label={label}
        size="capsule"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      />
      <Menu open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} placement="bottom-end" label={label}>
        {children}
      </Menu>
    </>
  )
}
