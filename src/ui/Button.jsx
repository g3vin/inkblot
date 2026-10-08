/**
 * Button — the one button. Variants: plain | tinted | filled | destructive.
 * Sizes: capsule (24pt), circle (28pt), toolbar (36pt).
 */
import { forwardRef } from 'react'
import './ui.css'

const Button = forwardRef(function Button(
  { variant = 'plain', size = 'capsule', className = '', type = 'button', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`ui-button ${className}`.trim()}
      data-variant={variant}
      data-size={size}
      {...rest}
    >
      {children}
    </button>
  )
})

export default Button
