import { motion, useReducedMotion } from 'framer-motion'

const dotVariants = {
  rest: (index) => ({
    scale: 1,
    y: 0,
    transition: { delay: index * 0.05 },
  }),
  hover: (index) => ({
    scale: 1.2,
    y: index % 2 === 0 ? -1 : 1,
    transition: { delay: index * 0.05, type: 'spring', stiffness: 500 },
  }),
  tap: { scale: 0.9 },
}

export function IconMenuDots({
  size = 24,
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
      fill="currentColor"
      stroke="none"
      initial={prefersReducedMotion ? false : 'rest'}
      whileHover={prefersReducedMotion ? undefined : 'hover'}
      whileTap={prefersReducedMotion ? undefined : 'tap'}
      className={`outline-none focus:outline-none focus:ring-0 select-none ${className ?? ''}`.trim()}
      {...props}
    >
      <motion.circle cx="6" cy="12" r="1.6" variants={dotVariants} custom={0} />
      <motion.circle cx="12" cy="12" r="1.6" variants={dotVariants} custom={1} />
      <motion.circle cx="18" cy="12" r="1.6" variants={dotVariants} custom={2} />
    </motion.svg>
  )
}
