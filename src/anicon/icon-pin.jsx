import React from "react";
import { motion, useReducedMotion } from "framer-motion";

const MotionSvg = motion.svg;
const MotionG = motion.g;

const pinVariants = {
  rest: { y: 0, rotate: 0 },
  hover: {
    y: [0, -1, 0],
    rotate: [0, -6, 0],
    transition: { duration: 0.65, ease: "easeInOut" },
  },
};

export function IconPin({ size = 24, strokeWidth = 2, className, ...props }) {
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
      <MotionG variants={pinVariants} style={{ originX: "12px", originY: "15px" }}>
        <path d="M14 4a2 2 0 0 1 2 2v2l2 3H6l2-3V6a2 2 0 0 1 2-2z" />
        <path d="M12 11v9" />
      </MotionG>
    </MotionSvg>
  );
}
