import React from "react";
import { motion, useReducedMotion } from "framer-motion";

// The two bars pulse alternately, like a level meter — it reads as "still playing".
const barVariants = (delay) => ({
  rest: { scaleY: 1 },
  hover: {
    scaleY: [1, 0.78, 1],
    transition: { duration: 0.9, repeat: Infinity, ease: "easeInOut", delay },
  },
});

export function IconPause({ size = 24, strokeWidth = 2, className, ...props }) {
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
        x="6"
        y="4"
        width="4"
        height="16"
        rx="1"
        fill="currentColor"
        stroke="none"
        variants={barVariants(0)}
        style={{ transformOrigin: "center" }}
      />
      <motion.rect
        x="14"
        y="4"
        width="4"
        height="16"
        rx="1"
        fill="currentColor"
        stroke="none"
        variants={barVariants(0.2)}
        style={{ transformOrigin: "center" }}
      />
    </motion.svg>
  );
}
