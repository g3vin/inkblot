/**
 * nameContext.ts — is this capitalised word a name here? For the one case case-sensitive
 * matching can't settle: a story entry whose name is also an ordinary word ("Will",
 * "Rose", "Hope"), at the start of a sentence, where every word is capitalised.
 * "Will walked in." is Will; "Will you come?" is not.
 *
 * Read on the device, with compromise (the part-of-speech tagger the Workbench already
 * uses): the word is a name when the tagger says person; it is not when the tagger
 * says verb, modal, adjective and the like, or when a noun follows it ("Rose petals").
 * A noun followed by a verb ("Rose smiled") is the subject of the sentence, and in
 * fiction a capitalised subject is nearly always someone; so is a possessive ("Rose's
 * coat"), and a "modal" before a verb no modal takes ("Will follows her"). Anything
 * else stays a name: a tag too many is cheaper than one missing.
 *
 * compromise is loaded on first need, not with the editor. Until it is, an ambiguous
 * word is left untagged (`isNameHere` answers null) and `onNameContextReady` says when
 * to look again.
 */

type Nlp = typeof import('compromise').default

let nlp: Nlp | null = null
let loading: Promise<void> | null = null
const readyListeners = new Set<() => void>()

/** Load the tagger now (tests, and a page that knows it will need it). */
export function loadNameContext(): Promise<void> {
  if (!loading) {
    loading = import('compromise').then((module) => {
      nlp = module.default
      readyListeners.forEach((listener) => listener())
    })
  }
  return loading
}

export const isNameContextReady = (): boolean => nlp !== null

/** Hear when the tagger has loaded, to look again at what was left untagged. */
export function onNameContextReady(listener: () => void): () => void {
  readyListeners.add(listener)
  return () => { readyListeners.delete(listener) }
}

/* ---------------- the cheap questions first ---------------- */

/** Opening punctuation that can stand between a sentence's start and its first word. */
const OPENERS = /[\s"'“‘«([—–-]+$/u

/** Does the word at `from` begin a sentence (or the text)? */
export function startsSentence(text: string, from: number): boolean {
  const before = text.slice(0, from).replace(OPENERS, '')
  return before === '' || /[.!?…:;]$/u.test(before)
}

/** Only single words: no ordinary phrase is also someone's full name. */
const isSingleWord = (name: string) => !/\s/u.test(name)

const lexiconCache = new Map<string, boolean>()

/** Does compromise know `name` as a word (in any sense)? Unknown names are never doubted. */
function isKnownWord(name: string): boolean {
  if (!nlp) return false
  const word = name.toLowerCase()
  let known = lexiconCache.get(word)
  if (known === undefined) {
    const lexicon = (nlp.model() as { one?: { lexicon?: Record<string, unknown> } }).one?.lexicon || {}
    known = Object.prototype.hasOwnProperty.call(lexicon, word)
    lexiconCache.set(word, known)
  }
  return known
}

/* ---------------- reading the sentence ---------------- */

const NAME_TAGS = ['Person', 'ProperNoun', 'Place']
const NOT_NAME_TAGS = ['Verb', 'Modal', 'Auxiliary', 'Adjective', 'Adverb', 'Preposition', 'Conjunction', 'Determiner', 'Pronoun', 'QuestionWord']

const has = (tags: string[], wanted: string[]) => wanted.some((tag) => tags.includes(tag))

const verdicts = new Map<string, boolean>()
const MAX_VERDICTS = 2000

/** The sentence that starts at `from`, up to its end or a little way in. */
function sentenceFrom(text: string, from: number): string {
  const rest = text.slice(from, from + 160)
  const end = rest.search(/[.!?…](\s|$)/u)
  return end === -1 ? rest : rest.slice(0, end + 1)
}

function judge(sentence: string): boolean {
  const terms = (nlp as Nlp)(sentence).terms().json() as { terms: { tags: string[] }[] }[]
  const first = terms[0]?.terms[0]?.tags || []
  const next = terms[1]?.terms[0]?.tags || []
  // "Rose's coat": a capitalised possessive opening a sentence is someone's.
  if (has(first, NAME_TAGS) || first.includes('Possessive')) return true
  // A modal takes a bare verb ("Will go"); before "follows", "opened" or "was" it is
  // the sentence's subject: "May opened the box."
  if (first.includes('Modal') && next.includes('Verb') && (next.includes('PastTense') || (next.includes('PresentTense') && !next.includes('Infinitive')))) return true
  if (has(first, NOT_NAME_TAGS)) return false
  if (first.includes('Noun') && next.includes('Noun') && !has(next, NAME_TAGS)) return false
  if (first.includes('Noun') && has(next, ['Adjective', 'Possessive'])) return false
  return true
}

/**
 * Is the match `name` at `from` in `text` a name? true or false, or null while the
 * tagger is still loading (and it is asked to load).
 */
export function isNameHere(text: string, from: number, name: string): boolean | null {
  if (!isSingleWord(name) || !startsSentence(text, from)) return true
  if (!nlp) {
    void loadNameContext()
    return null
  }
  if (!isKnownWord(name)) return true
  const sentence = sentenceFrom(text, from)
  let verdict = verdicts.get(sentence)
  if (verdict === undefined) {
    verdict = judge(sentence)
    if (verdicts.size >= MAX_VERDICTS) verdicts.clear()
    verdicts.set(sentence, verdict)
  }
  return verdict
}
