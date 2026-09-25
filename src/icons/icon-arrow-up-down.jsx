import React from "react";
import { motion, useReducedMotion } from "framer-motion";

const upVariants = {
  rest: { y: 0 },
  hover: { y: -2 },
  tap: { y: -4 },
};

const downVariants = {
  rest: { y: 0 },
  hover: { y: 2 },
  tap: { y: 4 },
};

export function IconArrowUpDown({ size = 24, strokeWidth = 2, className, ...props }) {
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
      <motion.g variants={downVariants}>
        <path d="m21 16-4 4-4-4" />
        <path d="M17 20V4" />
      </motion.g>
      <motion.g variants={upVariants}>
        <path d="m3 8 4-4 4 4" />
        <path d="M7 4v16" />
      </motion.g>
    </motion.svg>
  );
}
