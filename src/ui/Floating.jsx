/**
 * Floating.jsx — chrome that floats over the document without a panel around it.
 *
 *   FloatingToolbar       a pill of IconButtons (formatting bar, canvas/map tools)
 *   FloatingActionButton  one round primary action (new note, dictate)
 *
 * On iOS/iPadOS these two — and only these two — wear Liquid Glass (translucent,
 * blurred, with a specular rim), so they sit comfortably beside the system's own glass.
 * Everywhere else they are paper with the float shadow. See src/ui/platform.js.
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
      className={['ib-floating', 'ib-floating-toolbar', `ib-floating-toolbar--${orientation}`, className].filter(Boolean).join(' ')}
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
        className={['ib-floating', 'ib-fab', className].filter(Boolean).join(' ')}
        {...rest}
      >
        <Icon name={icon} size={20} />
      </button>
    </Tooltip>
  )
})
