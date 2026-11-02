/**
 * focusText.js — focus mode's reading of a document: its text flattened with a map back
 * to document positions, split into sentences, each numbered within its paragraph, and
 * where the caret falls among them.
 *
 * Pure, so the overlay (components/FocusModeOverlay.jsx) and the tests share it.
 */

/**
 * Flatten the ProseMirror doc into plain text plus a parallel array mapping each text
 * offset back to its document position. Block boundaries become "\n\n" and hard breaks
 * "\n" so sentence detection sees structure. One extra position past the last character
 * lets the caret sit at the very end.
 */
export const buildFocusTextMap = (doc) => {
  const chunks = []
  const positions = []
  let previousBlock = null

  const appendBreak = (breakText, pos) => {
    for (let index = 0; index < breakText.length; index += 1) {
      chunks.push(breakText[index])
      positions.push(pos)
    }
  }

  doc.descendants((node, pos, parent) => {
    const block = parent?.isBlock ? parent : null

    if (node.type.name === 'hardBreak') {
      appendBreak('\n', pos)
      previousBlock = block
      return
    }

    if (!node.isText || !node.text) return

    if (chunks.length && block && block !== previousBlock) {
      appendBreak('\n\n', pos)
    }

    for (let index = 0; index < node.text.length; index += 1) {
      chunks.push(node.text[index])
      positions.push(pos + index)
    }

    previousBlock = block
  })

  const fallbackPos = Math.max(1, doc.content.size - 1)
  positions.push(positions.length ? positions[positions.length - 1] + 1 : fallbackPos)

  return { text: chunks.join(''), positions }
}

/**
 * The text offset of a document position. `positions` never decreases; a block break's
 * characters share the position of the character after them, so an exact match resolves
 * to the last of its run (the character, not the break before it).
 */
export const getTextOffsetForDocPosition = (positions, docPosition) => {
  if (!positions.length) return 0
  let low = 0
  let high = positions.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (positions[mid] <= docPosition) low = mid + 1
    else high = mid
  }
  if (low > 0 && positions[low - 1] === docPosition) return low - 1
  return Math.min(low, positions.length - 1)
}

/** The selection as focus-text offsets; a selection starts at its first non-space character. */
export const getFocusSelection = (textMap, selection) => {
  const from = getTextOffsetForDocPosition(textMap.positions, selection.from)
  if (selection.empty) return { from, to: from, empty: true }
  const to = getTextOffsetForDocPosition(textMap.positions, selection.to)
  const firstCharacter = textMap.text.slice(from, to).search(/\S/)
  return { from: firstCharacter === -1 ? from : from + firstCharacter, to, empty: false }
}

/**
 * Split text into sentences ({ start, end, text, paragraph, sentence, sentences }),
 * punctuation kept with its sentence. `paragraph` counts blank-line-separated
 * paragraphs from 0; `sentence` is the sentence's place in its paragraph from 0, of
 * `sentences`.
 */
export const getSentenceSpans = (text = '') => {
  const spans = []
  const regex = /[^.!?\n]+(?:[.!?]+["')\]’”]*)?/g
  let paragraph = 0
  let previousEnd = 0
  let match

  while ((match = regex.exec(text)) !== null) {
    const raw = match[0]
    const leading = raw.match(/^\s*/)[0].length
    const trailing = raw.match(/\s*$/)[0].length
    const start = match.index + leading
    const end = match.index + raw.length - trailing
    if (end <= start) continue

    if (spans.length && /\n{2,}/.test(text.slice(previousEnd, start))) paragraph += 1
    spans.push({ start, end, text: text.slice(start, end), paragraph })
    previousEnd = end
  }

  let first = 0
  for (let index = 0; index <= spans.length; index += 1) {
    if (index === spans.length || spans[index].paragraph !== spans[first].paragraph) {
      for (let member = first; member < index; member += 1) {
        spans[member].sentence = member - first
        spans[member].sentences = index - first
      }
      first = index
    }
  }

  return spans
}

/**
 * Where the caret is among the sentences: `index` is the sentence it belongs to (the
 * last one starting at or before it), and `slot` says whether it has moved past that
 * sentence's end:
 *   - 'trailing' — into the spaces after it, still on its line
 *   - 'next'     — past a line break, onto an empty line where the next sentence will go
 *   - null       — inside the sentence or at its end
 * With no sentences at all the caret is in an empty 'next' slot.
 */
export const locateCaret = (spans, text, offset) => {
  if (!spans.length) return { index: -1, slot: 'next' }
  let low = 0
  let high = spans.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (spans[mid].start <= offset) low = mid + 1
    else high = mid
  }
  const index = Math.max(0, low - 1)
  const span = spans[index]
  if (offset <= span.end) return { index, slot: null }
  return { index, slot: /\n/.test(text.slice(span.end, offset)) ? 'next' : 'trailing' }
}

/**
 * The run of sentences to draw around `index`: `before` and `after` of them, plus
 * `buffer` more each side that stay hidden at rest and show while the text scrolls.
 * Each carries the whitespace separating it from the one before it, as a break kind.
 */
export const getSentenceWindow = (spans, text, index, before, after, buffer = 0) => {
  const first = Math.max(0, index - before - buffer)
  const last = Math.min(spans.length, index + after + buffer + 1)
  const sentences = []
  for (let at = first; at < last; at += 1) {
    const span = spans[at]
    const prefix = at > 0 ? text.slice(spans[at - 1].end, span.start) : ''
    sentences.push({
      ...span,
      index: at,
      prefix,
      breakBefore: /\n{2,}/.test(prefix) ? 'paragraph' : /\n/.test(prefix) ? 'line' : '',
    })
  }
  return sentences
}

/**
 * "¶ 12 · Sentence 3 of 7": where the sentence sits, counted from one. With `fresh`, the
 * caret is on an empty line after it: 'sentence' (a line break, or the end of the
 * document) or 'paragraph' (an empty paragraph).
 */
export const describePosition = (span, fresh = null) => {
  if (!span) return ''
  if (fresh === 'paragraph') return `¶ ${span.paragraph + 2} · New paragraph`
  if (fresh === 'sentence') return `¶ ${span.paragraph + 1} · New sentence`
  return `¶ ${span.paragraph + 1} · Sentence ${span.sentence + 1} of ${span.sentences}`
}
