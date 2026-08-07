import React from "react";
import { motion, useReducedMotion } from "framer-motion";

const horizontalVariants = {
  rest: { pathLength: 1, opacity: 1 },
  hover: {
    pathLength: [1, 0.6, 1],
    opacity: [1, 0.7, 1],
    transition: {
      duration: 1.5,
      repeat: Infinity,
      ease: "easeInOut",
    },
  },
};

const verticalVariants = {
  rest: { pathLength: 1, opacity: 1 },
  hover: {
    pathLength: [1, 0.6, 1],
    opacity: [1, 0.7, 1],
    transition: {
      duration: 1.5,
      repeat: Infinity,
      delay: 0.3,
      ease: "easeInOut",
    },
  },
};

export function IconFrame({ size = 24, strokeWidth = 2, className, ...props }) {
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
      whileTap={prefersReducedMotion ? undefined : "tap"}
      className={`outline-none focus:outline-none focus:ring-0 select-none ${className ?? ""}`.trim()}
      style={{ overflow: "visible" }}
      {...restOptions}
    >
      <motion.line x1="22" x2="2" y1="6" y2="6" variants={horizontalVariants} />
      <motion.line x1="22" x2="2" y1="18" y2="18" variants={horizontalVariants} />
      <motion.line x1="6" x2="6" y1="2" y2="22" variants={verticalVariants} />
      <motion.line x1="18" x2="18" y1="2" y2="22" variants={verticalVariants} />
    </motion.svg>
  );
}
