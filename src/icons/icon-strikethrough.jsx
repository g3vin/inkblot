import React from "react";
import { motion, useReducedMotion } from "framer-motion";

const MotionSvg = motion.svg;
const MotionLine = motion.line;

const strikeVariants = {
  rest: { scaleX: 1, opacity: 1 },
  hover: {
    scaleX: [0.35, 1.12, 1],
    opacity: [0.5, 1, 1],
    transition: {
      duration: 1,
      repeat: Infinity,
      ease: "easeInOut"
    }
  },
};

export function IconStrikethrough({
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
      <path d="M16 4H9a3 3 0 0 0-2.83 4" />
      <path d="M14 12a4 4 0 0 1 0 8H6" />
      <MotionLine
        x1="4" y1="12" x2="20" y2="12"
        variants={prefersReducedMotion ? {} : strikeVariants}
        style={{ originX: "12px" }}
      />
    </MotionSvg>
  );
}
