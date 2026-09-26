/**
 * wordCount.ts — what Inkblot means by "a word".
 *
 * One definition, shared by the pane's badge and the stats the shell keeps, so the
 * number a writer sees under the page is the number their goals are measured in.
 */

/** The characters `\s` matches in a JavaScript regex. */
const isSpace = (code: number): boolean => (
  code === 32 || (code >= 9 && code <= 13) || code === 160 || code === 5760 ||
  (code >= 8192 && code <= 8202) || code === 8232 || code === 8233 || code === 8239 ||
  code === 8287 || code === 12288 || code === 65279
)

/**
 * Whitespace-delimited word count — what `text.trim().split(/\s+/).length` gives,
 * counted in place: a manuscript is counted several times a second while it is
 * typed into, and splitting it built an array of every word each time.
 */
export const countWords = (text = ''): number => {
  let words = 0
  let inWord = false
  for (let i = 0; i < text.length; i += 1) {
    if (isSpace(text.charCodeAt(i))) {
      inWord = false
    } else if (!inWord) {
      inWord = true
      words += 1
    }
  }
  return words
}

interface CountableEditor {
  state: { doc: object }
  getText: () => string
}

const counted = new WeakMap<object, number>()

/**
 * The words in an editor's document, counted once per version of it. The badge, the
 * shell's stats and the page view's running heads all ask after the same edit; a
 * document is immutable, so its count is kept for as long as the document is.
 */
export const countEditorWords = (editor: CountableEditor): number => {
  const { doc } = editor.state
  let words = counted.get(doc)
  if (words === undefined) {
    words = countWords(editor.getText())
    counted.set(doc, words)
  }
  return words
}
