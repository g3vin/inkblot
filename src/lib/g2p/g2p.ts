/**
 * English text to Kokoro's phonemes: a port of misaki's `G2P` (hexgrad/misaki,
 * `en.py`, Apache-2.0), the pass Kokoro v1.0 was trained with.
 *
 *   text -> words and punctuation -> lexicon (lexicon.ts) -> fallback (fallback.ts)
 *
 * misaki tokenizes and tags with spaCy. This splits on whitespace and then into
 * misaki's own sub-tokens (its SUBTOKEN_REGEX), and guesses the few tags the lexicon
 * consults from the word before: "to" or a modal makes a verb ("to live"), a
 * determiner a noun ("the record"), "had" a participle ("had read"). Without that
 * guess a heteronym takes the dictionary's default.
 *
 * Words are read right to left, as misaki does, because "the", "to" and "a" depend on
 * the sound that follows them.
 */
import { guess } from './fallback'
import { normalizeText } from './normalize'
import {
  CONSONANTS,
  CURRENCIES,
  Lexicon,
  PRIMARY_STRESS,
  SYMBOLS,
  VOWELS,
  applyStress,
  type LexiconData,
  type LexiconToken,
  type TokenContext,
} from './lexicon'

const SUBTOKEN = /^['‘’]+|\p{Lu}(?=\p{Lu}\p{Ll})|(?:^-)?(?:\d?[,.]?\d)+|[-_]+|['‘’]{2,}|\p{L}*?(?:['‘’]\p{L})*?\p{Ll}(?=\p{Lu})|\p{L}+(?:['‘’]\p{L})*|[^-_\p{L}'‘’\d]|['‘’]+$/gu
const SUBTOKEN_JUNKS = new Set("',-._‘’/")
const PUNCTS = new Set(';:,.!?—…"“”')
const NON_QUOTE_PUNCTS = new Set(';:,.!?—…')
const DIPHTHONGS = new Set('AIOQWYʤʧ')

const VERB_BEFORE = new Set([
  'to', 'will', 'would', 'can', 'could', 'shall', 'should', 'may', 'might', 'must',
  'do', 'does', 'did', "don't", "doesn't", "didn't", "won't", "wouldn't", "can't",
  "couldn't", "shouldn't", "mustn't", "let's", "i'll", "you'll", "we'll", "they'll",
])
const SUBJECT_BEFORE = new Set(['i', 'you', 'we', 'they', 'he', 'she', 'it', 'who'])
const DT_THAT_BEFORE = new Set([
  'and', 'but', 'or', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'about', 'like', 'all',
])
const PARTICIPLE_BEFORE = new Set(['have', 'has', 'had', 'having', "i've", "you've", "we've", "they've"])
const BE_BEFORE = new Set(['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', "i'm", "it's", "he's", "she's"])
/** Titles spaCy keeps whole with their point, as the dictionary spells them. */
const ABBREVIATIONS = new Set(['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Esq.', 'etc.', 'Etc.'])
const NOUN_BEFORE = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'its',
  'our', 'their', 'no', 'every', 'each', 'some', 'any',
])

/** One sub-token. `phonemes` is null until it is read. */
interface Token extends LexiconToken {
  whitespace: string
  phonemes: string | null
  prespace: boolean
}

/** A word: one token, or the sub-tokens written together with no space ("well-known"). */
type Word = Token | Token[]

const makeToken = (text: string, whitespace = ''): Token => ({
  text, whitespace, tag: null, isHead: true, currency: null, phonemes: null, prespace: false,
})

const isPunctuation = (text: string) => /^[^\p{L}\p{N}]+$/u.test(text) && !(text in SYMBOLS)

/** Punctuation as Kokoro reads it: the marks it knows, quotes turned to curly ones. */
function punctuationPhonemes(text: string, opening: boolean, standalone: boolean): string {
  if (standalone && /^[-–]+$/.test(text)) return '—'
  return [...text].map((c) => {
    if (c === '(' || c === '«') return '('
    if (c === ')' || c === '»') return ')'
    if (c === '"') return opening ? '“' : '”'
    return PUNCTS.has(c) ? c : ''
  }).join('')
}

/** The part-of-speech guess described in the header, from the word before. */
function guessTag(text: string, previous: string | null): string | null {
  if (text === 'a' || text === 'an' || text === 'the' || text === 'The' || text === 'An') return 'DT'
  if (text === 'I') return 'PRP'
  if (text === 'in' || text === 'In') return 'IN'
  const before = previous?.toLowerCase().replace(/[‘’]/g, "'") ?? null
  // "used to" is the past habit unless it follows "be" ("was used to make").
  if (text.toLowerCase() === 'used') return before !== null && BE_BEFORE.has(before) ? null : 'VBD'
  // "that" is the pronoun after a preposition or a conjunction ("to that", "and that
  // means"), and the conjunction elsewhere ("said that").
  if (text === 'that' || text === 'That') return before === null || DT_THAT_BEFORE.has(before) ? 'DT' : null
  if (before !== null) {
    if (VERB_BEFORE.has(before)) return 'VB'
    if (PARTICIPLE_BEFORE.has(before)) return 'VBN'
    if (NOUN_BEFORE.has(before)) return 'NN'
    // Fiction is mostly told in the past, so "she read" is "red".
    if (SUBJECT_BEFORE.has(before)) return 'VBD'
  }
  if (/..ed$/.test(text)) return 'VBD'
  if (/...ing$/.test(text)) return 'VBG'
  return null
}

/** Text into words and punctuation, with each word's whitespace after it. */
function tokenize(text: string): Word[] {
  const words: Word[] = []
  let previousWord: string | null = null

  for (const chunk of text.matchAll(/(\S+)(\s*)/g)) {
    const [, body, space] = chunk
    const pieces = ABBREVIATIONS.has(body) ? [body] : (body.match(SUBTOKEN) ?? [body])

    // Joining marks (hyphen, apostrophe, a point) stay inside a word written between
    // two pieces ("well-known", "e.g"), and in an initialism ("U.S."); elsewhere
    // they're punctuation.
    const initialism = /^(?:\p{L}\.)+$/u.test(body)
    const standalone = /^[-–]+$/.test(body)
    const joins = (i: number) => initialism || (
      i > 0 && i < pieces.length - 1 && !isPunctuation(pieces[i - 1]) && !isPunctuation(pieces[i + 1])
    )
    const betweenDigits = (i: number) => /\d$/.test(pieces[i - 1] ?? '') && /^\d/.test(pieces[i + 1] ?? '')
    let group: Token[] = []
    const flush = () => {
      if (group.length) words.push(group.length === 1 ? group[0] : group)
      group = []
    }

    pieces.forEach((piece, i) => {
      const isMark = isPunctuation(piece) && !betweenDigits(i)
        && (standalone || !SUBTOKEN_JUNKS.has(piece) || (!joins(i) && !/^['‘’]+$/.test(piece)))

      if (piece in CURRENCIES) {
        flush()
        const symbol = makeToken(piece)
        symbol.phonemes = ''
        words.push(symbol)
        return
      }
      if (isMark) {
        flush()
        const mark = makeToken(piece)
        mark.phonemes = punctuationPhonemes(piece, i === 0, standalone)
        words.push(mark)
        if (NON_QUOTE_PUNCTS.has(piece[0])) previousWord = null
        return
      }

      const token = makeToken(piece)
      token.isHead = group.length === 0
      token.tag = guessTag(piece, previousWord)
      group.push(token)
    })
    flush()

    const last = words.at(-1)
    const lastToken = Array.isArray(last) ? last.at(-1) : last
    if (lastToken) lastToken.whitespace = space ? ' ' : ''
    const lastPlain = body.replace(/[^\p{L}'’]+$/u, '')
    if (lastPlain) previousWord = lastPlain
  }

  const flat = words.flat()
  flat.forEach((token, i) => {
    // "A" before a lower-case word is the article, as spaCy would tag it.
    if (token.text === 'A' && token.phonemes === null && /^\p{Ll}/u.test(flat[i + 1]?.text ?? '')) token.tag = 'DT'
  })
  assignCurrency(flat)
  return words
}

const isAmount = (text: string) =>
  /^[\d,.]*\d[\d,.]*$/.test(text) || /^(?:hundred|thousand|[mbt]r?illion)s?$/i.test(text)

/**
 * "$1.5 million": the currency goes to the last amount after its symbol, so it reads
 * "one point five million dollars".
 */
function assignCurrency(tokens: Token[]) {
  let currency: string | null = null
  tokens.forEach((token, i) => {
    if (token.text in CURRENCIES && token.phonemes === '') {
      currency = token.text
    } else if (currency !== null) {
      if (!isAmount(token.text)) currency = null
      else if (!isAmount(tokens[i + 1]?.text ?? '')) token.currency = currency
    }
  })
}

const stressWeight = (ps: string | null) =>
  ps ? [...ps].reduce((sum, c) => sum + (DIPHTHONGS.has(c) ? 2 : 1), 0) : 0

/** The context the word before this one sees. */
function nextContext(ctx: TokenContext, ps: string | null, text: string, tag: string | null): TokenContext {
  let futureVowel = ctx.futureVowel
  if (ps) {
    for (const c of ps) {
      if (NON_QUOTE_PUNCTS.has(c)) {
        futureVowel = null
        break
      }
      if (VOWELS.has(c)) {
        futureVowel = true
        break
      }
      if (CONSONANTS.has(c)) {
        futureVowel = false
        break
      }
    }
  }
  const futureTo = text === 'to' || text === 'To' || (text === 'TO' && (tag === 'TO' || tag === 'IN'))
  return { futureVowel, futureTo }
}

/** Sub-tokens written together, as one token for the lexicon. */
function merge(tokens: Token[]): Token {
  const merged = makeToken(tokens.map((t) => t.text).join(''), tokens.at(-1)?.whitespace ?? '')
  merged.isHead = tokens[0].isHead
  merged.tag = tokens[0].tag
  merged.currency = tokens.find((t) => t.currency)?.currency ?? null
  return merged
}

/** How the pieces of a word that was read piece by piece join, and where it is stressed. */
function resolve(tokens: Token[]) {
  const text = tokens.map((t) => t.text).join('')
  const kinds = new Set(
    [...text].filter((c) => !SUBTOKEN_JUNKS.has(c)).map((c) => (/\p{L}/u.test(c) ? 0 : /\d/.test(c) ? 1 : 2))
  )
  const prespace = text.includes(' ') || text.includes('/') || kinds.size > 1
  tokens.forEach((token, i) => {
    if (token.phonemes === null) {
      if (i === tokens.length - 1 && NON_QUOTE_PUNCTS.has(token.text)) token.phonemes = token.text
      else if ([...token.text].every((c) => SUBTOKEN_JUNKS.has(c))) token.phonemes = ''
    } else if (i > 0) {
      token.prespace = prespace
    }
  })
  if (prespace) return

  const indices = tokens
    .map((t, i): [boolean, number, number] => [!!t.phonemes?.includes(PRIMARY_STRESS), stressWeight(t.phonemes), i])
    .filter(([, , i]) => tokens[i].phonemes)
  if (indices.length === 2 && tokens[indices[0][2]].text.length === 1) {
    const i = indices[1][2]
    tokens[i].phonemes = applyStress(tokens[i].phonemes, -0.5)
    return
  }
  if (indices.length < 2 || indices.filter(([primary]) => primary).length <= Math.floor((indices.length + 1) / 2)) return
  const demote = [...indices].sort((a, b) => Number(a[0]) - Number(b[0]) || a[1] - b[1] || a[2] - b[2])
    .slice(0, Math.floor(indices.length / 2))
  for (const [, , i] of demote) tokens[i].phonemes = applyStress(tokens[i].phonemes, -0.5)
}

export interface G2POptions {
  british: boolean
  /** Guess unknown words. Off, they read as nothing; the `g2p` suite turns it off to compare with misaki. */
  fallback?: boolean
}

export interface G2P {
  (text: string): string
}

/** A grapheme-to-phoneme pass over `data`, misaki's gold dictionary for the dialect. */
export function createG2P(data: LexiconData, { british, fallback = true }: G2POptions): G2P {
  const lexicon = new Lexicon(data, british)
  const guessWord = (text: string): string | null => (fallback ? guess(text, british) || null : null)

  return (text: string): string => {
    const words = tokenize(normalizeText(text))
    let ctx: TokenContext = { futureVowel: null, futureTo: false }

    for (let w = words.length - 1; w >= 0; w -= 1) {
      const word = words[w]
      if (!Array.isArray(word)) {
        if (word.phonemes === null) word.phonemes = lexicon.read(word, ctx)[0]
        if (word.phonemes === null) word.phonemes = guessWord(word.text)
        ctx = nextContext(ctx, word.phonemes, word.text, word.tag)
        continue
      }

      // Try the longest run of pieces that the lexicon knows, from the right.
      let left = 0
      let right = word.length
      let shouldFallback = false
      while (left < right) {
        const span = word.slice(left, right)
        const ps = span.some((t) => t.phonemes !== null) ? null : lexicon.read(merge(span), ctx)[0]
        if (ps !== null) {
          word[left].phonemes = ps
          for (const t of word.slice(left + 1, right)) t.phonemes = ''
          ctx = nextContext(ctx, ps, merge(span).text, word[left].tag)
          right = left
          left = 0
        } else if (left + 1 < right) {
          left += 1
        } else {
          right -= 1
          const token = word[right]
          if (token.phonemes === null) {
            // A mark inside a word ("3:2") is silent, rather than sending it all to the fallback.
            if (isPunctuation(token.text)) {
              token.phonemes = ''
            } else {
              shouldFallback = true
              break
            }
          }
          left = 0
        }
      }

      if (shouldFallback) {
        word[0].phonemes = guessWord(merge(word).text)
        for (const t of word.slice(1)) t.phonemes = ''
      } else {
        resolve(word)
      }
    }

    const spoken = words.map((word) => {
      const tokens = Array.isArray(word) ? word : [word]
      let ps = ''
      for (const t of tokens) {
        if (t.prespace && ps && !/\s$/.test(ps) && t.phonemes) ps += ' '
        ps += t.phonemes ?? ''
      }
      return ps + (tokens.at(-1)?.whitespace ?? '')
    }).join('')

    // Kokoro v1.0 was trained on misaki's original symbols for the flap and glottal stop.
    return spoken.replaceAll('ɾ', 'T').replaceAll('ʔ', 't').replace(/ {2,}/g, ' ').trim()
  }
}
