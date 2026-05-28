import React from "react";
import { motion, useReducedMotion } from "framer-motion";

const MotionSvg = motion.svg;
const MotionG = motion.g;
const MotionPath = motion.path;

const flapVariants = {
  rest: { rotateX: 0 },
  hover: {
    rotateX: -25,
    transition: { type: "spring", stiffness: 300, damping: 15 },
  },
  tap: {
    rotateX: -35,
  },
};

const docVariants = {
  rest: { y: 4, opacity: 0 },
  hover: {
    y: -4,
    opacity: 1,
    transition: { type: "spring", stiffness: 300, damping: 15, delay: 0.05 },
  },
  tap: {
    y: -6,
  },
};

export function IconFolder({
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
      className={`outline-none focus:outline-none focus:ring-0 select-none ${className ?? ""}`.trim()}
      style={{ overflow: "visible", perspective: "100px" }}
      {...rest}
    >
      {/* Folder Back Face */}
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v15Z" />
      
      {/* Improved Document peeking out */}
      <MotionG variants={docVariants}>
        <rect x="8" y="7" width="8" height="10" rx="1" fill="none" strokeWidth={strokeWidth * 0.8} />
        <path d="M10 11h4" strokeWidth={strokeWidth * 0.5} opacity={0.6} />
        <path d="M10 14h4" strokeWidth={strokeWidth * 0.5} opacity={0.6} />
      </MotionG>
      
      {/* Folder Front Face / Flap */}
      <MotionPath 
        d="M2 10v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-9Z" 
        variants={flapVariants}
        style={{ originY: "100%", transformStyle: "preserve-3d" }}
      />
    </MotionSvg>
  );
}
