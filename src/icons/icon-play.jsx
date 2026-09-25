import React from "react";
import { motion, useReducedMotion } from "framer-motion";

const playVariants = {
  rest: { scale: 1 },
  hover: {
    scale: [1, 1.12, 1],
    transition: { duration: 1, repeat: Infinity, ease: "easeInOut" },
  },
};

export function IconPlay({ size = 24, strokeWidth = 2, className, ...props }) {
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
      <motion.polygon
        points="6 3 20 12 6 21 6 3"
        fill="currentColor"
        stroke="none"
        variants={playVariants}
        style={{ transformOrigin: "center" }}
      />
    </motion.svg>
  );
}
