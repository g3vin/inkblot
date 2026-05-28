import React from "react";
import { motion, useReducedMotion } from "framer-motion";

const MotionSvg = motion.svg;
const MotionPath = motion.path;

const dotVariants = {
  rest: { scale: 1, opacity: 1 },
  hover: {
    scale: [1, 1.5, 1],
    transition: { duration: 0.5, repeat: Infinity },
  },
};

const lineVariants = {
  rest: { x: 0 },
  hover: {
    x: [0, 2, 0],
    transition: { duration: 0.4, ease: "easeInOut" },
  },
};

export function IconList({
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
      <MotionPath d="M3 5h.01" variants={prefersReducedMotion ? {} : dotVariants} transition={{ delay: 0.1 }} />
      <MotionPath d="M3 12h.01" variants={prefersReducedMotion ? {} : dotVariants} transition={{ delay: 0.2 }} />
      <MotionPath d="M3 19h.01" variants={prefersReducedMotion ? {} : dotVariants} transition={{ delay: 0.3 }} />
      <MotionPath d="M8 5h13" variants={prefersReducedMotion ? {} : lineVariants} transition={{ delay: 0.1 }} />
      <MotionPath d="M8 12h13" variants={prefersReducedMotion ? {} : lineVariants} transition={{ delay: 0.2 }} />
      <MotionPath d="M8 19h13" variants={prefersReducedMotion ? {} : lineVariants} transition={{ delay: 0.3 }} />
    </MotionSvg>
  );
}
