/**
 * wordCount.ts — what Inkblot means by "a word".
 *
 * One definition, shared by the pane's badge and the stats the shell keeps, so the
 * number a writer sees under the page is the number their goals are measured in.
 */

/** Whitespace-delimited word count. */
export const countWords = (text = ''): number => {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}
