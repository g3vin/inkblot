/**
 * misaki's English lexicon: a word, in context, to Kokoro's phonemes.
 *
 * A port of `Lexicon` in misaki's `en.py` (hexgrad/misaki, Apache-2.0), the
 * grapheme-to-phoneme pass Kokoro was trained with. It looks a word up in the gold
 * dictionary, and failing that tries it as a plural, a past tense or an "-ing" form
 * of one it knows, as a spelled-out initialism, or as a number. Misses return null
 * for `g2p.ts` to hand to the fallback.
 *
 * The control flow follows the Python closely so the `g2p` suite can check the two
 * against each other. Where misaki asks spaCy for a part-of-speech tag, this takes
 * the coarse guess `g2p.ts` makes instead.
 */
import { cardinal, decimal, ordinal, year } from './numbers'

/** A dictionary value: one pronunciation, or one per part of speech plus `DEFAULT`. */
export type LexiconEntry = string | Record<string, string | null>
export type LexiconData = Record<string, LexiconEntry>

/** What `g2p.ts` knows about the words after this one, read right to left. */
export interface TokenContext {
  /** Whether the next sound is a vowel; null at the end of a clause. */
  futureVowel: boolean | null
  /** Whether the next word is "to" ("used to"). */
  futureTo: boolean
}

export interface LexiconToken {
  text: string
  tag: string | null
  /** The first sub-token of a word, as opposed to a piece after a hyphen or digit. */
  isHead: boolean
  /** A currency symbol read before this number ("$5"), or null. */
  currency: string | null
}

/** A pronunciation and how much to trust it: 4 dictionary, 3 derived, 1 guessed. */
export type Lookup = [string, number] | [null, null]
const MISS: Lookup = [null, null]

export const PRIMARY_STRESS = 'ˈ'
export const SECONDARY_STRESS = 'ˌ'
const STRESSES = SECONDARY_STRESS + PRIMARY_STRESS
export const VOWELS = new Set('AIOQWYaiuæɑɒɔəɛɜɪʊʌᵻ')
export const CONSONANTS = new Set('bdfhjklmnpstvwzðŋɡɹɾʃʒʤʧθ')
const US_TAUS = new Set('AIOWYiuæɑəɛɪɹʊʌ')

export const CURRENCIES: Record<string, [string, string]> = {
  $: ['dollar', 'cent'],
  '£': ['pound', 'pence'],
  '€': ['euro', 'cent'],
}
const ORDINALS = new Set(['st', 'nd', 'rd', 'th'])
const ADD_SYMBOLS: Record<string, string> = { '.': 'dot', '/': 'slash' }
export const SYMBOLS: Record<string, string> = { '%': 'percent', '&': 'and', '+': 'plus', '@': 'at' }

/** Apostrophe, hyphen and the ASCII letters: the characters a dictionary key uses. */
const isLexiconText = (word: string): boolean => /^['A-Za-z-]*$/.test(word)
/** Python's `str.isalpha()`, for the strings that reach it. */
const isAlpha = (word: string): boolean => /^\p{L}+$/u.test(word)
const isDigit = (text: string): boolean => /^[0-9]+$/.test(text)
const lower = (s: string) => s.toLowerCase()
const upper = (s: string) => s.toUpperCase()
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

/**
 * Move, add or remove stress marks. `stress` is misaki's scale: below -1 strips them,
 * -1 demotes primary to secondary, 0–1 adds secondary to an unstressed word, above 1
 * adds primary.
 */
export function applyStress(ps: string | null, stress: number | null): string | null {
  if (ps === null || stress === null) return ps
  const hasStress = [...STRESSES].some((s) => ps.includes(s))
  const hasVowel = [...ps].some((c) => VOWELS.has(c))

  // A stress mark sits immediately before the vowel it stresses.
  const restress = (marked: string): string => {
    const chars = [...marked]
    const placed = chars.map((c, i): [number, string] => {
      if (!STRESSES.includes(c)) return [i, c]
      const vowel = chars.findIndex((v, j) => j >= i && VOWELS.has(v))
      return [vowel < 0 ? i : vowel - 0.5, c]
    })
    return placed
      .sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]))
      .map(([, c]) => c)
      .join('')
  }

  if (stress < -1) return ps.replaceAll(PRIMARY_STRESS, '').replaceAll(SECONDARY_STRESS, '')
  if (stress === -1 || ((stress === 0 || stress === -0.5) && ps.includes(PRIMARY_STRESS))) {
    return ps.replaceAll(SECONDARY_STRESS, '').replaceAll(PRIMARY_STRESS, SECONDARY_STRESS)
  }
  if ((stress === 0 || stress === 0.5 || stress === 1) && !hasStress) {
    return hasVowel ? restress(SECONDARY_STRESS + ps) : ps
  }
  if (stress >= 1 && !ps.includes(PRIMARY_STRESS) && ps.includes(SECONDARY_STRESS)) {
    return ps.replaceAll(SECONDARY_STRESS, PRIMARY_STRESS)
  }
  if (stress > 1 && !hasStress) return hasVowel ? restress(PRIMARY_STRESS + ps) : ps
  return ps
}

const parentTag = (tag: string | null): string | null => {
  if (tag === null) return null
  if (tag.startsWith('VB')) return 'VERB'
  if (tag.startsWith('NN')) return 'NOUN'
  if (tag.startsWith('ADV') || tag.startsWith('RB')) return 'ADV'
  if (tag.startsWith('ADJ') || tag.startsWith('JJ')) return 'ADJ'
  return tag
}

/**
 * The dictionary with each lower-case key also under its capitalized form, and each
 * capitalized key under its lower-case form, so "Rose" and "rose" both resolve. A key
 * already in the data keeps its own value.
 */
function growDictionary(data: LexiconData): Map<string, LexiconEntry> {
  const grown = new Map<string, LexiconEntry>()
  for (const [key, value] of Object.entries(data)) {
    if (key.length < 2) continue
    if (key === lower(key)) {
      if (key !== capitalize(key)) grown.set(capitalize(key), value)
    } else if (key === capitalize(lower(key))) {
      grown.set(lower(key), value)
    }
  }
  for (const [key, value] of Object.entries(data)) grown.set(key, value)
  return grown
}

export class Lexicon {
  readonly british: boolean
  private readonly golds: Map<string, LexiconEntry>

  constructor(data: LexiconData, british: boolean) {
    this.british = british
    this.golds = growDictionary(data)
  }

  private gold(word: string): LexiconEntry | undefined {
    return this.golds.get(word)
  }

  private goldString(word: string): string {
    const entry = this.gold(word)
    if (typeof entry === 'string') return entry
    return entry?.DEFAULT ?? ''
  }

  /** An initialism read letter by letter, with the stress on the last letter. */
  getNNP(word: string): Lookup {
    const letters = [...word].filter((c) => isAlpha(c)).map((c) => this.gold(upper(c)))
    if (letters.some((ps) => typeof ps !== 'string')) return MISS
    const ps = applyStress((letters as string[]).join(''), 0) ?? ''
    const at = ps.lastIndexOf(SECONDARY_STRESS)
    return [at < 0 ? ps : ps.slice(0, at) + PRIMARY_STRESS + ps.slice(at + 1), 3]
  }

  /** The handful of short words whose reading depends on what follows them. */
  private specialCase(word: string, tag: string | null, stress: number | null, ctx: TokenContext | null): Lookup {
    if (tag === 'ADD' && word in ADD_SYMBOLS) return this.lookup(ADD_SYMBOLS[word], null, -0.5, ctx)
    if (word in SYMBOLS) return this.lookup(SYMBOLS[word], null, null, ctx)
    const pieces = word.split('.')
    if (
      word.replace(/^\.+|\.+$/g, '').includes('.')
      && isAlpha(word.replaceAll('.', ''))
      && Math.max(...pieces.map((p) => p.length)) < 3
    ) {
      return this.getNNP(word)
    }
    if (word === 'a' || word === 'A') return [tag === 'DT' ? 'ɐ' : 'ˈA', 4]
    if (word === 'am' || word === 'Am' || word === 'AM') {
      if (tag?.startsWith('NN')) return this.getNNP(word)
      if (ctx?.futureVowel == null || word !== 'am' || (stress !== null && stress > 0)) {
        return [this.goldString('am'), 4]
      }
      return ['ɐm', 4]
    }
    if (word === 'an' || word === 'An' || word === 'AN') {
      if (word === 'AN' && tag?.startsWith('NN')) return this.getNNP(word)
      return ['ɐn', 4]
    }
    if (word === 'I' && tag === 'PRP') return [`${SECONDARY_STRESS}I`, 4]
    if ((word === 'by' || word === 'By' || word === 'BY') && parentTag(tag) === 'ADV') return ['bˈI', 4]
    if (word === 'to' || word === 'To' || (word === 'TO' && (tag === 'TO' || tag === 'IN'))) {
      const vowel = ctx?.futureVowel ?? null
      return [vowel === null ? this.goldString('to') : vowel ? 'tʊ' : 'tə', 4]
    }
    if (word === 'in' || word === 'In' || (word === 'IN' && tag !== 'NNP')) {
      return [(ctx?.futureVowel == null || tag !== 'IN' ? PRIMARY_STRESS : '') + 'ɪn', 4]
    }
    if (word === 'the' || word === 'The' || (word === 'THE' && tag === 'DT')) {
      return [ctx?.futureVowel === true ? 'ði' : 'ðə', 4]
    }
    if (tag === 'IN' && /^vs\.?$/i.test(word)) return this.lookup('versus', null, null, ctx)
    if (word === 'used' || word === 'Used' || word === 'USED') {
      const used = this.gold('used') as Record<string, string>
      return [(tag === 'VBD' || tag === 'JJ') && ctx?.futureTo ? used.VBD : used.DEFAULT, 4]
    }
    return MISS
  }

  isKnown(word: string): boolean {
    if (this.golds.has(word) || word in SYMBOLS) return true
    if (!isAlpha(word) || !isLexiconText(word)) return false
    if (word.length === 1) return true
    if (word === upper(word) && this.golds.has(lower(word))) return true
    return word.slice(1) === upper(word.slice(1))
  }

  lookup(word: string, tag: string | null, stress: number | null, ctx: TokenContext | null): Lookup {
    let isNNP = false
    if (word === upper(word) && !this.golds.has(word)) {
      word = lower(word)
      isNNP = tag === 'NNP'
    }
    let entry: LexiconEntry | null | undefined = this.gold(word)
    if (entry !== undefined && typeof entry !== 'string') {
      let key = tag
      if (ctx && ctx.futureVowel === null && 'None' in entry) key = 'None'
      else if (key === null || !(key in entry)) key = parentTag(tag)
      entry = key !== null && key in entry ? entry[key] : entry.DEFAULT
    }
    const ps = typeof entry === 'string' ? entry : null
    if (ps === null || (isNNP && !ps.includes(PRIMARY_STRESS))) {
      const nnp = this.getNNP(word)
      return nnp[0] !== null ? nnp : MISS
    }
    return [applyStress(ps, stress) as string, 4]
  }

  private suffixS(stem: string | null): string | null {
    if (!stem) return null
    const last = stem.at(-1) as string
    if ('ptkfθ'.includes(last)) return `${stem}s`
    if ('szʃʒʧʤ'.includes(last)) return `${stem}${this.british ? 'ɪ' : 'ᵻ'}z`
    return `${stem}z`
  }

  stemS(word: string, tag: string | null, stress: number | null, ctx: TokenContext | null): Lookup {
    if (word.length < 3 || !word.endsWith('s')) return MISS
    let stem: string
    if (!word.endsWith('ss') && this.isKnown(word.slice(0, -1))) stem = word.slice(0, -1)
    else if (
      (word.endsWith("'s") || (word.length > 4 && word.endsWith('es') && !word.endsWith('ies')))
      && this.isKnown(word.slice(0, -2))
    ) stem = word.slice(0, -2)
    else if (word.length > 4 && word.endsWith('ies') && this.isKnown(`${word.slice(0, -3)}y`)) {
      stem = `${word.slice(0, -3)}y`
    } else return MISS
    const [ps, rating] = this.lookup(stem, tag, stress, ctx)
    const out = this.suffixS(ps)
    return out === null ? MISS : [out, rating as number]
  }

  private suffixEd(stem: string | null): string | null {
    if (!stem) return null
    const last = stem.at(-1) as string
    if ('pkfθʃsʧ'.includes(last)) return `${stem}t`
    if (last === 'd') return `${stem}${this.british ? 'ɪ' : 'ᵻ'}d`
    if (last !== 't') return `${stem}d`
    if (this.british || stem.length < 2) return `${stem}ɪd`
    if (US_TAUS.has(stem.at(-2) as string)) return `${stem.slice(0, -1)}ɾᵻd`
    return `${stem}ᵻd`
  }

  stemEd(word: string, tag: string | null, stress: number | null, ctx: TokenContext | null): Lookup {
    if (word.length < 4 || !word.endsWith('d')) return MISS
    let stem: string
    if (!word.endsWith('dd') && this.isKnown(word.slice(0, -1))) stem = word.slice(0, -1)
    else if (
      word.length > 4 && word.endsWith('ed') && !word.endsWith('eed') && this.isKnown(word.slice(0, -2))
    ) stem = word.slice(0, -2)
    // Not in misaki, whose silver dictionary (left out, see THIRD-PARTY-NOTICES.md)
    // covers it: "replied" from "reply".
    else if (word.length > 4 && word.endsWith('ied') && this.isKnown(`${word.slice(0, -3)}y`)) {
      stem = `${word.slice(0, -3)}y`
    } else return MISS
    const [ps, rating] = this.lookup(stem, tag, stress, ctx)
    const out = this.suffixEd(ps)
    return out === null ? MISS : [out, rating as number]
  }

  private suffixIng(stem: string | null): string | null {
    if (!stem) return null
    if (this.british) {
      if ('əː'.includes(stem.at(-1) as string)) return null
    } else if (stem.length > 1 && stem.at(-1) === 't' && US_TAUS.has(stem.at(-2) as string)) {
      return `${stem.slice(0, -1)}ɾɪŋ`
    }
    return `${stem}ɪŋ`
  }

  stemIng(word: string, tag: string | null, stress: number | null, ctx: TokenContext | null): Lookup {
    if (word.length < 5 || !word.endsWith('ing')) return MISS
    let stem: string
    if (word.length > 5 && this.isKnown(word.slice(0, -3))) stem = word.slice(0, -3)
    else if (this.isKnown(`${word.slice(0, -3)}e`)) stem = `${word.slice(0, -3)}e`
    else if (
      word.length > 5
      && /([bcdgklmnprstvxz])\1ing$|cking$/.test(word)
      && this.isKnown(word.slice(0, -4))
    ) stem = word.slice(0, -4)
    else return MISS
    const [ps, rating] = this.lookup(stem, tag, stress, ctx)
    const out = this.suffixIng(ps)
    return out === null ? MISS : [out, rating as number]
  }

  getWord(word: string, tag: string | null, stress: number | null, ctx: TokenContext | null): Lookup {
    const special = this.specialCase(word, tag, stress, ctx)
    if (special[0] !== null) return special

    const wl = lower(word)
    if (
      word.length > 1
      && isAlpha(word.replaceAll("'", ''))
      && word !== wl
      && (tag !== 'NNP' || word.length > 7)
      && !this.golds.has(word)
      && (word === upper(word) || word.slice(1) === lower(word.slice(1)))
      && (
        this.golds.has(wl)
        || !!this.stemS(wl, tag, stress, ctx)[0]
        || !!this.stemEd(wl, tag, stress, ctx)[0]
        || !!this.stemIng(wl, tag, stress, ctx)[0]
      )
    ) {
      word = wl
    }

    if (this.isKnown(word)) return this.lookup(word, tag, stress, ctx)
    if (word.endsWith("s'") && this.isKnown(`${word.slice(0, -2)}'s`)) {
      return this.lookup(`${word.slice(0, -2)}'s`, tag, stress, ctx)
    }
    if (word.endsWith("'") && this.isKnown(word.slice(0, -1))) return this.lookup(word.slice(0, -1), tag, stress, ctx)

    const s = this.stemS(word, tag, stress, ctx)
    if (s[0] !== null) return s
    const ed = this.stemEd(word, tag, stress, ctx)
    if (ed[0] !== null) return ed
    return this.stemIng(word, tag, stress ?? 0.5, ctx)
  }

  /** Whether `word` reads as a number: digits, commas and points, and one suffix. */
  static isNumber(word: string, isHead: boolean): boolean {
    if (![...word].some((c) => isDigit(c))) return false
    for (const suffix of ['ing', "'d", 'ed', "'s", ...ORDINALS, 's']) {
      if (word.endsWith(suffix)) {
        word = word.slice(0, -suffix.length)
        break
      }
    }
    return [...word].every((c, i) => isDigit(c) || c === ',' || c === '.' || (isHead && i === 0 && c === '-'))
  }

  private static isCurrency(word: string): boolean {
    if (!word.includes('.')) return true
    if (word.split('.').length > 2) return false
    return word.split('.')[1].length < 3
  }

  getNumber(word: string, currency: string | null, isHead: boolean): Lookup {
    const suffixMatch = /[a-z']+$/.exec(word)
    const suffix = suffixMatch ? suffixMatch[0] : null
    if (suffix) word = word.slice(0, -suffix.length)
    const result: [string, number][] = []
    const push = (found: Lookup) => {
      if (found[0] !== null) result.push(found as [string, number])
    }

    if (word.startsWith('-')) {
      push(this.lookup('minus', null, null, null))
      word = word.slice(1)
    }

    // `escape` means `num` is already words; otherwise it is digits to read.
    const extend = (num: string, escape = false) => {
      for (const w of (escape ? num : cardinal(num)).split(/[^a-z]+/)) {
        if (w !== 'and') push(this.lookup(w, null, w === 'point' ? -2 : null, null))
      }
    }

    if (isDigit(word) && suffix !== null && ORDINALS.has(suffix)) {
      extend(ordinal(word), true)
    } else if (!result.length && word.length === 4 && !(currency && currency in CURRENCIES) && isDigit(word)) {
      extend(year(Number(word)), true)
    } else if (!isHead && !word.includes('.')) {
      const num = word.replaceAll(',', '')
      if (num[0] === '0' || num.length > 3) {
        for (const n of num) extend(n)
      } else if (num.length === 3 && !num.endsWith('00')) {
        extend(num[0])
        if (num[1] === '0') {
          push(this.lookup('O', null, -2, null))
          extend(num[2])
        } else {
          extend(num.slice(1))
        }
      } else {
        extend(num)
      }
    } else if (word.split('.').length > 2 || !isHead) {
      for (const num of word.replaceAll(',', '').split('.')) {
        if (!num) continue
        if (num[0] === '0' || (num.length !== 2 && [...num.slice(1)].some((n) => n !== '0'))) {
          for (const n of num) extend(n)
        } else {
          extend(num)
        }
      }
    } else if (currency && currency in CURRENCIES && Lexicon.isCurrency(word)) {
      const units = CURRENCIES[currency]
      let pairs = word.replaceAll(',', '').split('.').slice(0, 2)
        .map((num, i): [number, string] => [num ? Number.parseInt(num, 10) : 0, units[i]])
      if (pairs.length > 1) {
        if (pairs[1][0] === 0) pairs = pairs.slice(0, 1)
        else if (pairs[0][0] === 0) pairs = pairs.slice(1)
      }
      pairs.forEach(([num, unit], i) => {
        if (i > 0) push(this.lookup('and', null, null, null))
        extend(String(num))
        push(Math.abs(num) !== 1 && unit !== 'pence'
          ? this.stemS(`${unit}s`, null, null, null)
          : this.lookup(unit, null, null, null))
      })
    } else {
      let words: string
      if (isDigit(word)) words = cardinal(word)
      else if (!word.includes('.')) {
        const n = word.replaceAll(',', '')
        words = suffix !== null && ORDINALS.has(suffix) ? ordinal(n) : cardinal(n)
      } else {
        const n = word.replaceAll(',', '')
        words = n.startsWith('.')
          ? `point ${[...n.slice(1)].map((d) => cardinal(d)).join(' ')}`
          : decimal(n)
      }
      extend(words, true)
    }

    if (!result.length) return MISS
    const ps = result.map(([p]) => p).join(' ')
    const rating = Math.min(...result.map(([, r]) => r))
    if (suffix === 's' || suffix === "'s") return [this.suffixS(ps) as string, rating]
    if (suffix === 'ed' || suffix === "'d") return [this.suffixEd(ps) as string, rating]
    if (suffix === 'ing') {
      const ing = this.suffixIng(ps)
      return ing === null ? MISS : [ing, rating]
    }
    return [ps, rating]
  }

  private appendCurrency(ps: string, currency: string | null): string {
    if (!currency || !(currency in CURRENCIES)) return ps
    const unit = this.stemS(`${CURRENCIES[currency][0]}s`, null, null, null)[0]
    return unit ? `${ps} ${unit}` : ps
  }

  /** A token to phonemes, or a miss for the fallback. */
  read(token: LexiconToken, ctx: TokenContext): Lookup {
    const word = token.text.replace(/[‘’]/g, "'").normalize('NFKC')
    const stress = word === lower(word) ? null : word === upper(word) ? 2 : 0.5
    const [ps, rating] = this.getWord(word, token.tag, stress, ctx)
    if (ps !== null) return [this.appendCurrency(ps, token.currency), rating as number]
    if (Lexicon.isNumber(word, token.isHead)) return this.getNumber(word, token.currency, token.isHead)
    return MISS
  }
}
