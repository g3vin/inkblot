import React from "react";
import { motion } from "framer-motion";

const MotionSvg = motion.svg;

export function IconChevronDown({
  size = 24,
  strokeWidth = 2,
  className,
  ...props
}) {
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
      whileHover={{ y: 1 }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: "spring", stiffness: 400, damping: 17 }}
      className={`outline-none focus:outline-none focus:ring-0 select-none ${className ?? ""}`.trim()}
      {...rest}
    >
      <path d="m6 9 6 6 6-6" />
    </MotionSvg>
  );
}
