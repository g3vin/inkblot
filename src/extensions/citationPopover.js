/**
 * citationPopover.js — edit one citation where it sits: a page or other locator for
 * each source, words before or after, the author left out ("Smith argues (2020)…"),
 * or the citation removed. ⌥-click the citation instead to show the source in the
 * References panel.
 *
 * Plain DOM, like the other widgets drawn inside the document: it belongs to the
 * editor, not to either shell, so both get it.
 */
import { contributorLabel } from '../lib/references/csl'
import { trapTab } from '../ui/hooks'
import iconElement from '../ui/iconElement'

/** Show a source in the References panel: `{ detail: { refId } }`. */
export const CITATION_REVEAL_EVENT = 'citation:reveal'

const LOCATOR_LABELS = [
  ['page', 'Page'], ['chapter', 'Chapter'], ['section', 'Section'], ['paragraph', 'Paragraph'],
  ['line', 'Line'], ['figure', 'Figure'], ['volume', 'Volume'], ['timestamp', 'Time'],
]

let open = null

export function closeCitationPopover() {
  if (!open) return
  open.teardown()
  open = null
}

const sourceName = (ref) => {
  if (!ref) return 'Missing source'
  const who = ref.contributors?.[0] ? (ref.contributors[0].literal || ref.contributors[0].family || contributorLabel(ref.contributors[0])) : ''
  const title = ref.fields?.title || 'Untitled'
  return who ? `${who} — ${title}` : title
}

const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag)
  Object.assign(node, props)
  for (const child of children) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
  return node
}

export function openCitationPopover({ editor, pos, node, anchor, references }) {
  closeCitationPopover()
  const items = (node.attrs.items || []).map((item) => ({ ...item }))

  // The one pop-up surface (docs/DESIGN.md §9 → Pop-ups), drawn by hand: this belongs to
  // the editor, not to React.
  const form = el('form', { className: 'ib-popover citation-popover', role: 'dialog', tabIndex: -1 })
  form.setAttribute('aria-label', 'Edit citation')
  form.appendChild(el('p', { className: 'ib-eyebrow ib-popover-eyebrow', textContent: 'Citation' }))

  items.forEach((item, index) => {
    const row = el('div', { className: 'citation-popover-source' })
    row.appendChild(el('div', { className: 'citation-popover-name', textContent: sourceName(references?.get(item.refId)) }))

    const label = el('select', { className: 'ui-select citation-popover-label' })
    for (const [value, text] of LOCATOR_LABELS) label.appendChild(el('option', { value, textContent: text, selected: (item.label || 'page') === value }))
    label.addEventListener('change', () => { items[index].label = label.value })

    const locator = el('input', { type: 'text', value: item.locator || '', placeholder: 'e.g. 42 or 12–14', className: 'ib-input citation-popover-locator' })
    locator.addEventListener('input', () => { items[index].locator = locator.value.trim() })

    row.appendChild(el('div', { className: 'citation-popover-row' }, [label, locator]))

    if (index === 0) {
      const prefix = el('input', { type: 'text', value: item.prefix || '', placeholder: 'Before (see, cf.)', className: 'ib-input' })
      prefix.addEventListener('input', () => { items[0].prefix = prefix.value })
      const suffix = el('input', { type: 'text', value: item.suffix || '', placeholder: 'After (emphasis added)', className: 'ib-input' })
      suffix.addEventListener('input', () => { items[0].suffix = suffix.value })
      row.appendChild(el('div', { className: 'citation-popover-row' }, [prefix, suffix]))
      const omit = el('input', { type: 'checkbox', className: 'ib-check-input', checked: Boolean(item.suppressAuthor) })
      omit.addEventListener('change', () => { items[0].suppressAuthor = omit.checked })
      const box = el('span', { className: 'ib-check-box' }, [iconElement('check', { size: 12 })])
      box.setAttribute('aria-hidden', 'true')
      row.appendChild(el('label', { className: 'ib-check' }, [omit, box, el('span', { className: 'ib-check-label', textContent: 'Leave out the author (named in the sentence)' })]))
    }
    form.appendChild(row)
  })

  // Button's markup (src/ui/Button.jsx), by hand.
  const button = (variant, props) => {
    const node = el('button', { type: 'button', ...props, className: `ui-button ${props.className}` })
    node.dataset.variant = variant
    node.dataset.size = 'capsule'
    return node
  }
  const reveal = button('plain', { className: 'citation-popover-link', textContent: 'Show in References' })
  reveal.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent(CITATION_REVEAL_EVENT, { detail: { refId: items[0]?.refId } }))
    closeCitationPopover()
  })
  const remove = button('destructive', { className: 'citation-popover-remove', textContent: 'Remove' })
  remove.addEventListener('click', () => {
    editor.chain().focus().setCitationItems(pos, []).run()
    closeCitationPopover()
  })
  const done = button('filled', { type: 'submit', className: 'citation-popover-done', textContent: 'Done' })
  form.appendChild(el('div', { className: 'citation-popover-actions' }, [reveal, remove, done]))

  const apply = () => {
    const current = editor.state.doc.nodeAt(pos)
    if (current?.type.name !== 'citation') return
    editor.chain().setCitationItems(pos, items).run()
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    apply()
    closeCitationPopover()
    editor.commands.focus()
  })

  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeCitationPopover()
      editor.commands.focus()
    } else {
      trapTab(event, form)
    }
  }
  const onOutside = (event) => {
    if (form.contains(event.target) || anchor.contains(event.target)) return
    apply()
    closeCitationPopover()
  }

  document.body.appendChild(form)
  const rect = anchor.getBoundingClientRect()
  const width = form.offsetWidth || 300
  form.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2))}px`
  form.style.top = `${rect.bottom + 8}px`
  form.addEventListener('keydown', onKey)
  setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0)
  form.querySelector('.citation-popover-locator')?.focus()

  open = {
    teardown() {
      document.removeEventListener('mousedown', onOutside, true)
      // It leaves the way it came (Popover.css), unless motion is reduced.
      if (!window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches) {
        form.remove()
        return
      }
      form.inert = true
      form.classList.add('is-leaving')
      form.addEventListener('animationend', () => form.remove(), { once: true })
      setTimeout(() => form.remove(), 400)
    },
  }
}
