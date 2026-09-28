/**
 * IconButton.jsx — a button that is only an icon.
 *
 * `label` is required: it is the accessible name AND the tooltip, so a beginner can
 * always find out what an icon does by pointing at it. `shortcut` adds the key hint
 * to the tooltip. `active` shows a toggled-on state (Fill icon + accent wash).
 */
import { forwardRef } from 'react'
import Icon from './Icon'
import Tooltip from './Tooltip'
import './Button.css'

const IconButton = forwardRef(function IconButton(
  { icon, label, shortcut, active, size = 'md', tooltip = true, className, type = 'button', ...rest },
  ref,
) {
  const classes = ['ib-icon-button', size === 'sm' && 'ib-icon-button--sm', className].filter(Boolean).join(' ')
  const button = (
    <button
      ref={ref}
      type={type}
      className={classes}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : Boolean(active)}
      {...rest}
    >
      <Icon name={icon} size={size === 'sm' ? 16 : 20} active={Boolean(active)} />
    </button>
  )
  return tooltip ? <Tooltip content={label} shortcut={shortcut}>{button}</Tooltip> : button
})

export default IconButton
