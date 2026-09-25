import React from "react";
import { motion, useReducedMotion } from "framer-motion";

const MotionSvg = motion.svg;
const MotionLine = motion.line;

const minuteHandVariants = {
  rest: { rotate: 0 },
  hover: { 
    rotate: 360,
    transition: { 
      duration: 2,
      ease: "linear",
      repeat: Infinity
    }
  },
};

export function IconClock({ size = 24, strokeWidth = 2, className, ...props }) {
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
      initial="rest"
      whileHover="hover"
      className={`select-none ${className ?? ""}`.trim()}
      {...rest}
    >
      <circle cx="12" cy="12" r="9" />
      <MotionLine
        x1="12" y1="12" x2="12" y2="8"
        
        style={{ originX: "12px", originY: "12px" }}
      />
      <MotionLine
        x1="12" y1="12" x2="16" y2="14"
        variants={prefersReducedMotion ? {} : minuteHandVariants}
        style={{ originX: "12px", originY: "12px" }}
      />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </MotionSvg>
  );
}
