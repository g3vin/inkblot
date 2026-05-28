import React from "react";
import { motion, useReducedMotion } from "framer-motion";

const MotionSvg = motion.svg;
const MotionPath = motion.path;

const fileVariants = {
  rest: { y: 0, scale: 1, rotate: 0 },
  hover: { 
    y: -4, 
    scale: 1.02, 
    rotate: -1,
    transition: { type: "spring", stiffness: 400, damping: 17 } 
  },
  tap: { scale: 0.95 },
};

const lineVariants = {
  rest: { pathLength: 1, opacity: 1 },
  hover: {
    pathLength: [0, 1],
    opacity: [0, 1],
    transition: { duration: 0.4, ease: "easeInOut" },
  },
};

export function IconFile({
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
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      initial={prefersReducedMotion ? false : "rest"}
      whileHover={prefersReducedMotion ? undefined : "hover"}
      whileTap={prefersReducedMotion ? undefined : "tap"}
      variants={fileVariants}
      className={`outline-none focus:outline-none focus:ring-0 select-none ${className ?? ""}`.trim()}
      style={{ overflow: "visible" }}
      {...rest}
    >
      {/* Proper File Path with slanted corner */}
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
      
      {/* Content lines that "draw" on hover */}
      <MotionPath d="M8 13h8" variants={lineVariants} />
      <MotionPath d="M8 17h8" variants={lineVariants} />
      <MotionPath d="M8 9h2" variants={lineVariants} />
    </MotionSvg>
  );
}
