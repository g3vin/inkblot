import React from "react";
import { motion, useReducedMotion } from "framer-motion";

// The shackle lifts a touch on hover — the latch about to give.
const shackleVariants = {
  rest: { y: 0 },
  hover: {
    y: [0, -1.5, 0],
    transition: { duration: 1.1, repeat: Infinity, ease: "easeInOut" },
  },
};

export function IconLock({ size = 24, strokeWidth = 2, className, ...props }) {
  const restOptions = props;
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
      className={`outline-none focus:outline-none focus:ring-0 select-none ${className ?? ""}`.trim()}
      style={{ overflow: "visible" }}
      {...restOptions}
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <motion.path d="M7 11V7a5 5 0 0 1 10 0v4" variants={shackleVariants} />
    </motion.svg>
  );
}
