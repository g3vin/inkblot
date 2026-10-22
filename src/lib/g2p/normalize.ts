/**
 * The few rewrites made before misaki's pass (g2p.ts) sees the text.
 *
 * misaki leans on spaCy to keep an abbreviation's point attached ("St.") and reads a
 * clock time as two numbers with nothing between them. Without spaCy, the point
 * would split off as a full stop (a pause mid-sentence) and the colon would reach
 * the fallback, so both are spelled out here first.
 */

/** Abbreviations whose point isn't the end of a sentence, and how they're said. */
const ABBREVIATIONS: [RegExp, string][] = [
  [/\bSt\.(?= \p{Lu})/gu, 'Saint'],
  [/\bSt\./g, 'Street'],
  [/\bMt\./g, 'Mount'],
  [/\bJr\./g, 'Junior'],
  [/\bSr\./g, 'Senior'],
  [/\bProf\./g, 'Professor'],
  [/\bRev\./g, 'Reverend'],
  [/\bGen\./g, 'General'],
  [/\bCapt\./g, 'Captain'],
  [/\bCol\./g, 'Colonel'],
  [/\bLt\./g, 'Lieutenant'],
  [/\bSgt\./g, 'Sergeant'],
  [/\bAve\./g, 'Avenue'],
  [/\bvs\./gi, 'versus'],
  [/\be\.g\.(?=\s|,|$)/gi, 'for example'],
  [/\bi\.e\.(?=\s|,|$)/gi, 'that is'],
]

/** "9:30" → "9 30", "3:05" → "3 oh 5", "10:00" → "10 o'clock". */
const speakTime = (_: string, hour: string, minute: string) => {
  const m = Number(minute)
  if (m === 0) return `${hour} o'clock`
  return m < 10 ? `${hour} oh ${m}` : `${hour} ${minute}`
}

export function normalizeText(text: string): string {
  let out = String(text)
    .replace(/[‘’]/g, "'")
    .replace(/[^\S\n]+/g, ' ')
    .replace(/(?<![\d:])\b(1[0-2]|0?[1-9]):([0-5]\d)\b(?!:\d)/g, speakTime)
  for (const [pattern, words] of ABBREVIATIONS) out = out.replace(pattern, words)
  return out.trim()
}
