import React from "react";
import { motion, useReducedMotion } from "framer-motion";

const MotionSvg = motion.svg;

const plusVariants = {
  rest: { scale: 1, rotate: 0 },
  hover: {
    scale: 1.15,
    rotate: 90,
    transition: { type: "spring", stiffness: 400, damping: 17 },
  },
  tap: {
    scale: 0.9,
    rotate: 180,
    transition: { type: "spring", stiffness: 400, damping: 17 },
  },
};

export function IconPlus({
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
      variants={plusVariants}
      initial={prefersReducedMotion ? false : "rest"}
      whileHover={prefersReducedMotion ? undefined : "hover"}
      whileTap={prefersReducedMotion ? undefined : "tap"}
      className={`outline-none focus:outline-none focus:ring-0 select-none ${className ?? ""}`.trim()}
      {...rest}
    >
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </MotionSvg>
  );
}
