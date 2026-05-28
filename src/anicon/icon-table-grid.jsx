import { motion, useReducedMotion } from 'framer-motion'

const MotionSvg = motion.svg
const MotionPath = motion.path

const cellVariants = (delay) => ({
  rest: { scale: 1 },
  hover: {
    scale: [1, 1.06, 1],
    transition: { duration: 0.35, delay, ease: 'easeInOut' },
  },
})

export function IconTableGrid({
  size = 24,
  strokeWidth = 2,
  className,
  ...props
}) {
  const prefersReducedMotion = useReducedMotion()

  return (
    <MotionSvg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      initial={prefersReducedMotion ? false : 'rest'}
      whileHover={prefersReducedMotion ? undefined : 'hover'}
      whileTap={prefersReducedMotion ? undefined : 'tap'}
      className={`outline-none focus:outline-none focus:ring-0 select-none ${className ?? ''}`.trim()}
      style={{ overflow: 'visible' }}
      {...props}
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <MotionPath d="M3 9h18" variants={cellVariants(0)} />
      <MotionPath d="M3 14h18" variants={cellVariants(0.05)} />
      <MotionPath d="M9 4v16" variants={cellVariants(0.1)} />
      <MotionPath d="M15 4v16" variants={cellVariants(0.15)} />
    </MotionSvg>
  )
}
