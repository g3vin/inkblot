/**
 * bubbleText.ts — what a bubble session does to a sentence, without any UI.
 *
 * A sentence comes apart into bubbles (one per word, per clause, or — to reorder a
 * paragraph — per sentence), the bubbles are
 * rearranged, joined and thrown aside, and the sentence that goes back into the document
 * is the bubbles still in it, put back together.
 *
 * **Punctuation is its own bubble.** "door." is two tokens, "door" and ".", so a period
 * can be moved on its own. Putting the sentence back together is therefore not a join on
 * spaces: a comma hugs the word before it, an opening quote the word after it
 * (`joinTokens`). Apostrophes and hyphens inside a word stay in it, as does the period of
 * an abbreviation ("Mr.", "U.S.").
 *
 * **Capitalization is ignored in bubble mode.** A word that is capitalized only because
 * it begins a sentence loses the capital in its bubble ("She" is "she"), and the sentence
 * written back gets capitals wherever a sentence now begins. Capitals that mean something
 * else — "I", "NASA", "McDonald" — are kept. A name at the start of a sentence is the case
 * this gets wrong: nothing here knows "Paris" is a name.
 *
 * `native/…/Bubble/BubbleText.swift` is a port of this file for the Swift shell's editor.
 * Change one and change the other; `BubbleTextTests.swift` and the `bubble` suite hold
 * the same cases.
 */
import { BubbleMode } from '../types'
import type { BubbleAside, BubbleForm, BubbleSession, BubbleWord } from '../types'

let counter = 0
/** Unique within a page; sessions also carry a random part so two windows cannot collide. */
export const newBubbleId = (prefix = 'w'): string => {
  counter += 1
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}${random}`
}

/** The chunks of some text between whitespace. */
export const splitWords = (text: string): string[] =>
  String(text ?? '').split(/\s+/).filter(Boolean)

/* ---------------- tokens ---------------- */

/** Punctuation that comes off either end of a word. Straight and curly single quotes are
 * handled apart: they are apostrophes as often as quotes. */
const PEELED = new Set([...'.,;:!?"“”()[]{}…—–'])
/** Runs of these stay one token: "...", "?!". */
const GROUPED = new Set(['.', '!', '?'])
const OPENING = new Set(['(', '[', '{', '“', '‘'])
const CLOSING = new Set([')', ']', '}', '”', '’'])
const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'prof', 'vs', 'etc', 'no', 'mt'])

/** Whether a bubble is punctuation only — drawn as a small round bubble. */
export const isPunctuation = (text: string): boolean => !!text && !/[\p{L}\p{N}]/u.test(text)

const groupRun = (chars: string[]): string[] => {
  const out: string[] = []
  for (const char of chars) {
    const last = out[out.length - 1]
    if (last && GROUPED.has(char) && [...last].every((c) => GROUPED.has(c))) out[out.length - 1] = last + char
    else out.push(char)
  }
  return out
}

/** Words and punctuation, in order. */
export const tokenize = (text: string): string[] => {
  const tokens: string[] = []
  // A single quote opened earlier: a trailing ' or ’ closes it rather than being a
  // possessive apostrophe.
  let singleOpen = false
  for (const chunk of splitWords(text)) {
    const chars = [...chunk]
    let start = 0
    let end = chars.length
    const lead: string[] = []
    const trail: string[] = []
    while (start < end && (PEELED.has(chars[start]) || chars[start] === "'" || chars[start] === '‘')) {
      if (chars[start] === "'" || chars[start] === '‘') singleOpen = true
      lead.push(chars[start])
      start += 1
    }
    while (end > start) {
      const char = chars[end - 1]
      const quote = char === "'" || char === '’'
      if (!(PEELED.has(char) || (quote && singleOpen))) break
      // A single final period that belongs to an abbreviation ("Mr.", "U.S.") stays on it.
      if (char === '.' && !trail.length && chars[end - 2] !== '.') {
        const core = chars.slice(start, end - 1).join('')
        if (core.includes('.') || ABBREVIATIONS.has(core.toLowerCase())) break
      }
      if (quote) singleOpen = false
      trail.unshift(char)
      end -= 1
    }
    tokens.push(...groupRun(lead))
    if (start < end) tokens.push(chars.slice(start, end).join(''))
    tokens.push(...groupRun(trail))
  }
  return tokens
}

type Role = 'word' | 'open' | 'close' | 'tight' | 'neutral'

/** What each token does to the spaces around it. Straight quotes alternate open, close. */
const tokenRoles = (tokens: string[]): Role[] => {
  let doubleOpen = false
  let singleOpen = false
  return tokens.map((token, index): Role => {
    if (!isPunctuation(token)) return 'word'
    if (token === '"' || token === "'") {
      const open = token === '"' ? doubleOpen : singleOpen
      // A quote with nothing after it closes, whatever the count says.
      const closes = open || (index === tokens.length - 1 && index > 0)
      if (token === '"') doubleOpen = !closes
      else singleOpen = !closes
      return closes ? 'close' : 'open'
    }
    if (OPENING.has(token)) return 'open'
    if (CLOSING.has(token)) return 'close'
    if (/^[.,;:!?…]/.test(token)) return 'tight'
    return 'neutral'
  })
}

/**
 * Which word tokens begin a sentence: the first (if the text begins one), and the first
 * after a . ! or ?. A ! or ? closed by a quote is dialogue — `"Stop!" she said` — and
 * does not end the sentence.
 */
const sentenceStarts = (tokens: string[], roles: Role[], startsSentence: boolean): Set<number> => {
  const starts = new Set<number>()
  let next = startsSentence
  let lastTerminal = ''
  tokens.forEach((token, index) => {
    const role = roles[index]
    if (role === 'word') {
      if (next) starts.add(index)
      next = false
      lastTerminal = ''
    } else if (/^[.!?]+$/.test(token)) {
      next = true
      lastTerminal = token
    } else if (role === 'close' && lastTerminal && /[!?]$/.test(lastTerminal)) {
      next = false
    }
  })
  return starts
}

const capitalize = (word: string): string => word.charAt(0).toLocaleUpperCase() + word.slice(1)

/** A sentence-start capital taken off — unless the word is capitalized for another reason. */
const decapitalize = (word: string): string => {
  if (/^I(['’].*)?$/.test(word)) return word
  const rest = word.slice(1)
  if (rest !== rest.toLocaleLowerCase()) return word
  return word.charAt(0).toLocaleLowerCase() + rest
}

/** Whether the text begins with a capital — which says whether it begins a sentence. */
export const startsCapitalized = (text: string): boolean => {
  const first = [...String(text ?? '')].find((char) => /[\p{L}]/u.test(char))
  return !!first && first !== first.toLocaleLowerCase()
}

/**
 * Tokens put back together: a space between two words, none before a comma or a closing
 * quote, none after an opening one. `startsSentence` capitalizes each sentence's first
 * word; without it the words are left as they are.
 */
export const joinTokens = (tokens: string[], { startsSentence = null }: { startsSentence?: boolean | null } = {}): string => {
  const roles = tokenRoles(tokens)
  const starts = startsSentence === null ? new Set<number>() : sentenceStarts(tokens, roles, startsSentence)
  let out = ''
  tokens.forEach((token, index) => {
    const role = roles[index]
    const previous = roles[index - 1]
    if (out && role !== 'close' && role !== 'tight' && previous !== 'open') out += ' '
    out += starts.has(index) ? capitalize(token) : token
  })
  return out
}

/* ---------------- clauses ---------------- */

/**
 * Words that usually begin a new clause. Deliberately short: "and", "or" and "that" are
 * left out because they join nouns ("salt and pepper", "that door") as often as they
 * join clauses, and a comma before them already splits the clause.
 */
const CLAUSE_OPENERS = new Set([
  'but', 'because', 'although', 'though', 'while', 'whereas', 'when', 'whenever',
  'where', 'wherever', 'unless', 'until', 'since', 'which', 'who', 'whom', 'whose', 'if',
])
const CLAUSE_END = new Set([',', ';', ':', '—', '–'])

/**
 * Tokens grouped into sentences. A sentence begins at each word that `sentenceStarts`
 * says begins one, and takes with it the opening quotes or brackets just before it.
 */
const groupSentences = (tokens: string[]): string[][] => {
  const roles = tokenRoles(tokens)
  const starts = sentenceStarts(tokens, roles, true)
  const sentences: string[][] = []
  let begin = 0
  let sawWord = false
  tokens.forEach((_, index) => {
    if (starts.has(index) && sawWord) {
      // The opening marks just before this word belong to its sentence.
      let end = index
      while (end > begin && roles[end - 1] === 'open') end -= 1
      sentences.push(tokens.slice(begin, end))
      begin = end
    }
    if (roles[index] === 'word') sawWord = true
  })
  if (begin < tokens.length) sentences.push(tokens.slice(begin))
  return sentences
}

/**
 * Tokens grouped into clauses, within sentences: a break at each sentence's end, after a
 * comma, semicolon, colon or dash, and before a subordinating word once the clause so
 * far has two words in it. The punctuation at either end of a clause is a group of its
 * own — each mark its own bubble — so a comma or a closing quote can be moved apart from
 * the words. A heuristic, not a parse — the writer can join or split what it gets wrong.
 */
const groupClauses = (tokens: string[]): string[][] => {
  const roles = tokenRoles(tokens)
  const clauses: string[][] = []
  let offset = 0
  for (const sentence of groupSentences(tokens)) {
    let current: string[] = []
    let words = 0
    const flush = () => {
      if (current.length) clauses.push(current)
      current = []
      words = 0
    }
    sentence.forEach((token, at) => {
      const role = roles[offset + at]
      if (role === 'close' && !current.length && clauses.length) {
        clauses[clauses.length - 1].push(token)
        return
      }
      if (role === 'word' && words >= 2 && CLAUSE_OPENERS.has(token.toLowerCase())) flush()
      current.push(token)
      if (role === 'word') words += 1
      if (CLAUSE_END.has(token)) flush()
    })
    flush()
    offset += sentence.length
  }
  return clauses.flatMap(detachPunctuation)
}

/** A clause with the marks at either end split off, one group each. */
const detachPunctuation = (clause: string[]): string[][] => {
  let start = 0
  let end = clause.length
  while (start < end && isPunctuation(clause[start])) start += 1
  while (end > start && isPunctuation(clause[end - 1])) end -= 1
  if (start === end) return clause.map((token) => [token])
  return [
    ...clause.slice(0, start).map((token) => [token]),
    clause.slice(start, end),
    ...clause.slice(end).map((token) => [token]),
  ]
}

/** The text grouped into clauses. */
export const splitClauses = (text: string): string[] => groupClauses(tokenize(text)).map((clause) => joinTokens(clause))

/** The text grouped into sentences. */
export const splitSentences = (text: string): string[] =>
  groupSentences(tokenize(text)).map((sentence) => joinTokens(sentence))

/* ---------------- sessions ---------------- */

const toWords = (texts: string[]): BubbleWord[] => texts.map((text) => ({ id: newBubbleId(), text }))

/** Every token of every bubble, in order. */
const tokensOf = (words: BubbleWord[]): string[] => words.flatMap((word) => tokenize(word.text))

/**
 * The sentence a session writes back, capitalized where sentences now begin. Whether the
 * first word gets a capital follows the sentence the session began from: a fragment from
 * mid-sentence stays lowercase.
 */
export const composeSentence = (words: BubbleWord[], original = ''): string =>
  joinTokens(tokensOf(words), { startsSentence: startsCapitalized(original) })

/**
 * What each bubble of the sentence shows: its text, with a capital on the word that now
 * begins a sentence. The bubbles store words without sentence-start capitals, so moving
 * a word to the front capitalizes it and the word it displaced loses its capital.
 */
export const displayTexts = (words: BubbleWord[], original = ''): string[] => {
  const perBubble = words.map((word) => tokenize(word.text))
  const tokens = perBubble.flat()
  const starts = sentenceStarts(tokens, tokenRoles(tokens), startsCapitalized(original))
  let offset = 0
  return words.map((word, index) => {
    const own = perBubble[index]
    const first = offset
    offset += own.length
    if (!own.some((_, at) => starts.has(first + at))) return word.text
    return joinTokens(own.map((token, at) => (starts.has(first + at) ? capitalize(token) : token)))
  })
}

/** The bubbles for some text: one per token, sentence-start capitals taken off. */
export const sentenceTokens = (text: string): string[] => {
  const tokens = tokenize(text)
  const starts = sentenceStarts(tokens, tokenRoles(tokens), true)
  return tokens.map((token, index) => (starts.has(index) ? decapitalize(token) : token))
}

/** Tokens as bubbles, grouped by mode. */
const grouped = (tokens: string[], mode: BubbleMode): string[] => {
  if (mode === BubbleMode.Sentences) return groupSentences(tokens).map((group) => joinTokens(group))
  if (mode === BubbleMode.Clauses) return groupClauses(tokens).map((group) => joinTokens(group))
  return tokens
}

export const createSession = (text: string, mode: BubbleMode = BubbleMode.Words): BubbleSession => ({
  id: newBubbleId('bubble'),
  words: toWords(grouped(sentenceTokens(text), mode)),
  aside: [],
  original: splitWords(text).join(' '),
  ...(mode === BubbleMode.Words ? {} : { mode }),
})

/**
 * A session read back off its mark, made to agree with the document. If the sentence
 * was edited in the document since the session was closed, the document wins: the
 * sentence is split afresh, and only the set-aside bubbles are kept.
 */
export const reconcileSession = (session: BubbleSession, documentText: string): BubbleSession => {
  const aside = Array.isArray(session.aside) ? session.aside : []
  const words = Array.isArray(session.words) ? session.words : []
  if (composeSentence(words, session.original) === joinTokens(tokenize(documentText))) {
    return { ...session, words, aside }
  }
  // The sentence as the document has it is the unsaved arrangement now, in place of any
  // that was kept.
  const { unsaved: _kept, ...rest } = session
  return { ...rest, words: toWords(grouped(sentenceTokens(documentText), session.mode ?? BubbleMode.Words)), aside }
}

/* ---------------- edits: each returns a new list ---------------- */

/** Every bubble in the sentence, split into one bubble per word and punctuation mark. */
export const regroupWords = (words: BubbleWord[]): BubbleWord[] =>
  words.flatMap((word) => {
    const parts = tokenize(word.text)
    return parts.length <= 1 ? [word] : toWords(parts)
  })

/** The sentence regrouped into clauses. */
export const regroupClauses = (words: BubbleWord[]): BubbleWord[] =>
  toWords(grouped(tokensOf(words), BubbleMode.Clauses))

/** The bubbles regrouped for a mode. */
export const regroup = (words: BubbleWord[], mode: BubbleMode): BubbleWord[] => (
  mode === BubbleMode.Words ? regroupWords(words) : toWords(grouped(tokensOf(words), mode))
)

/** One bubble split into its words, in place. */
export const splitBubble = (words: BubbleWord[], id: string): BubbleWord[] =>
  words.flatMap((word) => {
    if (word.id !== id) return [word]
    const parts = tokenize(word.text)
    return parts.length <= 1 ? [word] : toWords(parts)
  })

/**
 * One level finer: a bubble of several sentences comes apart into sentences, a sentence
 * into clauses, a clause into words. What spreading two fingers over a bubble does.
 */
export const splitOnce = (text: string): string[] => {
  const sentences = splitSentences(text)
  if (sentences.length > 1) return sentences
  const clauses = splitClauses(text)
  return clauses.length > 1 ? clauses : tokenize(text)
}

/** One bubble split one level finer (`splitOnce`), in place. */
export const splitBubbleOnce = (words: BubbleWord[], id: string): BubbleWord[] =>
  words.flatMap((word) => {
    if (word.id !== id) return [word]
    const parts = splitOnce(word.text)
    return parts.length <= 1 ? [word] : toWords(parts)
  })

/** The bubbles at `index` and `index + 1` as one, keeping the first one's id. */
export const mergeAdjacent = (words: BubbleWord[], index: number): BubbleWord[] => {
  if (index < 0 || index + 1 >= words.length) return words
  const merged = { ...words[index], text: joinText(words[index].text, words[index + 1].text) }
  return [...words.slice(0, index), merged, ...words.slice(index + 2)]
}

/** Two bubbles' text as one, `first` before `second`: a space between words, none before a comma. */
export const joinText = (first: string, second: string): string =>
  joinTokens([...tokenize(first), ...tokenize(second)])

/** Move `from` to sit at `index` of the list as it is *without* it. */
export const moveTo = <T>(list: T[], fromIndex: number, index: number): T[] => {
  if (fromIndex < 0 || fromIndex >= list.length) return list
  const next = list.slice()
  const [item] = next.splice(fromIndex, 1)
  next.splice(Math.max(0, Math.min(index, next.length)), 0, item)
  return next
}

/** Keep a set-aside bubble's centre inside the editor's area. */
export const clampAside = (aside: BubbleAside): BubbleAside => ({
  ...aside,
  x: Math.max(0, Math.min(1, Number(aside.x) || 0)),
  y: Math.max(0, Math.min(1, Number(aside.y) || 0)),
})

const normalizeWords = (words: BubbleWord[] | undefined): BubbleWord[] => (words || [])
  .filter((word) => word?.text?.trim())
  .map((word) => ({ id: String(word.id), text: word.text.trim() }))

const normalizeAside = (aside: BubbleAside[] | undefined): BubbleAside[] => (aside || [])
  .filter((word) => word?.text?.trim())
  .map((word) => clampAside({ id: String(word.id), text: word.text.trim(), x: word.x, y: word.y }))

/** A session as it is safe to store: plain values only, and no empty bubbles. */
export const normalizeSession = (session: BubbleSession): BubbleSession => {
  const normalizeForm = (form: BubbleForm) => ({
    id: String(form.id),
    words: normalizeWords(form.words),
    aside: normalizeAside(form.aside),
    ...(form.mode && form.mode !== BubbleMode.Words ? { mode: form.mode } : {}),
  })
  const forms = (Array.isArray(session.forms) ? session.forms : []).map(normalizeForm)
  return {
    id: String(session.id),
    words: normalizeWords(session.words),
    aside: normalizeAside(session.aside),
    original: String(session.original ?? ''),
    ...(session.mode && session.mode !== BubbleMode.Words ? { mode: session.mode } : {}),
    ...(forms.length ? { forms } : {}),
    ...(session.unsaved ? { unsaved: normalizeForm(session.unsaved) } : {}),
  }
}
