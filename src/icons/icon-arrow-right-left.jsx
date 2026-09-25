import React from "react";
import { motion, useReducedMotion } from "framer-motion";

const rightVariants = {
  rest: { x: 0 },
  hover: { x: 2 },
  tap: { x: 4 },
};

const leftVariants = {
  rest: { x: 0 },
  hover: { x: -2 },
  tap: { x: -4 },
};

export function IconArrowRightLeft({ size = 24, strokeWidth = 2, className, ...props }) {
  const rest = props;
  const prefersReducedMotion = useReducedMotion();

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
      initial={prefersReducedMotion ? false : "rest"}
      whileHover={prefersReducedMotion ? undefined : "hover"}
      whileTap={prefersReducedMotion ? undefined : "tap"}
      transition={{ type: "spring", stiffness: 320, damping: 18 }}
      className={`outline-none focus:outline-none focus:ring-0 select-none ${className ?? ""}`.trim()}
      {...rest}
    >
      <motion.g variants={rightVariants}>
        <path d="m16 3 4 4-4 4" />
        <path d="M20 7H4" />
      </motion.g>
      <motion.g variants={leftVariants}>
        <path d="m8 21-4-4 4-4" />
        <path d="M4 17h16" />
      </motion.g>
    </motion.svg>
  );
}
