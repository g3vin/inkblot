/**
 * The one assertion every suite uses: print PASS or FAIL for a labelled condition, and
 * mark the process failed on FAIL. A failure does not throw, so a suite reports every
 * assertion rather than stopping at the first; `run.mjs` reads `process.exitCode`
 * after each suite.
 */
export const ok = (label, condition) => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`)
  if (!condition) process.exitCode = 1
}
