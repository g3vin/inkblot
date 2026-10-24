/**
 * motion.js — the timings script needs, mirroring the motion tokens in
 * styles/tokens.css. Durations and easing stay in CSS; what lives here is what only
 * script can act on: how long to wait before admitting something is loading.
 */
export const REVEAL = {
  /** A load quicker than this never shows a skeleton. */
  delay: 150,
  /** A skeleton that does show stays at least this long, so it never flickers. */
  minVisible: 300,
  /** A gated screen opens after this even if a piece never reports, so nothing stays hidden. */
  gateTimeout: 2000,
  /** Mirrors --reveal-stagger, for counting how many items a stagger can reach. */
  stagger: 24,
  /** Items past this many arrive with the last one rather than trailing off. */
  staggerCap: 8,
}
