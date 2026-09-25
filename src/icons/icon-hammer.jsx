import React from "react";
import { motion, useReducedMotion } from "framer-motion";

const MotionSvg = motion.svg;
const MotionG = motion.g;

const hammerVariants = {
  rest: { rotate: 0 },
  hover: {
    rotate: [0, -35, 10, 0],
    transition: {
      duration: 1.2,
      repeat: Infinity,
      ease: "easeInOut",
      times: [0, 0.2, 0.4, 1],
    },
  },
};

export function IconHammer({
  size = 24,
  strokeWidth = 2,
  className,
  ...props
}) {
  const restOptions = props;
  const prefersReducedMotion = useReducedMotion();

  return (
    <MotionSvg
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
      <MotionG variants={hammerVariants} style={{ originX: "6px", originY: "18px" }}>
        <path d="m15 12-9.373 9.373a1 1 0 0 1-3.001-3L12 9" />
        <path d="m18 15 4-4" />
        <path d="m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172v-.344a2 2 0 0 0-.586-1.414l-1.657-1.657A6 6 0 0 0 12.516 3H9l1.243 1.243A6 6 0 0 1 12 8.485V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5" />
      </MotionG>
    </MotionSvg>
  );
}
