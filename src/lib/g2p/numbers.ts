/**
 * Numbers as English words, the way Python's `num2words` writes them.
 *
 * misaki (see `g2p.ts`) reads a number by asking `num2words` for its words and then
 * looking each word up, so only the words matter, not the punctuation between them.
 * Each function returns a string in num2words' own spelling ("one hundred and
 * twenty-one"), and the caller splits it on anything that isn't a letter. The `g2p`
 * suite checks these against num2words' output.
 */

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const SCALES = [
  '', 'thousand', 'million', 'billion', 'trillion', 'quadrillion', 'quintillion',
  'sextillion', 'septillion', 'octillion', 'nonillion', 'decillion',
]

/** 0–999, with num2words' "and" before the tens. */
const underThousand = (n: number): string => {
  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  const tail = rest < 20 ? ONES[rest] : TENS[Math.floor(rest / 10)] + (rest % 10 ? `-${ONES[rest % 10]}` : '')
  if (!hundreds) return tail
  return rest ? `${ONES[hundreds]} hundred and ${tail}` : `${ONES[hundreds]} hundred`
}

/** A whole number in words: 1234 → "one thousand, two hundred and thirty-four". */
export function cardinal(value: number | bigint | string): string {
  let n = BigInt(value)
  if (n < 0n) return `minus ${cardinal(-n)}`
  if (n === 0n) return 'zero'

  const groups: number[] = []
  while (n > 0n) {
    groups.push(Number(n % 1000n))
    n /= 1000n
  }
  if (groups.length > SCALES.length) return String(value).split('').map((d) => ONES[Number(d)]).join(' ')

  const parts: string[] = []
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const group = groups[i]
    if (!group) continue
    const words = underThousand(group)
    // num2words joins a last group under 100 with "and", the others with a comma.
    if (parts.length && i === 0 && group < 100) parts.push(`and ${words}`)
    else parts.push(SCALES[i] ? `${words} ${SCALES[i]}` : words)
  }
  return parts.join(', ').replace(/, and /g, ' and ')
}

const IRREGULAR_ORDINALS: Record<string, string> = {
  one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth',
  nine: 'ninth', twelve: 'twelfth',
}

/** 21 → "twenty-first". */
export function ordinal(value: number | bigint | string): string {
  const words = cardinal(value)
  const match = /([a-z]+)$/.exec(words)
  if (!match) return words
  const last = match[1]
  const turned = IRREGULAR_ORDINALS[last]
    ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`)
  return words.slice(0, match.index) + turned
}

/** 1984 → "nineteen eighty-four", 1905 → "nineteen oh-five", 2005 → "two thousand and five". */
export function year(value: number): string {
  const high = Math.floor(value / 100)
  const low = value % 100
  if (high === 0 || (high % 10 === 0 && low < 10) || high >= 100) return cardinal(value)
  const lowText = low === 0 ? 'hundred' : low < 10 ? `oh-${cardinal(low)}` : cardinal(low)
  return `${cardinal(high)} ${lowText}`
}

/** "3.14" → "three point one four"; a whole value reads as a whole number. */
export function decimal(text: string): string {
  const [whole = '', fraction = ''] = text.split('.')
  const digits = fraction.replace(/0+$/, '')
  const head = cardinal(whole || '0')
  return digits ? `${head} point ${digits.split('').map((d) => ONES[Number(d)]).join(' ')}` : head
}
