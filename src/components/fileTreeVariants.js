/**
 * fileTreeVariants.js — framer-motion variant tables for the tree.
 *
 * Data, not behaviour; lifted out so FileTree.jsx reads as component logic.
 */
export const itemRevealVariants = {
  collapsed: {
    opacity: 0,
    y: -8,
  },
  expanded: (index = 0) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.2,
      ease: 'easeOut',
      delay: Math.min(index, 8) * 0.024,
    },
  }),
}

export const folderChildrenVariants = {
  collapsed: {
    height: 0,
    opacity: 0,
    transition: {
      duration: 0.18,
      ease: 'easeInOut',
      when: 'afterChildren',
      staggerChildren: 0.018,
      staggerDirection: -1,
    },
  },
  expanded: {
    height: 'auto',
    opacity: 1,
    transition: {
      duration: 0.24,
      ease: 'easeOut',
      when: 'beforeChildren',
      staggerChildren: 0.03,
      delayChildren: 0.02,
    },
  },
}

/* ---------- localStorage persistence for manual order & expanded folders ---------- */
