/**
 * IconButton — an SF-style icon with a label that is always given: it is the tooltip
 * and the accessible name, and it is shown as text when the toolbar's display mode
 * asks for it ('iconAndLabel' under the icon, 'label' alone).
 */
import { forwardRef } from 'react'
import SFIcon from '../components/SFIcon.jsx'
import Button from './Button.jsx'

const IconButton = forwardRef(function IconButton(
  { symbol, label, display = 'icon', size = 'toolbar', iconSize = 16, filled = false, className = '', title, children, ...rest },
  ref,
) {
  return (
    <Button
      ref={ref}
      size={size}
      className={`ui-icon-button ${className}`.trim()}
      data-display={display}
      aria-label={label}
      title={title ?? label}
      {...rest}
    >
      {symbol ? <span className="ui-icon-button-icon"><SFIcon name={symbol} size={iconSize} filled={filled} /></span> : null}
      {children}
      {display !== 'icon' ? <span className="ui-icon-button-label">{label}</span> : null}
    </Button>
  )
})

export default IconButton
