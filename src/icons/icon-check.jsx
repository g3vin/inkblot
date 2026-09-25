import React from "react";
import { motion, useReducedMotion } from "framer-motion";

const MotionSvg = motion.svg;
const MotionPath = motion.path;

export function IconCheck({
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
      style={{ overflow: "visible" }}
      {...rest}
    >
      <MotionPath
        d="M4 12l5 5 11-11"
        variants={{
          rest: { pathLength: 1, opacity: 1 },
          hover: {
            pathLength: [0, 1],
            opacity: 1,
            transition: { duration: 0.5, ease: "easeOut" },
          },
          tap: { 
            pathLength: [0, 1],
            scale: 1.05,
            transition: { duration: 0.3 } 
          },
        }}
        style={{ 
          pathLength: 1,
          strokeDasharray: 1,
          strokeDashoffset: 0,
        }}
      />
    </MotionSvg>
  );
}
