/**
 * FloatingCapsule — the one translucent, blurred surface: a capsule floating over the
 * page (the tab bar, word count, zoom, the bubble editor's bars). Everything else in
 * the app is flat and opaque (tests/unit/css.mjs keeps it that way).
 */
import { forwardRef } from 'react'
import './ui.css'

const FloatingCapsule = forwardRef(function FloatingCapsule({ as = 'div', className = '', children, ...rest }, ref) {
  const Tag = as
  return (
    <Tag ref={ref} className={`floating-capsule ui-floating-capsule ${className}`.trim()} {...rest}>
      {children}
    </Tag>
  )
})

export default FloatingCapsule
