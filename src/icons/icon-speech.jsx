import { motion, useReducedMotion } from 'framer-motion'

const MotionSvg = motion.svg
const MotionPath = motion.path

const bubbleVariants = {
  rest: { y: 0 },
  hover: {
    y: [0, -1.4, 0],
    transition: { duration: 0.8, repeat: Infinity, ease: 'easeInOut' },
  },
  tap: { scale: 0.94 },
}

const lineVariants = {
  rest: { pathLength: 1, opacity: 0.72 },
  hover: (index) => ({
    pathLength: [0.35, 1, 0.35],
    opacity: [0.38, 0.95, 0.38],
    transition: {
      duration: 0.95,
      repeat: Infinity,
      delay: index * 0.1,
      ease: 'easeInOut',
    },
  }),
}

export function IconSpeech({
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
      <MotionPath
        d="M4 5.5c0-1.4 1.1-2.5 2.5-2.5h11c1.4 0 2.5 1.1 2.5 2.5v7c0 1.4-1.1 2.5-2.5 2.5H11l-5.2 4.2c-.7.5-1.8.1-1.8-.8V5.5Z"
        variants={bubbleVariants}
      />
      <MotionPath d="M8 8h8" variants={lineVariants} custom={0} />
      <MotionPath d="M8 11h5.5" variants={lineVariants} custom={1} />
    </MotionSvg>
  )
}
