import { motion, useReducedMotion } from 'framer-motion'

const MotionSvg = motion.svg
const MotionPath = motion.path
const MotionRect = motion.rect

const cardVariants = (delay) => ({
  rest: { scale: 1 },
  hover: {
    scale: [1, 1.08, 1],
    transition: { duration: 0.35, delay, ease: 'easeInOut' },
  },
})

// The connector draws itself in on hover, echoing dragging an arrow between cards.
const linkVariants = {
  rest: { pathLength: 1, opacity: 1 },
  hover: {
    pathLength: [0, 1],
    opacity: [0.3, 1],
    transition: { duration: 0.4, ease: 'easeOut' },
  },
}

export function IconCanvas({
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
      className={`outline-none focus:outline-none focus:ring-0 select-none ${className ?? ''}`.trim()}
      style={{ overflow: 'visible' }}
      {...props}
    >
      <MotionRect
        x="2.5"
        y="4"
        width="8"
        height="6.5"
        rx="1.5"
        style={{ originX: '6.5px', originY: '7.25px' }}
        variants={cardVariants(0)}
      />
      <MotionRect
        x="13.5"
        y="13.5"
        width="8"
        height="6.5"
        rx="1.5"
        style={{ originX: '17.5px', originY: '16.75px' }}
        variants={cardVariants(0.12)}
      />
      <MotionPath d="M10.5 7.25h4a3 3 0 0 1 3 3v3.25" variants={linkVariants} />
    </MotionSvg>
  )
}
