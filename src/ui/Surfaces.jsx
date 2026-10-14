/**
 * Surfaces.jsx — the building blocks of the "document is the room" layout
 * (docs/DESIGN.md → Layout):
 *
 *   Panel / PanelHeader   a floating, hideable side panel over the document
 *   FadeScrim             the gradient that lets text dissolve under chrome
 *   Card                  a bordered block inside a panel; takes an ink
 *   Tag                   a small pill label; takes an ink
 *   EmptyState            what a panel says when it has nothing to show
 *   Tabs                  switch between views inside a panel
 */
import { useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { inkColor } from '../lib/palette'
import { useRovingFocus } from './hooks'
import Icon from './Icon'
import './Surfaces.css'

/**
 * A floating side panel. It sits over the document with a soft shadow and hides
 * completely when `open` is false — tools are summoned, never permanent.
 */
export function Panel({ open = true, side = 'right', width = 300, label, className, children, style }) {
  const reduce = useReducedMotion()
  const offset = side === 'right' ? 12 : -12
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.aside
          key="panel"
          aria-label={label}
          className={['ib-panel', 'ib-sheet', `ib-panel--${side}`, className].filter(Boolean).join(' ')}
          style={{ width, ...style }}
          initial={reduce ? false : { opacity: 0, x: offset }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, x: offset }}
          transition={{ duration: 0.18, ease: [0.2, 0.7, 0.2, 1] }}
        >
          {children}
        </motion.aside>
      ) : null}
    </AnimatePresence>
  )
}

/** Eyebrow title on the left, actions (IconButtons) on the right. */
export function PanelHeader({ title, actions, children }) {
  return (
    <header className="ib-panel-header">
      <h2 className="ib-eyebrow ib-panel-title">{title}</h2>
      {children}
      {actions ? <div className="ib-panel-actions">{actions}</div> : null}
    </header>
  )
}

export function PanelBody({ children, className }) {
  return <div className={['ib-panel-body', className].filter(Boolean).join(' ')}>{children}</div>
}

/**
 * The fade under chrome that overlays the document. Solid --app-bg at the edge,
 * clear by the far side, so text scrolling under the toolbar dissolves instead of
 * hitting a hard line. Place it as the first child of the chrome it sits behind.
 */
export function FadeScrim({ edge = 'top', height = 56, className }) {
  return (
    <div
      aria-hidden="true"
      className={['ib-fade-scrim', `ib-fade-scrim--${edge}`, className].filter(Boolean).join(' ')}
      style={{ '--scrim-height': typeof height === 'number' ? `${height}px` : height }}
    />
  )
}

/** A card. `ink` washes it with an ink hue via the shared card recipe. */
export function Card({ ink, interactive = false, selected = false, className, style, children, ...rest }) {
  return (
    <div
      className={['ib-card', ink && 'ib-card--inked', interactive && 'ib-card--interactive', selected && 'is-selected', className]
        .filter(Boolean).join(' ')}
      style={ink ? { '--card-color': inkColor(ink), ...style } : style}
      {...rest}
    >
      {children}
    </div>
  )
}

export function Tag({ ink = 'slate', children, className }) {
  return (
    <span className={['ib-tag', className].filter(Boolean).join(' ')} style={{ '--tag-color': inkColor(ink) }}>
      {children}
    </span>
  )
}

/**
 * Empty states are a small brand moment: a typewritten line, then a plain hint and at
 * most one action. "Nothing here yet" — never an error tone. `compact` for a short
 * spot (a section with nothing in it); `dropActive` washes it in the accent while
 * something is dragged over it, for a panel that takes drops (the clipboard).
 */
export function EmptyState({ icon, title, hint, action, compact = false, dropActive = false, className, ...rest }) {
  return (
    <div
      className={['ib-empty', compact && 'ib-empty--compact', dropActive && 'is-drop-active', className].filter(Boolean).join(' ')}
      {...rest}
    >
      {icon ? <Icon name={icon} size={20} className="ib-empty-icon" /> : null}
      <p className="ib-empty-title">{title}</p>
      {hint ? <p className="ib-hint ib-empty-hint">{hint}</p> : null}
      {action ? <div className="ib-empty-action">{action}</div> : null}
    </div>
  )
}

/**
 * @param {{ value: string, onChange: (v: string) => void, label: string,
 *   tabs: { value: string, label: string, icon?: string }[] }} props
 */
export function Tabs({ value, onChange, tabs, label }) {
  const ref = useRef(null)
  const onKeyDown = useRovingFocus(ref, '[role="tab"]', { orientation: 'horizontal', typeahead: false })
  return (
    <div ref={ref} role="tablist" aria-label={label} className="ib-tabs" onKeyDown={onKeyDown}>
      {tabs.map((tab) => {
        const selected = tab.value === value
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className="ib-tab"
            onClick={() => onChange?.(tab.value)}
          >
            {tab.icon ? <Icon name={tab.icon} active={selected} /> : null}
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
