/** A symbol from staticIconShapes.jsx, drawn at `size`. */
import { STATIC_ICONS } from './staticIconShapes.jsx'

export function StaticIcon({ name, size = 16, strokeWidth = 1.6, className = '', ...rest }) {
  const body = STATIC_ICONS[name]
  if (!body) return null
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {body}
    </svg>
  )
}
