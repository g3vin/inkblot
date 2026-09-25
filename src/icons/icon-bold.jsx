import React from "react";
import { motion, useReducedMotion } from "framer-motion";

const MotionSvg = motion.svg;
const MotionPath = motion.path;

const boldVariants = {
  rest: { scale: 1 },
  hover: { 
    scale: [1, 1.05, 1],
    transition: { 
      duration: 0.8,
      repeat: Infinity,
      ease: "easeInOut"
    }
  },
};

export function IconBold({ 
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
      <MotionPath 
        d="M6 12h9a4 4 0 0 1 0 8H6v-8Z" 
        variants={prefersReducedMotion ? {} : boldVariants}
        style={{ originX: "6px" }}
      />
      <MotionPath 
        d="M6 4h8a4 4 0 0 1 0 8H6V4Z" 
        variants={prefersReducedMotion ? {} : boldVariants}
        style={{ originX: "6px" }}
      />
    </MotionSvg>
  );
}
