import React from "react";
import { motion, useReducedMotion } from "framer-motion";

const MotionSvg = motion.svg;

const pinVariants = {
  rest: { y: 0, scale: 1 },
  hover: {
    y: [0, -4, 0],
    scale: [1, 1.05, 1],
    transition: {
      duration: 0.6,
      times: [0, 0.4, 1],
      ease: "easeOut",
    },
  },
};

export function IconMapPin({
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
      variants={pinVariants}
      className={`outline-none focus:outline-none focus:ring-0 select-none ${className ?? ""}`.trim()}
      style={{ overflow: "visible", originY: "22px" }}
      {...rest}
    >
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </MotionSvg>
  );
}
