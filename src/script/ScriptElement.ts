/**
 * ScriptElement.ts — one line of a screenplay or a stage play: a scene heading, action,
 * a character's name, a parenthetical, dialogue, a transition…
 *
 * One textblock node with the element as an attribute, rather than a node per element,
 * so that Enter and Tab moving between elements is an attribute change, pagination
 * measures it like any paragraph, and everything that reads text (search, word counts,
 * versions) needs to know nothing new. How each element sits on the page is Script.css.
 *
 * The keys (elements.ts has the tables):
 *   Enter            the element that usually follows — after a character, dialogue
 *   Enter, empty     changes the empty line instead (a second Enter after a speech
 *                    makes the next speaker)
 *   Tab / ⇧Tab       the element that often follows, or came before
 *   ⌥⌘1 … ⌥⌘8        an element by number, in the order the Paragraph Style menu lists
 *
 * Typing "INT. " or "EXT. " into action makes it a scene heading; a capitalised line
 * ending "TO:" is a transition when Enter is pressed. In a character or a scene heading,
 * a name or a place already used is offered in grey as it is typed: Tab, Enter or → takes
 * it (SmartType, as Final Draft calls it).
 */
import { mergeAttributes, Node } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

import {
  ALL_ELEMENTS, characterName, elementsFor, isElement, nextOnEnter, nextOnTab, recognise,
} from './elements'
import type { ScriptElementType, WritingFormat } from './elements'
import './Script.css'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    scriptElement: {
      /** Make the selected lines this element (and, from prose, script lines). */
      setScriptElement: (element: ScriptElementType) => ReturnType
    }
  }
}

export const SCRIPT_NODE = 'scriptElement'

const formatOf = (state: EditorState): WritingFormat => {
  const format = state.doc.attrs.writingFormat
  return format === 'stageplay' || format === 'screenplay' ? format : 'screenplay'
}

/** The script line the cursor is in, or null. */
const currentLine = (state: EditorState): { node: PMNode; pos: number } | null => {
  const { $from } = state.selection
  if ($from.parent.type.name !== SCRIPT_NODE) return null
  return { node: $from.parent, pos: $from.before() }
}

/** A parenthetical made from nothing opens with its parentheses, the cursor inside. */
const withParens = (tr: Transaction, pos: number, node: PMNode, element: ScriptElementType): Transaction => {
  if (element !== 'parenthetical' || node.textContent) return tr
  tr.insertText('()', pos + 1)
  return tr.setSelection(TextSelection.create(tr.doc, pos + 2))
}

const setElementAt = (tr: Transaction, pos: number, node: PMNode, element: ScriptElementType): Transaction => {
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, element })
  return withParens(tr, pos, node, element)
}

/* ---------------- SmartType ---------------- */

interface Suggestion { pos: number; rest: string }

const suggestKey = new PluginKey<Suggestion | null>('scriptSuggest')

const SUGGESTS: ScriptElementType[] = ['character', 'stageCharacter', 'sceneHeading', 'sceneTitle']

/** What the line's typing so far could be finished as: a name or a heading used before. */
export const suggestionFor = (doc: PMNode, element: ScriptElementType, typed: string): string | null => {
  const prefix = typed.toUpperCase()
  if (!prefix.trim()) return null
  const counts = new Map<string, number>()
  doc.forEach((node) => {
    if (node.type.name !== SCRIPT_NODE || node.attrs.element !== element) return
    const text = element === 'character' || element === 'stageCharacter' ? characterName(node.textContent) : node.textContent.trim().toUpperCase()
    if (text.length > prefix.length && text.startsWith(prefix)) counts.set(text, (counts.get(text) || 0) + 1)
  })
  let best: string | null = null
  for (const [text, n] of counts) if (!best || n > (counts.get(best) || 0)) best = text
  return best
}

const computeSuggestion = (state: EditorState): Suggestion | null => {
  const { selection } = state
  if (!selection.empty) return null
  const line = currentLine(state)
  if (!line || !SUGGESTS.includes(line.node.attrs.element)) return null
  const { $from } = selection
  // Only at the end of what has been typed.
  if ($from.parentOffset !== line.node.content.size) return null
  const typed = line.node.textContent
  const best = suggestionFor(state.doc, line.node.attrs.element, typed)
  return best ? { pos: $from.pos, rest: best.slice(typed.length) } : null
}

/** Take the offered finish. Returns false when there is none. */
const acceptSuggestion = (editor: Editor): boolean => {
  const suggestion = suggestKey.getState(editor.state)
  if (!suggestion) return false
  editor.view.dispatch(editor.state.tr.insertText(suggestion.rest, suggestion.pos))
  return true
}

/* ---------------- the node ---------------- */

export const ScriptElement = Node.create({
  name: SCRIPT_NODE,
  group: 'block',
  content: 'inline*',
  defining: true,
  // Ahead of the list, indent and heading keys, which a script line has no use for.
  priority: 1000,

  addAttributes() {
    return {
      element: {
        default: 'action',
        parseHTML: (el) => (isElement(el.getAttribute('data-script')) ? el.getAttribute('data-script') : 'action'),
        renderHTML: (attrs) => ({ 'data-script': attrs.element, class: `script-el script-${attrs.element}` }),
      },
      sceneNumber: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-scene-number') || null,
        renderHTML: (attrs) => (attrs.sceneNumber ? { 'data-scene-number': attrs.sceneNumber } : {}),
      },
      /** Dialogue spoken at the same time as the speech before it (Fountain's ^). */
      dual: {
        default: false,
        parseHTML: (el) => el.hasAttribute('data-dual'),
        renderHTML: (attrs) => (attrs.dual ? { 'data-dual': '' } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'p[data-script]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes), 0]
  },

  addCommands() {
    return {
      setScriptElement: (element) => ({ state, tr, dispatch }) => {
        const type = state.schema.nodes[SCRIPT_NODE]
        const { from, to } = state.selection
        let changed = false
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!node.isTextblock) return true
          if (node.type === type && node.attrs.element === element) return false
          if (node.type === type) tr.setNodeMarkup(pos, undefined, { ...node.attrs, element })
          else tr.setNodeMarkup(pos, type, { element })
          changed = true
          return false
        })
        if (!changed) return false
        const line = currentLine(state)
        if (line && state.selection.empty) withParens(tr, line.pos, tr.doc.nodeAt(line.pos) || line.node, element)
        if (dispatch) dispatch(tr.scrollIntoView())
        return true
      },
    }
  },

  addKeyboardShortcuts() {
    const byNumber = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`Mod-Alt-${i + 1}`, () => {
      if (!currentLine(this.editor.state)) return false
      const spec = elementsFor(formatOf(this.editor.state))[i]
      return spec ? this.editor.commands.setScriptElement(spec.id) : false
    }]))
    return {
      Enter: () => {
        const { state } = this.editor
        const line = currentLine(state)
        if (!line) return false
        const element = line.node.attrs.element as ScriptElementType
        if (acceptSuggestion(this.editor)) {
          // Taken, and then on to what follows, as Enter would anyway.
          return this.editor.commands.command(({ tr, state: next }) => {
            const now = currentLine(next)
            if (!now) return false
            const after = nextOnEnter(element, now.node.textContent).next || element
            tr.split(next.selection.from, 1, [{ type: next.schema.nodes[SCRIPT_NODE], attrs: { element: after } }])
            return true
          })
        }
        const { change, next } = nextOnEnter(element, line.node.textContent)
        const tr = state.tr
        if (change && !next) {
          setElementAt(tr, line.pos, line.node, change)
          this.editor.view.dispatch(tr.scrollIntoView())
          return true
        }
        if (change) tr.setNodeMarkup(line.pos, undefined, { ...line.node.attrs, element: change })
        if (!state.selection.empty) tr.deleteSelection()
        const $pos = tr.selection.$from
        const atEnd = $pos.parentOffset === $pos.parent.content.size
        // Split mid-line, the rest of the line stays what it was.
        const following = atEnd ? (next || element) : (change || element)
        tr.split($pos.pos, 1, [{ type: state.schema.nodes[SCRIPT_NODE], attrs: { element: following } }])
        const created = tr.doc.nodeAt(tr.selection.$from.before())
        if (created && atEnd) withParens(tr, tr.selection.$from.before(), created, following)
        this.editor.view.dispatch(tr.scrollIntoView())
        return true
      },
      Tab: () => {
        const line = currentLine(this.editor.state)
        if (!line) return false
        if (acceptSuggestion(this.editor)) return true
        const tr = setElementAt(this.editor.state.tr, line.pos, line.node, nextOnTab(line.node.attrs.element, false, formatOf(this.editor.state)))
        this.editor.view.dispatch(tr)
        return true
      },
      'Shift-Tab': () => {
        const line = currentLine(this.editor.state)
        if (!line) return false
        const tr = setElementAt(this.editor.state.tr, line.pos, line.node, nextOnTab(line.node.attrs.element, true, formatOf(this.editor.state)))
        this.editor.view.dispatch(tr)
        return true
      },
      ArrowRight: () => acceptSuggestion(this.editor),
      ...byNumber,
    }
  },

  addProseMirrorPlugins() {
    return [
      // What was typed decides what the line is: "INT. " makes a scene heading, a
      // "(" opening an empty speech makes a parenthetical.
      new Plugin({
        key: new PluginKey('scriptRecognise'),
        appendTransaction: (transactions, _old, state) => {
          if (!transactions.some((t) => t.docChanged)) return null
          const line = currentLine(state)
          if (!line) return null
          const element = line.node.attrs.element as ScriptElementType
          const text = line.node.textContent
          const recognised = recognise(element, text)
          if (recognised) return state.tr.setNodeMarkup(line.pos, undefined, { ...line.node.attrs, element: recognised })
          if ((element === 'dialogue' || element === 'stageDialogue') && text === '(') {
            const tr = state.tr.setNodeMarkup(line.pos, undefined, { ...line.node.attrs, element: 'parenthetical' })
            tr.insertText(')', line.pos + 2)
            return tr.setSelection(TextSelection.create(tr.doc, line.pos + 2))
          }
          return null
        },
      }),
      new Plugin<Suggestion | null>({
        key: suggestKey,
        state: {
          init: (_config, state) => computeSuggestion(state),
          apply: (tr, previous, _old, state) => (tr.docChanged || tr.selectionSet ? computeSuggestion(state) : previous),
        },
        props: {
          decorations: (state) => {
            const decorations: Decoration[] = []
            // The empty line being written on says what it is.
            const line = currentLine(state)
            if (line && line.node.content.size === 0) {
              const label = ALL_ELEMENTS.find((e) => e.id === line.node.attrs.element)?.label || ''
              decorations.push(Decoration.node(line.pos, line.pos + line.node.nodeSize, { 'data-placeholder': label }))
            }
            const suggestion = suggestKey.getState(state)
            if (!suggestion) return decorations.length ? DecorationSet.create(state.doc, decorations) : null
            return DecorationSet.create(state.doc, [...decorations, Decoration.widget(suggestion.pos, () => {
              const ghost = document.createElement('span')
              ghost.className = 'script-ghost'
              ghost.textContent = suggestion.rest
              ghost.setAttribute('aria-hidden', 'true')
              return ghost
            }, { side: 1, key: `ghost:${suggestion.rest}` })])
          },
        },
      }),
    ]
  },
})

export default ScriptElement
