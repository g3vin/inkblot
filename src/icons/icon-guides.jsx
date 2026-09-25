import React from "react";
import { motion, useReducedMotion } from "framer-motion";

const MotionSvg = motion.svg;
const MotionLine = motion.line;

const guideVariants = {
  rest: { opacity: 0.9 },
  hover: {
    opacity: [0.9, 0.3, 0.9],
    transition: {
      duration: 1,
      repeat: Infinity,
      ease: "easeInOut"
    }
  },
};

export function IconGuides({
  size = 24,
  strokeWidth = 2,
  className,
  ...props
}) {
  const prefersReducedMotion = useReducedMotion();
  const rest = props;

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
      className={`select-none ${className ?? ""}`.trim()}
      initial="rest"
      whileHover="hover"
      {...rest}
    >
      {/* The card, and the two guides it has snapped to. */}
      <rect x="9" y="9" width="11" height="11" rx="1.5" />
      <MotionLine
        x1="4" y1="2" x2="4" y2="22"
        strokeDasharray="2 2"
        variants={prefersReducedMotion ? {} : guideVariants}
      />
      <MotionLine
        x1="2" y1="5" x2="22" y2="5"
        strokeDasharray="2 2"
        variants={prefersReducedMotion ? {} : guideVariants}
      />
    </MotionSvg>
  );
}
