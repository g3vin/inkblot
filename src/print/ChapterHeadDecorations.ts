/**
 * ChapterHeadDecorations.ts — a chapter's designed head, drawn around its real title in
 * the live editor, so the Typeset pages show the head that prints.
 *
 * A compiled chapter opens with a `chapterHead` node (ChapterHead.js). The live editor
 * cannot hold one — its title is the chapter's own Heading 1, typed in place — so the
 * same head is drawn as decorations around that heading, never as content:
 *
 *   a widget before it   the ornament or picture above, the number, the slot between
 *   the heading itself   set as the design sets a title (a node decoration)
 *   a widget after it    the subtitle and the epigraph (typed in place), the slot below
 *
 * Nothing is saved, undone or copied. The subtitle and the epigraph are the chapter's
 * own head (`DocChapterMeta`): typed into the widget, they are committed with
 * `setChapterMeta` when the writer leaves them.
 *
 * What to draw is `editor.storage.chapterHeadDecorations.head` — the book's design and this
 * chapter's label — set by the pane (PaneEditorSurface) in Typeset, and null elsewhere.
 * The pagination measures the flow's real positions, so a head the widgets make taller
 * moves the text after it down, and pages break around it as they will in print.
 */
import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

import type { ChapterDesign } from '../types'
import { chapterHeadFor } from './bookMatter'
import type { ChapterHeadValue } from './bookMatter'
import { chapterHeadSpec, renderSpec } from './ChapterHead'
import { readChapterMeta } from './DocChapterMeta'

export const chapterHeadKey = new PluginKey('chapterHeadDecorations')

/** What a pane asks to be drawn: the book's design, the chapter's label and name. */
export interface LiveHead {
  design: ChapterDesign
  label: string | null
  name: string
  /** Resolve a stored picture path to a URL the page can show. */
  imageUrl?: (src: string) => string
}

declare module '@tiptap/core' {
  interface Storage {
    chapterHeadDecorations: { head: LiveHead | null }
  }
}

/** Set what a pane's editor draws, and redraw it. */
export const setLiveHead = (editor: Editor | null | undefined, head: LiveHead | null) => {
  if (!editor || editor.isDestroyed || !editor.storage.chapterHeadDecorations) return
  const before = editor.storage.chapterHeadDecorations.head
  if (JSON.stringify(before ? { ...before, imageUrl: undefined } : null) === JSON.stringify(head ? { ...head, imageUrl: undefined } : null)) return
  editor.storage.chapterHeadDecorations.head = head
  editor.view.dispatch(editor.state.tr.setMeta(chapterHeadKey, 'redraw').setMeta('addToHistory', false))
}

const titleOf = (doc: PMNode): PMNode | null => {
  const first = doc.firstChild
  return first && first.type.name === 'heading' && first.attrs.level === 1 ? first : null
}

/** The CSS a title is set in, from the design — the heading carries it itself in the live editor. */
const titleStyle = (head: ChapterHeadValue): string => [
  head.titleSizePt ? `font-size: ${head.titleSizePt}pt` : '',
  head.headingFont ? `font-family: ${head.headingFont}` : '',
  `text-align: ${head.alignment || 'center'}`,
  head.titleCase === 'upper' ? 'text-transform: uppercase; letter-spacing: 0.12em' : '',
  head.titleCase === 'smallCaps' ? 'font-variant: small-caps; letter-spacing: 0.06em' : '',
  head.titleCase === 'italic' ? 'font-style: italic' : '',
].filter(Boolean).join('; ')

/** An editable line of the head: its text, or a placeholder where there is none. */
const editableLine = (
  className: string,
  value: string,
  placeholder: string,
  commit: (text: string) => void,
  { multiline = false } = {}
): HTMLElement => {
  const el = document.createElement('div')
  el.className = `${className} ch-editable`
  el.textContent = value
  el.setAttribute('contenteditable', 'plaintext-only')
  el.setAttribute('data-placeholder', placeholder)
  el.setAttribute('spellcheck', 'true')
  if (!value) el.setAttribute('data-empty', '')
  el.addEventListener('input', () => {
    if (el.textContent) el.removeAttribute('data-empty')
    else el.setAttribute('data-empty', '')
  })
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' || (event.key === 'Enter' && !(multiline && event.shiftKey))) {
      event.preventDefault()
      el.blur()
    }
  })
  el.addEventListener('blur', () => {
    const text = (el.textContent || '').trim()
    if (text !== value) commit(text)
  })
  return el
}

const build = (editor: Editor, state: EditorState): DecorationSet => {
  const live = editor.storage.chapterHeadDecorations?.head
  if (!live) return DecorationSet.empty
  const doc = state.doc
  const title = titleOf(doc)
  const meta = readChapterMeta(doc) || { subtitle: '', epigraph: '', epigraphSource: '' }
  const resolved = chapterHeadFor(live.design, { label: live.label, title: title ? '' : live.name, meta })
  const head: ChapterHeadValue = {
    ...resolved,
    image: resolved.image && live.imageUrl ? live.imageUrl(resolved.image) : resolved.image,
    ornamentImage: resolved.ornamentImage && live.imageUrl ? live.imageUrl(resolved.ornamentImage) : resolved.ornamentImage,
  }
  const setMeta = (change: Record<string, string>) => {
    const current = readChapterMeta(editor.state.doc) || { subtitle: '', epigraph: '', epigraphSource: '' }
    const commands = editor.commands as unknown as { setChapterMeta: (meta: Record<string, unknown>) => boolean }
    commands.setChapterMeta({ ...current, ...change })
  }

  // The head's spec, split where the title goes: what is above it, and what is below.
  const [, attrs, ...children] = chapterHeadSpec({ ...head, subtitle: '', epigraph: '', epigraphSource: '' }) as [string, Record<string, string>, ...unknown[]]
  const titleAt = children.findIndex((c) => Array.isArray(c) && c[0] === 'h1')
  const above = titleAt < 0 ? children : children.slice(0, titleAt)
  const below = titleAt < 0 ? [] : children.slice(titleAt + 1)
  const key = JSON.stringify(head)

  const top = Decoration.widget(0, () => {
    const el = renderSpec(['header', { ...attrs, class: `${attrs.class} is-live-top` }, ...above] as never) as HTMLElement
    if (!title) el.appendChild(renderSpec(['h1', { class: 'ch-title' }, live.name] as never))
    return el
  }, { side: -1, key: `top:${key}:${Boolean(title)}`, ignoreSelection: true, stopEvent: () => true })

  const bottomAt = title ? title.nodeSize : 0
  const bottom = Decoration.widget(bottomAt, () => {
    const el = renderSpec(['div', { ...attrs, class: `${attrs.class} is-live-bottom` }] as never) as HTMLElement
    if (live.design.showSubtitle) {
      el.appendChild(editableLine('ch-subtitle', meta.subtitle || '', 'Add a subtitle', (subtitle) => setMeta({ subtitle })))
    }
    for (const child of below) el.appendChild(renderSpec(child as never))
    const quote = document.createElement('blockquote')
    quote.className = 'ch-epigraph'
    quote.appendChild(editableLine('ch-epigraph-text', meta.epigraph || '', 'Add an epigraph', (epigraph) => setMeta({ epigraph }), { multiline: true }))
    if (meta.epigraph) {
      quote.appendChild(editableLine('ch-epigraph-source', meta.epigraphSource || '', 'Who said it', (epigraphSource) => setMeta({ epigraphSource })))
    }
    el.appendChild(quote)
    return el
  }, { side: title ? 1 : -1, key: `bottom:${key}:${meta.subtitle}:${meta.epigraph}:${meta.epigraphSource}`, ignoreSelection: true, stopEvent: () => true })

  const decorations = [top, bottom]
  if (title) decorations.push(Decoration.node(0, title.nodeSize, { class: 'ch-title ch-live-title', style: titleStyle(head) }))
  return DecorationSet.create(doc, decorations)
}

export const ChapterHeadDecorations = Extension.create({
  name: 'chapterHeadDecorations',

  addStorage() {
    return { head: null }
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: chapterHeadKey,
        state: {
          init: (_, state) => build(editor, state),
          apply: (tr, previous, _old, state) => (
            tr.docChanged || tr.getMeta(chapterHeadKey) ? build(editor, state) : previous
          ),
        },
        props: {
          decorations: (state) => chapterHeadKey.getState(state),
        },
      }),
    ]
  },
})
