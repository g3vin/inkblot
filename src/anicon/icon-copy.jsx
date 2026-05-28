import React from "react";
import { motion, useReducedMotion } from "framer-motion";

const MotionSvg = motion.svg;
const MotionRect = motion.rect;
const MotionG = motion.g;
const MotionPath = motion.path;

const backDocVariants = {
  rest: { x: 0, y: 0, opacity: 1 },
  hover: {
    x: 3,
    y: -3,
    transition: { type: "spring", stiffness: 400, damping: 17 },
  },
  tap: {
    x: 4,
    y: -4,
    transition: { type: "spring", stiffness: 400, damping: 17 },
  },
};

const frontDocVariants = {
  rest: { x: 0, y: 0, scale: 1 },
  hover: {
    x: -2,
    y: 2,
    scale: 1.02,
    transition: { type: "spring", stiffness: 400, damping: 17 },
  },
  tap: {
    x: -3,
    y: 3,
    scale: 1.05,
    transition: { type: "spring", stiffness: 400, damping: 17 },
  },
};

const checkVariants = {
  rest: { pathLength: 0, opacity: 0 },
  hover: {
    pathLength: 1,
    opacity: 1,
    transition: { duration: 0.3, delay: 0.1 },
  },
  tap: {
    pathLength: 1,
    opacity: 1,
    transition: { duration: 0.2 },
  },
};

export function IconCopy({
  size = 24,
  strokeWidth = 2,
  className,
  ...props
}) {
  const rest = props;
  const prefersReducedMotion = useReducedMotion();

  return (
    <MotionSvg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="-2 -4 28 30"
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
      {...rest}
    >
      {/* Back document - slides out */}
      <MotionRect
        x="9"
        y="9"
        width="13"
        height="13"
        rx="2"
        ry="2"
        variants={backDocVariants}
      />
      
      {/* Front document - slides forward */}
      <MotionG variants={frontDocVariants}>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        {/* Checkmark appears on copy - shows copy success */}
        <MotionPath
          d="M6 8l2 2 4-4"
          variants={checkVariants}
          style={{ pathLength: 0 }}
        />
      </MotionG>
    </MotionSvg>
  );
}
