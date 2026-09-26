/**
 * DocWritingFormat.js — what a document is written as: prose, a screenplay or a stage
 * play. An attribute of its `doc` node, stored and versioned with it as its page setup
 * is (DocPageSetup.js), and changed in one undoable step.
 *
 * Changing it converts the text: to a script, paragraphs become action (or stage
 * directions) and headings become scene headings — a Heading 1 an act, in a play; back
 * to prose, every script line becomes a paragraph, a scene heading a Heading 2. Nothing
 * typed is lost either way.
 *
 * It also marks the editor (`is-script`, `is-screenplay`, `is-stageplay`), which is
 * what sets a script in Courier with its indents on screen (Script.css).
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import { BODY_ELEMENT } from './elements'
import { SCRIPT_NODE } from './ScriptElement'
import { labelScenes, NUMBERED_ELEMENTS, readSceneNumbers } from './sceneNumbers'

export const WRITING_FORMATS = ['prose', 'screenplay', 'stageplay']

/** A document's writing format: 'prose' unless it says otherwise. */
export const readWritingFormat = (doc) => (WRITING_FORMATS.includes(doc?.attrs?.writingFormat) ? doc.attrs.writingFormat : 'prose')

/* ---------------- scene numbers ---------------- */

export { readSceneNumbers }

/** Every scene heading's number, by position. */
export const sceneNumbers = (doc) => {
  const mode = readSceneNumbers(doc)
  const out = new Map()
  if (mode === 'off') return out
  const headings = []
  doc.forEach((node, pos) => {
    if (node.type.name === SCRIPT_NODE && NUMBERED_ELEMENTS.has(node.attrs.element)) headings.push({ pos, number: node.attrs.sceneNumber })
  })
  const labels = labelScenes(mode, headings.map((h) => h.number || null))
  headings.forEach((h, i) => out.set(h.pos, labels[i]))
  return out
}

const sceneNumberKey = new PluginKey('sceneNumbers')

const sceneDecorations = (doc) => {
  const numbers = sceneNumbers(doc)
  if (!numbers.size) return DecorationSet.empty
  const decorations = []
  for (const [pos, label] of numbers) {
    const node = doc.nodeAt(pos)
    if (node) decorations.push(Decoration.node(pos, pos + node.nodeSize, { 'data-scene-number': label, class: 'is-numbered' }))
  }
  return DecorationSet.create(doc, decorations)
}

const markEditor = (view) => {
  const format = readWritingFormat(view.state.doc)
  const dom = view.dom
  dom.classList.toggle('is-script', format !== 'prose')
  dom.classList.toggle('is-screenplay', format === 'screenplay')
  dom.classList.toggle('is-stageplay', format === 'stageplay')
}

/** The element a heading or a paragraph becomes in a script. */
const scriptElementFor = (node, format) => {
  if (node.type.name === 'heading') {
    if (format === 'stageplay') return node.attrs.level === 1 ? 'actHeading' : 'sceneTitle'
    return 'sceneHeading'
  }
  return BODY_ELEMENT[format]
}

export const DocWritingFormat = Extension.create({
  name: 'docWritingFormat',

  addGlobalAttributes() {
    return [{
      types: ['doc'],
      attributes: {
        writingFormat: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
        sceneNumbers: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
      },
    }]
  },

  addCommands() {
    return {
      /** 'off', 'on', or 'locked': numbers fixed on the headings, for a shooting script. */
      setSceneNumbers: (mode) => ({ state, tr, dispatch }) => {
        if (!['off', 'on', 'locked'].includes(mode)) return false
        const current = sceneNumbers(state.doc)
        tr.setDocAttribute('sceneNumbers', mode === 'off' ? null : mode)
        state.doc.forEach((node, pos) => {
          if (node.type.name !== SCRIPT_NODE || !NUMBERED_ELEMENTS.has(node.attrs.element)) return
          // Locking writes today's numbers down; anything else lets them go.
          const number = mode === 'locked' ? (current.get(pos) || null) : null
          if (node.attrs.sceneNumber !== number) tr.setNodeMarkup(pos, undefined, { ...node.attrs, sceneNumber: number })
        })
        if (dispatch) dispatch(tr)
        return true
      },
      setWritingFormat: (format) => ({ state, tr, dispatch }) => {
        if (!WRITING_FORMATS.includes(format)) return false
        const from = readWritingFormat(state.doc)
        if (from === format) return false
        const script = state.schema.nodes[SCRIPT_NODE]
        const { paragraph, heading } = state.schema.nodes
        tr.setDocAttribute('writingFormat', format === 'prose' ? null : format)
        state.doc.forEach((node, pos) => {
          if (format === 'prose') {
            if (node.type !== script) return
            const element = node.attrs.element
            if (element === 'actHeading') tr.setNodeMarkup(pos, heading, { level: 1 })
            else if (element === 'sceneHeading' || element === 'sceneTitle') tr.setNodeMarkup(pos, heading, { level: 2 })
            else tr.setNodeMarkup(pos, paragraph)
            return
          }
          if (node.type === script) {
            // From one kind of script to the other, the body lines change over.
            if (node.attrs.element === BODY_ELEMENT[from]) tr.setNodeMarkup(pos, undefined, { ...node.attrs, element: BODY_ELEMENT[format] })
            return
          }
          if (node.type === paragraph || node.type === heading) tr.setNodeMarkup(pos, script, { element: scriptElementFor(node, format) })
        })
        if (dispatch) dispatch(tr)
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      key: sceneNumberKey,
      // The numbers in both margins of each heading (Script.css), as decorations: they
      // follow the scenes as they move, with nothing to store until they are locked.
      state: {
        init: (_config, state) => sceneDecorations(state.doc),
        apply: (tr, previous) => (tr.docChanged ? sceneDecorations(tr.doc) : previous),
      },
      props: { decorations: (state) => sceneNumberKey.getState(state) },
    }), new Plugin({
      key: new PluginKey('writingFormatClass'),
      view: (view) => {
        markEditor(view)
        return { update: (v) => markEditor(v) }
      },
      // Prose that arrives in a script — pasted, or the paragraph an empty document
      // starts with — becomes its body lines.
      appendTransaction: (transactions, _old, state) => {
        if (!transactions.some((t) => t.docChanged)) return null
        const format = readWritingFormat(state.doc)
        if (format === 'prose') return null
        const script = state.schema.nodes[SCRIPT_NODE]
        const { paragraph } = state.schema.nodes
        let tr = null
        state.doc.forEach((node, pos) => {
          if (node.type !== paragraph) return
          tr = tr || state.tr
          tr.setNodeMarkup(pos, script, { element: BODY_ELEMENT[format] })
        })
        return tr
      },
    })]
  },
})

export default DocWritingFormat
