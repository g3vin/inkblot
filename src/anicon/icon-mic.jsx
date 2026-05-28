import { motion, useReducedMotion } from 'framer-motion'

const MotionSvg = motion.svg
const MotionG = motion.g
const MotionPath = motion.path

const micVariants = {
  rest: { y: 0 },
  hover: {
    y: [0, -1, 0],
    transition: { duration: 0.7, repeat: Infinity, ease: 'easeInOut' },
  },
  tap: { scale: 0.92 },
}

const waveVariants = {
  rest: { opacity: 0.45, scaleX: 0.9 },
  hover: (index) => ({
    opacity: [0.25, 0.85, 0.25],
    scaleX: [0.8, 1.12, 0.8],
    transition: {
      duration: 0.9,
      repeat: Infinity,
      delay: index * 0.12,
      ease: 'easeInOut',
    },
  }),
}

export function IconMic({
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
      <MotionG variants={micVariants}>
        <rect x="9" y="2.5" width="6" height="11" rx="3" />
        <path d="M5 10.5a7 7 0 0 0 14 0" />
        <path d="M12 17.5v4" />
        <path d="M8.5 21.5h7" />
      </MotionG>
      <MotionPath d="M4 6.5c-1 1-1.5 2.1-1.5 3.5" variants={waveVariants} custom={0} />
      <MotionPath d="M20 6.5c1 1 1.5 2.1 1.5 3.5" variants={waveVariants} custom={1} />
    </MotionSvg>
  )
}
