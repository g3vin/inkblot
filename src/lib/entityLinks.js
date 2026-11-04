/**
 * entityLinks.js — what a name tag does when pointed at or clicked, wherever it is
 * drawn: in a document (EntityMentions.js) or on a canvas card, live or static
 * (canvas/cardTags.js). Every tag is an element with `data-entity-path`.
 *
 *   - ⌘-click (Ctrl-click off macOS) opens the entry, ⌥ beside. The tag first asks the
 *     surface it is on (ENTITY_OPEN_EVENT, bubbling): a canvas opens it in its own pane.
 *     Unanswered, a document pane opens it through the bridge.
 *   - Resting on a tag shows its card (EntityPreview.jsx, on ENTITY_PREVIEW_EVENT).
 */
import { editorRegistry, shellBridge } from '../bridge'
import { isMacPlatform } from './keybindings'

/** `detail: { path, beside }`, bubbling from the tag. Cancel it to say it was handled. */
export const ENTITY_OPEN_EVENT = 'inkblot:entity-open'
/** On window. `detail: { path, rect }` to show a tag's card; `{ path: null }` to let it go. */
export const ENTITY_PREVIEW_EVENT = 'inkblot:entity-preview'

export const TAG_SELECTOR = '.entity-mention[data-entity-path]'

export const isLinkClick = (event) => (isMacPlatform() ? event.metaKey : event.ctrlKey)

export const linkHint = () => (isMacPlatform() ? '⌘-click' : 'Ctrl-click')

/** The pane an element is drawn in: the split's second, or else the first. */
export const paneOfElement = (element) => (element?.closest?.('.secondary-pane') ? 'secondary' : 'primary')

/**
 * The pane an editor's view is in (read off the page, so a canvas card's editor answers
 * too), and the document it shows, from the editor registry.
 */
export function paneOf(view) {
  for (const target of ['primary', 'secondary', 'canvasCard']) {
    const resolved = editorRegistry.resolve(target)
    if (resolved && resolved.editor?.view === view) return { pane: paneOfElement(view.dom), docPath: resolved.docPath }
  }
  return { pane: paneOfElement(view.dom), docPath: null }
}

/** Open `path` from a document pane: in it, or beside it. */
export function openFromPane(pane, path, beside) {
  if (!beside) {
    shellBridge.send('openDocument', { path, pane })
    return
  }
  const splitShown = Boolean(editorRegistry.resolve('secondary')?.docPath)
  if (pane === 'secondary') shellBridge.send('openDocument', { path, pane: 'primary' })
  else if (splitShown) shellBridge.send('openDocument', { path, pane: 'secondary' })
  else shellBridge.send('openInSplit', { docPath: path, orientation: 'columns' })
}

/**
 * A mousedown on a tag: opens its entry when it is a link click, and says whether it
 * did. `fallback(path, beside)` runs when no surface answered ENTITY_OPEN_EVENT.
 */
export function openTagFromEvent(event, fallback) {
  if (event.button !== 0 || !isLinkClick(event)) return false
  const tag = event.target?.closest?.(TAG_SELECTOR)
  if (!tag) return false
  event.preventDefault()
  event.stopPropagation()
  const path = tag.getAttribute('data-entity-path')
  const beside = event.altKey
  const asked = new CustomEvent(ENTITY_OPEN_EVENT, { bubbles: true, cancelable: true, detail: { path, beside } })
  if (tag.dispatchEvent(asked)) fallback?.(path, beside)
  endPreview()
  return true
}

/* ---------------- the hover card ---------------- */

let shown = null

/** Pointer over something: show the card of the tag under it, or let the last one go. */
export function previewTagAt(target) {
  const tag = target?.closest?.(TAG_SELECTOR) || null
  if (tag === shown) return
  shown = tag
  if (!tag) {
    window.dispatchEvent(new CustomEvent(ENTITY_PREVIEW_EVENT, { detail: { path: null } }))
    return
  }
  const rect = tag.getBoundingClientRect()
  window.dispatchEvent(new CustomEvent(ENTITY_PREVIEW_EVENT, {
    detail: { path: tag.getAttribute('data-entity-path'), rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } },
  }))
}

export function endPreview() {
  if (!shown) return
  shown = null
  window.dispatchEvent(new CustomEvent(ENTITY_PREVIEW_EVENT, { detail: { path: null } }))
}
