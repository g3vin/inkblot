/**
 * Citation.js — an in-text citation, and the renderer that keeps every citation and
 * the bibliography formatted.
 *
 * A citation is an inline atom naming its sources by id (`items`, one or more, each
 * with an optional page or other locator). Keeping the ids on a node in the text —
 * rather than positions in a side list — is what lets a citation survive typing
 * around it, cut and paste (into another document, even), undo and version restore.
 *
 * `rendered` is the citation as last formatted, kept on the node so that everything
 * that renders a document without a live editor — previews, print, export, version
 * history — shows it formatted. It is HTML reduced to inline formatting (`tidy`), and
 * is re-tidied wherever it is set as HTML, so a hand-edited file cannot inject markup.
 *
 * The renderer is a plugin. Given the document's sources and style
 * (`setCitationContext`), it formats all of the document's citations together
 * (numbering, ibid., disambiguation depend on order) and writes the results into
 * `rendered` — and into the bibliography node (`Bibliography.js`) — in one
 * transaction kept out of undo history, only when something changed.
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { formatDocument, htmlToText, tidy, escapeHtml, MISSING_SOURCE } from '../lib/references/format'
import { loadStyle, styleSpec } from '../lib/references/styles'
import { CITATION_REVEAL_EVENT, openCitationPopover } from './citationPopover'
import './Citation.css'

export const citationKey = new PluginKey('citationRenderer')
export { CITATION_REVEAL_EVENT }

const EMPTY_CONTEXT = { docPath: null, references: new Map(), style: null, bibliography: null, attachedIds: [] }

const cleanItems = (items) => (Array.isArray(items) ? items : [])
  .filter((item) => item && typeof item.refId === 'string' && item.refId)
  .map((item) => ({
    refId: item.refId,
    ...(item.locator ? { locator: String(item.locator), label: item.label || 'page' } : {}),
    ...(item.prefix ? { prefix: String(item.prefix) } : {}),
    ...(item.suffix ? { suffix: String(item.suffix) } : {}),
    ...(item.suppressAuthor ? { suppressAuthor: true } : {}),
  }))

const parseItems = (element) => {
  try {
    return cleanItems(JSON.parse(element.getAttribute('data-items') || '[]'))
  } catch {
    return []
  }
}

/** Every citation in a document, in order: `{ pos, node, items }`. And whether (and
 *  where) there is a bibliography. */
export function collectCitations(doc) {
  const citations = []
  let bibliography = null
  doc.descendants((node, pos) => {
    if (node.type.name === 'citation') citations.push({ pos, node, items: cleanItems(node.attrs.items) })
    else if (node.type.name === 'bibliography' && !bibliography) bibliography = { pos, node }
    return node.isBlock || node.type.name === 'doc'
  })
  const citedIds = [...new Set(citations.flatMap((c) => c.items.map((item) => item.refId)))]
  return { citations, bibliography, citedIds }
}

/** The same, over stored JSON — for documents that are not open (print, export). */
export function collectCitationsJson(content) {
  const clusters = []
  let hasBibliography = false
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'citation') clusters.push(cleanItems(node.attrs?.items))
    if (node.type === 'bibliography') hasBibliography = true
    for (const child of node.content || []) walk(child)
  }
  walk(content)
  return { clusters, hasBibliography }
}

/**
 * The bibliography's attrs for a formatting result: its heading, entries and (under a
 * note style) the notes. Shared with the print path, which builds one for documents
 * whose bibliography appears only on paper.
 */
export function bibliographyAttrs(result, { styleId, options }) {
  const spec = styleSpec(styleId)
  return {
    title: options?.title || spec.heading,
    notes: result.notes.map((note) => note.html),
    entries: result.entries.map((entry) => ({ html: entry.html, annotation: entry.annotation || '' })),
    hanging: !/^\[\d|^\d/.test(htmlToText(result.entries[0]?.html || '')),
  }
}

/* ---------------- pushing the context in ---------------- */

/**
 * Give an editor what it needs to format: `{ docPath, references (Map), style,
 * bibliography (options), attachedIds }`. Formatting follows on its own.
 */
export function setCitationContext(editor, context) {
  if (!editor || editor.isDestroyed) return
  const storage = editor.storage.citation
  if (!storage) return
  storage.context = { ...EMPTY_CONTEXT, ...context }
  storage.version += 1
  try {
    editor.view.dispatch(editor.state.tr.setMeta(citationKey, { context: storage.version }).setMeta('addToHistory', false))
  } catch {
    // The view is not mounted yet; its first update will format.
  }
}

/* ---------------- the renderer ---------------- */

function renderer(editor) {
  let scheduled = false
  let lastSignature = null
  let running = false

  const signatureOf = (doc, storage) => {
    const { citations, bibliography } = collectCitations(doc)
    return JSON.stringify([storage.version, citations.map((c) => c.items), Boolean(bibliography)])
  }

  const run = async () => {
    scheduled = false
    if (running || editor.isDestroyed) return
    const storage = editor.storage.citation
    const context = storage.context
    if (!context?.style) return
    const startDoc = editor.state.doc
    const signature = signatureOf(startDoc, storage)
    if (signature === lastSignature) return
    running = true
    try {
      const spec = await loadStyle(context.style)
      if (editor.isDestroyed) return
      if (editor.state.doc !== startDoc) {
        schedule()
        return
      }
      const { citations, bibliography } = collectCitations(startDoc)
      if (!citations.length && !bibliography) {
        lastSignature = signature
        return
      }
      const result = formatDocument({
        styleId: spec.id,
        references: context.references,
        clusters: citations.map((c, index) => ({ id: `c${index}`, items: c.items })),
        include: context.bibliography?.include || 'cited',
        attachedIds: context.attachedIds || [],
        annotated: Boolean(context.bibliography?.annotated),
      })
      const tr = editor.state.tr
      citations.forEach((citation, index) => {
        const html = result.citations.get(`c${index}`) || MISSING_SOURCE
        if (citation.node.attrs.rendered !== html || citation.node.attrs.noteStyle !== spec.noteStyle) {
          tr.setNodeMarkup(citation.pos, null, { ...citation.node.attrs, rendered: html, noteStyle: spec.noteStyle })
        }
      })
      if (bibliography) {
        const attrs = bibliographyAttrs(result, { styleId: spec.id, options: context.bibliography })
        const current = bibliography.node.attrs
        if (JSON.stringify([current.title, current.notes, current.entries, current.hanging])
          !== JSON.stringify([attrs.title, attrs.notes, attrs.entries, attrs.hanging])) {
          tr.setNodeMarkup(bibliography.pos, null, { ...current, ...attrs })
        }
      }
      if (tr.docChanged) {
        tr.setMeta('addToHistory', false).setMeta(citationKey, { rendered: true })
        editor.view.dispatch(tr)
      }
      lastSignature = signatureOf(editor.state.doc, storage)
    } catch (error) {
      console.error('[citations] formatting failed', error)
    } finally {
      running = false
    }
  }

  const schedule = () => {
    if (scheduled) return
    scheduled = true
    Promise.resolve().then(run)
  }

  return { schedule, reset: () => { lastSignature = null } }
}

/* ---------------- the node ---------------- */

const setRendered = (dom, node) => {
  const html = node.attrs.rendered ? tidy(node.attrs.rendered) : ''
  dom.innerHTML = html || '<span class="citation-pending">[citation]</span>'
  dom.classList.toggle('is-missing', html === escapeHtml(MISSING_SOURCE))
  dom.classList.toggle('is-note', Boolean(node.attrs.noteStyle))
}

export const Citation = Node.create({
  name: 'citation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addStorage() {
    return { context: EMPTY_CONTEXT, version: 0 }
  },

  addAttributes() {
    return {
      items: {
        default: [],
        parseHTML: parseItems,
        renderHTML: (attrs) => ({ 'data-items': JSON.stringify(cleanItems(attrs.items)) }),
      },
      // Pasted HTML is never trusted as markup: the renderer formats it afresh.
      rendered: { default: '', parseHTML: () => '', renderHTML: () => ({}) },
      noteStyle: { default: false, parseHTML: () => false, renderHTML: () => ({}) },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-citation]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const dom = document.createElement('span')
    for (const [key, value] of Object.entries(mergeAttributes(HTMLAttributes, { 'data-citation': '', class: 'citation' }))) {
      dom.setAttribute(key, value)
    }
    setRendered(dom, node)
    return dom
  },

  renderText({ node }) {
    return htmlToText(node.attrs.rendered) || '[citation]'
  },

  addNodeView() {
    return ({ node: initial, editor, getPos }) => {
      let node = initial
      const dom = document.createElement('span')
      dom.className = 'citation citation-chip'
      dom.setAttribute('data-citation', '')
      dom.contentEditable = 'false'
      setRendered(dom, node)

      const onClick = (event) => {
        event.preventDefault()
        event.stopPropagation()
        const pos = typeof getPos === 'function' ? getPos() : null
        if (pos == null) return
        if (event.altKey) {
          window.dispatchEvent(new CustomEvent(CITATION_REVEAL_EVENT, { detail: { refId: node.attrs.items?.[0]?.refId } }))
          return
        }
        if (!editor.isEditable) return
        openCitationPopover({ editor, pos, node, anchor: dom, references: editor.storage.citation.context.references })
      }
      dom.addEventListener('mousedown', onClick)

      return {
        dom,
        update(next) {
          if (next.type.name !== 'citation') return false
          node = next
          setRendered(dom, node)
          return true
        },
        destroy() {
          dom.removeEventListener('mousedown', onClick)
        },
      }
    }
  },

  addCommands() {
    return {
      insertCitation: ({ refIds = [], locator = '' } = {}) => ({ state, chain }) => {
        const items = cleanItems(refIds.map((refId, index) => ({ refId, ...(index === 0 && locator ? { locator } : {}) })))
        if (!items.length) return false
        const noteStyle = styleSpec(this.editor.storage.citation.context.style).noteStyle
        // "(Smith, 2020)" wants a space before it; a note number sits against the word.
        const before = state.selection.$from.nodeBefore?.text?.slice(-1) || ''
        const content = [{ type: this.name, attrs: { items, noteStyle } }]
        if (!noteStyle && /[\p{L}\p{N}]/u.test(before)) content.unshift({ type: 'text', text: ' ' })
        return chain().insertContent(content).run()
      },
      setCitationItems: (pos, items) => ({ tr, state, dispatch }) => {
        const node = state.doc.nodeAt(pos)
        if (!node || node.type.name !== this.name) return false
        const clean = cleanItems(items)
        if (dispatch) {
          if (clean.length) tr.setNodeMarkup(pos, null, { ...node.attrs, items: clean })
          else tr.delete(pos, pos + node.nodeSize)
        }
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    const { schedule, reset } = renderer(editor)
    return [
      new Plugin({
        key: citationKey,
        view: () => {
          schedule()
          return {
            update: (view, previous) => {
              if (view.state.doc !== previous.doc) schedule()
            },
          }
        },
        appendTransaction: (transactions) => {
          if (transactions.some((tr) => tr.getMeta(citationKey)?.context != null)) {
            reset()
            schedule()
          }
          return null
        },
      }),
    ]
  },
})

export default Citation
