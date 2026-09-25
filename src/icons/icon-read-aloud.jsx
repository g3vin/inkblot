import { motion, useReducedMotion } from 'framer-motion'

const bubbleVariants = {
  rest: { y: 0 },
  hover: {
    y: [0, -1, 0],
    transition: {
      duration: 1,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
}

const waveVariants = {
  rest: { scale: 1, opacity: 1 },
  hover: {
    scale: [1, 1.1, 1],
    opacity: [1, 0.4, 1],
    transition: {
      duration: 1.5,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
}

export function IconReadAloud({
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
      <motion.path
        d="M8.8 20v-4.1l1.9.2a2.3 2.3 0 0 0 2.164-2.1V8.3A5.37 5.37 0 0 0 2 8.25c0 2.8.656 3.054 1 4.55a5.77 5.77 0 0 1 .029 2.758L2 20"
        variants={bubbleVariants}
      />
      <motion.path
        d="M19.8 17.8a7.5 7.5 0 0 0 .003-10.603"
        variants={waveVariants}
        style={{ originX: '14px', originY: '12px' }}
      />
      <motion.path
        d="M17 15a3.5 3.5 0 0 0-.025-4.975"
        variants={waveVariants}
        style={{ originX: '14px', originY: '12px' }}
        transition={{ delay: 0.2 }}
      />
    </motion.svg>
  )
}
