/**
 * HiddenText.js — text the writer has folded away: kept in the document, out of sight.
 *
 * The `hiddenText` mark is what is saved. Drawing it is this file's plugin: each run of
 * hidden text (across paragraph edges too, when nothing visible lies between) folds to
 * one small pill; pressing the pill opens the run in place, tinted, with a pill at its end
 * that folds it again. Which runs are open is the view's alone, never saved: a document
 * always opens folded.
 *
 * A folded run is skipped by the caret, so typing never lands in text that can't be
 * seen; Backspace or Delete against one opens it rather than eating it unseen. Export
 * and print leave hidden text out (print/hiddenText.js).
 */
import { Extension, Mark, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey, Selection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { AddMarkStep } from '@tiptap/pm/transform'
import iconElement from '../ui/iconElement.js'

export const HIDDEN_TEXT = 'hiddenText'
export const HIDDEN_TEXT_KEY = new PluginKey('hiddenText')

const countWords = (text) => text.split(/\s+/).filter(Boolean).length

/**
 * The runs of hidden text in `doc`, as positions: neighbouring runs join when only block
 * edges (or empty blocks) lie between them, so a hidden passage folds to one pill.
 */
export function hiddenRuns(doc, type) {
  const runs = []
  doc.descendants((node, pos) => {
    if (!node.isText) return true
    if (!type.isInSet(node.marks)) return false
    const last = runs[runs.length - 1]
    const to = pos + node.nodeSize
    // A leaf (an image, a line break) between two runs is visible, so it splits them.
    if (last && (last.to === pos || doc.textBetween(last.to, pos, '', '￼') === '')) last.to = to
    else runs.push({ from: pos, to })
    return false
  })
  return runs
}

/**
 * What folding a run hides: whole blocks where the run covers all of one (the
 * outermost, so a list item's bullet goes with its text), and inline ranges elsewhere.
 * `start` and `end` bound it all, `dead` are the positions a caret could not be seen at.
 */
export function foldLayout(doc, run) {
  const hide = []
  doc.nodesBetween(run.from, run.to, (node, pos) => {
    if (node.isText) {
      const from = Math.max(pos, run.from)
      const to = Math.min(pos + node.nodeSize, run.to)
      const last = hide[hide.length - 1]
      if (last && !last.block && last.to === from) last.to = to
      else hide.push({ from, to, block: false })
      return false
    }
    if (node.isLeaf) return false
    if (pos + 1 >= run.from && pos + node.nodeSize - 1 <= run.to) {
      hide.push({ from: pos, to: pos + node.nodeSize, block: true })
      return false
    }
    return true
  })
  if (!hide.length) return null
  // Inside a hidden block, or between the first and last character of hidden text.
  const dead = hide.map((range) => ({ from: range.from + 1, to: range.to - 1 }))
  return { ...run, hide, dead, start: hide[0].from, end: hide[hide.length - 1].to }
}

const isOpen = (open, run) => open.some((pos) => pos >= run.from && pos <= run.to)

function decorate(doc, runs, open) {
  const decorations = []
  runs.forEach((run) => {
    const words = countWords(doc.textBetween(run.from, run.to, ' '))
    if (isOpen(open, run)) {
      decorations.push(Decoration.inline(run.from, run.to, { class: 'hidden-text-open' }))
      decorations.push(Decoration.widget(run.to, (view) => pill(view, run, false, words), {
        side: 1, key: `hidden-open-${run.from}-${run.to}`, ignoreSelection: true,
      }))
      return
    }
    run.hide.forEach((range) => decorations.push(range.block
      ? Decoration.node(range.from, range.to, { class: 'hidden-text-folded' })
      : Decoration.inline(range.from, range.to, { class: 'hidden-text-folded' })))
    decorations.push(Decoration.widget(run.start, (view) => pill(view, run, true, words), {
      side: -1, key: `hidden-${run.from}-${run.to}-${words}`, ignoreSelection: true,
    }))
  })
  return DecorationSet.create(doc, decorations)
}

/** The pill a folded run shows as, or the one that folds an open run again. */
function pill(view, run, folded, words) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'hidden-text-pill'
  button.contentEditable = 'false'
  button.dataset.folded = String(folded)
  const label = folded ? `Show ${words} hidden ${words === 1 ? 'word' : 'words'}` : 'Hide again'
  button.setAttribute('aria-label', label)
  button.title = label
  if (folded) {
    const dots = document.createElement('span')
    dots.className = 'hidden-text-dots'
    dots.textContent = '•••'
    button.append(dots)
  } else {
    button.append(iconElement('hide'))
  }
  // Pressing it must not move the caret or select the pill.
  button.addEventListener('mousedown', (event) => event.preventDefault())
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    view.dispatch(view.state.tr.setMeta(HIDDEN_TEXT_KEY, folded ? { open: run.from } : { fold: run.from }))
  })
  return button
}

/** Does this transaction add hidden text where there was none to draw? */
const addsHidden = (tr, type) => tr.steps.some((step) => (step instanceof AddMarkStep
  ? step.mark.type === type
  : Boolean(step.slice?.content && sliceHas(step.slice.content, type))))

const sliceHas = (fragment, type) => {
  let found = false
  fragment.descendants((node) => {
    if (found) return false
    if (node.isText && type.isInSet(node.marks)) found = true
    return !found
  })
  return found
}

/** The folded run (if any) holding the hidden text that starts at `pos`. */
export const foldedRunAt = (state, pos) => {
  const value = HIDDEN_TEXT_KEY.getState(state)
  if (!value?.runs.length) return null
  return value.runs.find((run) => pos >= run.from && pos < run.to && !isOpen(value.open, run)) ?? null
}

/** The folded run (if any) whose hidden positions `pos` is in. */
const foldAt = (state, pos) => {
  const value = HIDDEN_TEXT_KEY.getState(state)
  if (!value) return null
  return value.runs.find((run) => !isOpen(value.open, run) && run.dead.some((range) => pos >= range.from && pos <= range.to)) ?? null
}

/** The folded run touching `pos`: hidden there, or ending or starting just beside it. */
export const foldBeside = (state, pos, dir) => {
  const value = HIDDEN_TEXT_KEY.getState(state)
  if (!value) return null
  return value.runs.find((run) => {
    if (isOpen(value.open, run)) return false
    const edge = dir < 0 ? Selection.near(state.doc.resolve(run.end), 1).from : Selection.near(state.doc.resolve(run.start), -1).from
    return edge === pos || (dir < 0 ? run.end === pos : run.start === pos)
  }) ?? null
}

// Against a folded run, Backspace and Delete open it: what is about to go is shown
// first. Ahead of the editor's own Backspace, which would otherwise join or delete.
const HiddenTextKeys = Extension.create({
  name: 'hiddenTextKeys',
  priority: 1000,
  addKeyboardShortcuts() {
    const openBeside = (dir) => ({ editor }) => editor.commands.command(({ state, tr }) => {
      if (!state.selection.empty) return false
      const run = foldBeside(state, state.selection.from, dir)
      if (!run) return false
      tr.setMeta(HIDDEN_TEXT_KEY, { open: run.from })
      return true
    })
    return { Backspace: openBeside(-1), Delete: openBeside(1) }
  },
})

export const HiddenText = Mark.create({
  name: HIDDEN_TEXT,
  inclusive: false,

  parseHTML() {
    return [{ tag: 'span[data-hidden-text]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-hidden-text': '' }), 0]
  },

  addCommands() {
    return {
      // Folds what it hides at once, even where an open run already was.
      setHiddenText: () => ({ tr, state, dispatch }) => {
        const { from, to, empty } = state.selection
        if (empty) return false
        if (dispatch) {
          tr.addMark(from, to, state.schema.marks[HIDDEN_TEXT].create())
          tr.setMeta(HIDDEN_TEXT_KEY, { fold: from })
          // The caret goes after the fold, where it can be seen.
          tr.setSelection(Selection.near(tr.doc.resolve(to), 1))
        }
        return true
      },
      unsetHiddenText: () => ({ tr, state, dispatch }) => {
        const { from, to, empty } = state.selection
        if (empty) return false
        if (dispatch) tr.removeMark(from, to, state.schema.marks[HIDDEN_TEXT])
        return true
      },
      /** Open every folded run in the document, or fold them all again. */
      setAllHiddenOpen: (open) => ({ tr, dispatch }) => {
        if (dispatch) tr.setMeta(HIDDEN_TEXT_KEY, { all: Boolean(open) })
        return true
      },
    }
  },

  addExtensions() {
    return [HiddenTextKeys]
  },

  addProseMirrorPlugins() {
    const type = this.type
    return [
      new Plugin({
        key: HIDDEN_TEXT_KEY,
        state: {
          init: (_, state) => {
            const runs = hiddenRuns(state.doc, type).map((run) => foldLayout(state.doc, run)).filter(Boolean)
            return { runs, open: [], decorations: null }
          },
          apply(tr, value, _old, state) {
            const meta = tr.getMeta(HIDDEN_TEXT_KEY)
            if (!tr.docChanged && !meta) return value
            let open = tr.docChanged ? value.open.map((pos) => tr.mapping.map(pos)) : value.open
            // Nothing hidden before and nothing hidden added: no walk on every keystroke.
            const runs = !value.runs.length && !meta && !addsHidden(tr, type)
              ? value.runs
              : hiddenRuns(state.doc, type).map((run) => foldLayout(state.doc, run)).filter(Boolean)
            if (meta?.open !== undefined) open = [...open, meta.open]
            if (meta?.fold !== undefined) {
              const run = runs.find((r) => meta.fold >= r.from && meta.fold <= r.to)
              open = run ? open.filter((pos) => pos < run.from || pos > run.to) : open
            }
            if (meta?.all === true) open = runs.map((run) => run.from)
            if (meta?.all === false) open = []
            open = open.filter((pos) => runs.some((run) => pos >= run.from && pos <= run.to))
            return { runs, open, decorations: null }
          },
        },
        props: {
          decorations(state) {
            const value = HIDDEN_TEXT_KEY.getState(state)
            if (!value?.runs.length) return DecorationSet.empty
            // Cached on the state value: drawing asks for them on every render.
            value.decorations ??= decorate(state.doc, value.runs, value.open)
            return value.decorations
          },
        },
        // A caret that lands in folded text moves past it the way it was going. A
        // selection made inside it (a search match, a jump) opens it instead.
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((tr) => tr.selectionSet || tr.docChanged)) return null
          const { selection } = newState
          if (!selection.empty) {
            const run = foldAt(newState, selection.from)
            if (run && selection.to <= run.to) return newState.tr.setMeta(HIDDEN_TEXT_KEY, { open: run.from })
            return null
          }
          const run = foldAt(newState, selection.head)
          if (!run) return null
          const after = Selection.near(newState.doc.resolve(run.end), 1)
          const before = Selection.near(newState.doc.resolve(run.start), -1)
          const ways = selection.head >= oldState.selection.head ? [after, before] : [before, after]
          // At the document's edge one way leads back into the fold: take the other.
          const next = ways.find((way) => foldAt(newState, way.head) !== run)
          return next ? newState.tr.setSelection(next) : null
        },
      }),
    ]
  },
})
