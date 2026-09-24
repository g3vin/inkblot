/**
 * Bibliography.js — the live bibliography: a block at the end of a document that the
 * citation renderer (`Citation.js`) keeps current.
 *
 * Its content is attributes, not child nodes: the entries are the formatter's, not
 * the writer's, and a writer who could type into one would lose the edit on the next
 * citation. What is stored — heading, notes, entries, annotations — is a snapshot of
 * the last formatting, so a preview, a printout or an export shows it without a live
 * editor. Entry HTML is re-tidied wherever it becomes markup.
 *
 * One per document. Inserting it again moves it to the end.
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { escapeHtml, htmlToText, tidy } from '../lib/references/format'

const asList = (value) => (Array.isArray(value) ? value : [])

/** The block's inner DOM, from its attrs. `document` is whichever one is rendering. */
export function renderBibliographyInto(dom, attrs) {
  dom.textContent = ''
  const doc = dom.ownerDocument
  const heading = doc.createElement('h2')
  heading.className = 'bibliography-title'
  heading.textContent = attrs.title || 'References'
  dom.appendChild(heading)

  const notes = asList(attrs.notes)
  const entries = asList(attrs.entries)
  // A chapter's notes printed on their own (`printBibliography.js`) are titled Notes.
  const notesOnly = !entries.length && notes.length > 0
  if (notes.length && !notesOnly) {
    const notesHeading = doc.createElement('h3')
    notesHeading.className = 'bibliography-notes-title'
    notesHeading.textContent = 'Notes'
    dom.appendChild(notesHeading)
  }
  if (notes.length) {
    const list = doc.createElement('ol')
    list.className = 'bibliography-notes'
    for (const html of notes) {
      const item = doc.createElement('li')
      item.innerHTML = tidy(html)
      list.appendChild(item)
    }
    dom.appendChild(list)
  }

  if (notesOnly) return
  const body = doc.createElement('div')
  body.className = `bibliography-entries${attrs.hanging === false ? '' : ' is-hanging'}`
  if (!entries.length) {
    const empty = doc.createElement('p')
    empty.className = 'bibliography-empty'
    empty.textContent = 'Cite a source and it will be listed here.'
    body.appendChild(empty)
  }
  for (const entry of entries) {
    const p = doc.createElement('p')
    p.className = 'bibliography-entry'
    p.innerHTML = tidy(entry?.html || '')
    body.appendChild(p)
    if (entry?.annotation) {
      const note = doc.createElement('p')
      note.className = 'bibliography-annotation'
      note.innerHTML = escapeHtml(entry.annotation).replace(/\n/g, '<br>')
      body.appendChild(note)
    }
  }
  dom.appendChild(body)
}

export const Bibliography = Node.create({
  name: 'bibliography',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    // Pasted HTML is re-formatted by the renderer, never trusted as markup.
    const snapshot = (fallback) => ({ default: fallback, parseHTML: () => fallback, renderHTML: () => ({}) })
    return {
      title: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-title') || '',
        renderHTML: (attrs) => ({ 'data-title': attrs.title || '' }),
      },
      notes: snapshot([]),
      entries: snapshot([]),
      hanging: snapshot(true),
    }
  },

  parseHTML() {
    return [{ tag: 'section[data-bibliography]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const dom = document.createElement('section')
    for (const [key, value] of Object.entries(mergeAttributes(HTMLAttributes, { 'data-bibliography': '', class: 'bibliography' }))) {
      dom.setAttribute(key, value)
    }
    renderBibliographyInto(dom, node.attrs)
    return dom
  },

  renderText({ node }) {
    const lines = [node.attrs.title || 'References']
    for (const note of asList(node.attrs.notes)) lines.push(htmlToText(note))
    for (const entry of asList(node.attrs.entries)) {
      lines.push(htmlToText(entry?.html))
      if (entry?.annotation) lines.push(entry.annotation)
    }
    return `\n${lines.join('\n')}\n`
  },

  addNodeView() {
    return ({ node: initial }) => {
      let node = initial
      const dom = document.createElement('section')
      dom.className = 'bibliography'
      dom.setAttribute('data-bibliography', '')
      dom.contentEditable = 'false'
      renderBibliographyInto(dom, node.attrs)
      return {
        dom,
        update(next) {
          if (next.type.name !== 'bibliography') return false
          if (next.attrs !== node.attrs) renderBibliographyInto(dom, next.attrs)
          node = next
          return true
        },
        ignoreMutation: () => true,
      }
    }
  },

  addCommands() {
    return {
      /** Put the bibliography at the end, moving it there if the document has one. */
      insertBibliography: () => ({ state, tr, dispatch }) => {
        let existing = null
        state.doc.descendants((node, pos) => {
          if (node.type.name === this.name && !existing) existing = { node, pos }
          return !existing
        })
        if (dispatch) {
          const node = existing?.node || this.type.create()
          if (existing) tr.delete(existing.pos, existing.pos + existing.node.nodeSize)
          // The end is before the empty paragraph the editor keeps last (TrailingNode),
          // so the bibliography closes the document rather than sitting under a blank.
          const last = tr.doc.lastChild
          const trailing = last && tr.doc.childCount > 1 && last.type.name === 'paragraph' && last.content.size === 0
          tr.insert(tr.doc.content.size - (trailing ? last.nodeSize : 0), node)
          tr.scrollIntoView()
        }
        return true
      },
      removeBibliography: () => ({ state, tr, dispatch }) => {
        let found = null
        state.doc.descendants((node, pos) => {
          if (node.type.name === this.name && !found) found = { node, pos }
          return !found
        })
        if (!found) return false
        if (dispatch) tr.delete(found.pos, found.pos + found.node.nodeSize)
        return true
      },
    }
  },
})

export default Bibliography
