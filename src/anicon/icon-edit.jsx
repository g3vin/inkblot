import React from "react";
import { motion, useReducedMotion } from "framer-motion";

const MotionSvg = motion.svg;

export function IconEdit({
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
      initial={prefersReducedMotion ? false : { rotate: 0 }}
      whileHover={
        prefersReducedMotion
          ? undefined
          : { rotate: -8, transition: { type: "spring", stiffness: 400, damping: 17 } }
      }
      whileTap={
        prefersReducedMotion
          ? undefined
          : { rotate: -12, scale: 0.95, transition: { type: "spring", stiffness: 400, damping: 17 } }
      }
      style={{ originX: "80%", originY: "80%" }}
      className={`outline-none focus:outline-none focus:ring-0 select-none ${className ?? ""}`.trim()}
      {...rest}
    >
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </MotionSvg>
  );
}
