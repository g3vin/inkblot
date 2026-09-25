import React from "react";
import { motion, useReducedMotion } from "framer-motion";

const MotionSvg = motion.svg;
const MotionPath = motion.path;

const topVariants = {
  rest: { scaleX: 0.9, y: 0 },
  hover: { scaleX: 0.8, y: 1 },
  tap: { scaleX: 0.95, y: -1 },
};

const midVariants = {
  rest: { scaleX: 1 },
  hover: { scaleX: 1.08 },
  tap: { scaleX: 0.94 },
};

const bottomVariants = {
  rest: { scaleX: 0.9, y: 0 },
  hover: { scaleX: 0.8, y: -1 },
  tap: { scaleX: 0.95, y: 1 },
};

export function IconAlignCenter({ size = 24, strokeWidth = 2, className, ...props }) {
  const rest = props;
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
      transition={{ type: "spring", stiffness: 300, damping: 16 }}
      className={`outline-none focus:outline-none focus:ring-0 select-none ${className ?? ""}`.trim()}
      {...rest}
    >
      <MotionPath d="M21 6H3" variants={topVariants} style={{ originX: "50%", originY: "50%" }} />
      <MotionPath d="M17 12H7" variants={midVariants} style={{ originX: "50%", originY: "50%" }} />
      <MotionPath d="M19 18H5" variants={bottomVariants} style={{ originX: "50%", originY: "50%" }} />
    </MotionSvg>
  );
}
