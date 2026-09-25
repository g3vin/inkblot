import React from "react";
import { motion, useReducedMotion } from "framer-motion";

const MotionSvg = motion.svg;
const MotionPath = motion.path;

const lineVariants = {
  rest: { x: 0, scaleX: 1 },
  hover: { x: 1.5, scaleX: 0.95 },
  tap: { x: -1, scaleX: 1.02 },
};

export function IconAlignRight({ size = 24, strokeWidth = 2, className, ...props }) {
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
      transition={{ type: "spring", stiffness: 320, damping: 18 }}
      className={`outline-none focus:outline-none focus:ring-0 select-none ${className ?? ""}`.trim()}
      {...rest}
    >
      <MotionPath d="M21 6H3" variants={lineVariants} style={{ originX: 1, originY: "50%" }} />
      <MotionPath d="M21 12H9" variants={lineVariants} style={{ originX: 1, originY: "50%" }} />
      <MotionPath d="M21 18H7" variants={lineVariants} style={{ originX: 1, originY: "50%" }} />
    </MotionSvg>
  );
}
