import React from "react";
import { motion, useReducedMotion } from "framer-motion";

// The "sun" lifts and the mountain ridge breathes — the picture coming into view.
const sunVariants = {
  rest: { y: 0, opacity: 1 },
  hover: {
    y: [0, -1.5, 0],
    opacity: [1, 0.6, 1],
    transition: { duration: 1.4, repeat: Infinity, ease: "easeInOut" },
  },
};

const ridgeVariants = {
  rest: { pathLength: 1, opacity: 1 },
  hover: {
    pathLength: [1, 0.75, 1],
    transition: { duration: 1.4, repeat: Infinity, ease: "easeInOut", delay: 0.2 },
  },
};

export function IconImage({ size = 24, strokeWidth = 2, className, ...props }) {
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
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <motion.circle cx="8.5" cy="8.5" r="1.5" variants={sunVariants} />
      <motion.path d="M21 15l-5-5L5 21" variants={ridgeVariants} />
    </motion.svg>
  );
}
