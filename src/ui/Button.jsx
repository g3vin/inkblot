/**
 * Button.jsx — the one text button.
 *
 * Variants, by weight of the action:
 *   primary    the one thing this surface is for (at most one per view)
 *   secondary  a normal action (default)
 *   ghost      a quiet action in dense chrome, list rows, toolbars
 *   danger     destroys something; always paired with a confirmation or an undo
 *
 * Sentence case labels, a verb first ("Add note", not "Note"). See docs/DESIGN.md.
 */
import { forwardRef } from 'react'
import Icon from './Icon'
import './Button.css'

const Button = forwardRef(function Button(
  { variant = 'secondary', size = 'md', icon, iconAfter, block = false, className, children, type = 'button', ...rest },
  ref,
) {
  const classes = ['ib-button', `ib-button--${variant}`, `ib-button--${size}`, block && 'ib-button--block', className]
    .filter(Boolean).join(' ')
  return (
    <button ref={ref} type={type} className={classes} {...rest}>
      {icon ? <Icon name={icon} size={16} /> : null}
      {children != null ? <span className="ib-button-label">{children}</span> : null}
      {iconAfter ? <Icon name={iconAfter} size={16} /> : null}
    </button>
  )
})

export default Button
