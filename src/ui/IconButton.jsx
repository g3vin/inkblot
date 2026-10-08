/**
 * IconButton — an icon with a label that is always given: it is the tooltip and the
 * accessible name, and it is shown as text when the toolbar's display mode asks for it
 * ('iconAndLabel' under the icon, 'label' alone).
 *
 * `icon` is a semantic name from src/ui/icons.js.
 */
import { forwardRef } from 'react'
import Icon from './Icon.jsx'
import Button from './Button.jsx'

const IconButton = forwardRef(function IconButton(
  { icon, label, display = 'icon', size = 'toolbar', iconSize = 16, filled = false, className = '', title, children, ...rest },
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
      {icon ? <span className="ui-icon-button-icon"><Icon name={icon} size={iconSize} active={filled} /></span> : null}
      {children}
      {display !== 'icon' ? <span className="ui-icon-button-label">{label}</span> : null}
    </Button>
  )
})

export default IconButton
