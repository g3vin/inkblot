import React from "react";
import { motion, useReducedMotion } from "framer-motion";

const MotionSvg = motion.svg;
const MotionCircle = motion.circle;
const MotionPath = motion.path;

const headVariants = {
  rest: { scale: 1 },
  hover: {
    scale: [1, 1.1, 1],
    transition: {
      duration: 0.8,
      repeat: Infinity,
      ease: "easeInOut",
    },
  },
};

const bodyVariants = {
  rest: { scale: 1 },
  hover: {
    scale: [1, 1.05, 1],
    transition: {
      duration: 0.8,
      repeat: Infinity,
      ease: "easeInOut",
    },
  },
};

export function IconUserRound({
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
      initial={prefersReducedMotion ? false : "rest"}
      whileHover={prefersReducedMotion ? undefined : "hover"}
      whileTap={prefersReducedMotion ? undefined : "tap"}
      className={`outline-none focus:outline-none focus:ring-0 select-none ${className ?? ""}`.trim()}
      style={{ overflow: "visible" }}
      {...rest}
    >
      <MotionCircle
        cx="12"
        cy="8"
        r="5"
        variants={headVariants}
        style={{ originX: "12px", originY: "8px" }}
      />
      <MotionPath
        d="M20 21a8 8 0 0 0-16 0"
        variants={bodyVariants}
        style={{ originX: "12px", originY: "21px" }}
      />
    </MotionSvg>
  );
}
