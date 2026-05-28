import { motion, useReducedMotion } from 'framer-motion'

const arrowVariants = {
  rest: { y: 0 },
  hover: { y: -2 },
  tap: { y: -4 },
}

const dotVariants = {
  rest: { scale: 1 },
  hover: { scale: 1.2 },
  tap: { scale: 0.9 },
}

export function IconArrowUpFromDot({
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
      transition={{ type: 'spring', stiffness: 320, damping: 18 }}
      className={`outline-none focus:outline-none focus:ring-0 select-none ${className ?? ''}`.trim()}
      {...props}
    >
      <motion.g variants={arrowVariants}>
        <path d="m5 9 7-7 7 7" />
        <path d="M12 16V2" />
      </motion.g>
      <motion.circle cx="12" cy="21" r="1" variants={dotVariants} />
    </motion.svg>
  )
}
