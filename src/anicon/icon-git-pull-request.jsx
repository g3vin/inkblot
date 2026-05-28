import { motion, useReducedMotion } from 'framer-motion'

const circleVariants = {
  rest: { scale: 1 },
  hover: {
    scale: [1, 1.2, 1],
    transition: {
      duration: 0.5,
      repeat: Infinity,
      repeatDelay: 1,
    },
  },
}

const pathVariants = {
  rest: { pathLength: 1 },
  hover: {
    pathLength: [1, 0.5, 1],
    transition: {
      duration: 1,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
}

export function IconGitPullRequest({
  size = 24,
  strokeWidth = 2,
  className,
  ...props
}) {
  const prefersReducedMotion = useReducedMotion()

  return (
    <motion.svg
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
      <motion.circle cx="18" cy="18" r="3" variants={circleVariants} />
      <motion.circle cx="6" cy="6" r="3" variants={circleVariants} />
      <motion.path d="M13 6h3a2 2 0 0 1 2 2v7" variants={pathVariants} />
      <motion.line x1="6" x2="6" y1="9" y2="21" variants={pathVariants} />
    </motion.svg>
  )
}
