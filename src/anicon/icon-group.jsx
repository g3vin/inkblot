import React from "react";
import { motion, useReducedMotion } from "framer-motion";

// The two cards drift together on hover — the gesture the button performs.
const frontVariants = {
  rest: { x: 0, y: 0 },
  hover: {
    x: [0, -1.5, 0],
    y: [0, 1.5, 0],
    transition: { duration: 1.2, repeat: Infinity, ease: "easeInOut" },
  },
};

const backVariants = {
  rest: { x: 0, y: 0 },
  hover: {
    x: [0, 1.5, 0],
    y: [0, -1.5, 0],
    transition: { duration: 1.2, repeat: Infinity, ease: "easeInOut" },
  },
};

export function IconGroup({ size = 24, strokeWidth = 2, className, ...props }) {
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
      <motion.rect x="11" y="3" width="10" height="10" rx="2" variants={backVariants} />
      <motion.rect x="3" y="11" width="10" height="10" rx="2" variants={frontVariants} />
    </motion.svg>
  );
}
