/**
 * Floating.jsx — chrome that floats over the document without a panel around it.
 *
 *   FloatingToolbar       a strip of IconButtons (formatting bar, canvas/map tools)
 *   FloatingActionButton  one round primary action (new note, dictate)
 *
 * Both wear the floating-capsule surface (src/styles/base.css): paper with the float
 * shadow, and Liquid Glass on iOS/iPadOS only. FloatingCapsule is the same surface
 * without the toolbar's keyboard behaviour, for readouts (word count, zoom).
 */
import { forwardRef, useRef } from 'react'
import { useRovingFocus } from './hooks'
import Icon from './Icon'
import Tooltip from './Tooltip'
import './Floating.css'

export function FloatingToolbar({ label, className, children, orientation = 'horizontal' }) {
  const ref = useRef(null)
  const onKeyDown = useRovingFocus(ref, 'button:not([disabled])', { orientation, typeahead: false })
  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={label}
      aria-orientation={orientation}
      className={['floating-capsule', 'ib-floating-toolbar', `ib-floating-toolbar--${orientation}`, className].filter(Boolean).join(' ')}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  )
}

export function ToolbarSeparator() {
  return <span role="separator" className="ib-toolbar-separator" />
}

export const FloatingActionButton = forwardRef(function FloatingActionButton(
  { icon, label, shortcut, className, type = 'button', ...rest },
  ref,
) {
  return (
    <Tooltip content={label} shortcut={shortcut} placement="top">
      <button
        ref={ref}
        type={type}
        aria-label={label}
        className={['floating-capsule', 'ib-fab', className].filter(Boolean).join(' ')}
        {...rest}
      >
        <Icon name={icon} size={20} />
      </button>
    </Tooltip>
  )
})
