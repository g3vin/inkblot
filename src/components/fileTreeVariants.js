/**
 * fileTreeVariants.js — framer-motion variant tables for the tree.
 *
 * Data, not behaviour; lifted out so FileTree.jsx reads as component logic.
 */
import { SPRINGS, toFramer } from '../ui/physics.js'

export const itemRevealVariants = {
  collapsed: {
    opacity: 0,
    y: -8,
  },
  expanded: (index = 0) => ({
    opacity: 1,
    y: 0,
    transition: toFramer(SPRINGS.smooth, { delay: Math.min(index, 8) * 0.024 }),
  }),
}

export const folderChildrenVariants = {
  collapsed: {
    height: 0,
    opacity: 0,
    // Folded away in one movement, children with it, so a big folder closes as quickly
    // as a small one and never slower than it opened.
    transition: toFramer(SPRINGS.exit),
  },
  expanded: {
    height: 'auto',
    opacity: 1,
    transition: {
      ...toFramer(SPRINGS.smooth),
      when: 'beforeChildren',
      staggerChildren: 0.03,
      delayChildren: 0.02,
    },
  },
}

/* ---------- persistence for manual order & expanded folders ---------- */
