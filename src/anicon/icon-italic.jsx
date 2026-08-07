import React from "react";
import { motion, useReducedMotion } from "framer-motion";

const MotionSvg = motion.svg;
const MotionG = motion.g;

const slantVariants = {
  rest: { skewX: 0 },
  hover: {
    skewX: [0, -6, 0],
    transition: {
      duration: 1,
      repeat: Infinity,
      ease: "easeInOut"
    }
  },
};

export function IconItalic({
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
      <MotionG
        variants={prefersReducedMotion ? {} : slantVariants}
        style={{ originX: "12px", originY: "12px" }}
      >
        <line x1="19" y1="4" x2="10" y2="4" />
        <line x1="14" y1="20" x2="5" y2="20" />
        <line x1="15" y1="4" x2="9" y2="20" />
      </MotionG>
    </MotionSvg>
  );
}
