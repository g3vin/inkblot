import React from "react";
import { motion, useReducedMotion } from "framer-motion";

// A dashed frame that breaks apart on hover, releasing the card inside it.
const frameVariants = {
  rest: { opacity: 1, scale: 1 },
  hover: {
    opacity: [1, 0.35, 1],
    scale: [1, 1.08, 1],
    transition: { duration: 1.2, repeat: Infinity, ease: "easeInOut" },
  },
};

const cardVariants = {
  rest: { scale: 1 },
  hover: {
    scale: [1, 0.9, 1],
    transition: { duration: 1.2, repeat: Infinity, ease: "easeInOut" },
  },
};

export function IconUngroup({ size = 24, strokeWidth = 2, className, ...props }) {
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
      <motion.rect
        x="2"
        y="2"
        width="20"
        height="20"
        rx="2"
        strokeDasharray="3 3"
        variants={frameVariants}
        style={{ transformOrigin: "center" }}
      />
      <motion.rect
        x="8"
        y="8"
        width="8"
        height="8"
        rx="1.5"
        variants={cardVariants}
        style={{ transformOrigin: "center" }}
      />
    </motion.svg>
  );
}
