/**
 * cardTags.js — name tags on a canvas card that isn't being edited. Such a card is
 * static HTML (CanvasTextNode), so there are no decorations: the tags are written into
 * the HTML as the same `.entity-mention` spans the editor draws, and behave the same
 * (lib/entityLinks.js). A card being edited is an editor, and EntityMentions tags it.
 *
 * Each paragraph or heading is read whole, so a name at a sentence's start is judged as
 * in a document (nameContext.ts). A name split across formatting is left untagged.
 */
import { useSyncExternalStore } from 'react'
import { linkHint } from '../lib/entityLinks'
import { getMarkVisibility, onMarkVisibilityChange } from '../lib/markVisibility'
import { isNameContextReady, onNameContextReady } from '../lib/nameContext'
import { inkColor } from '../lib/palette'
import { getNameIndex, onStoryEntriesChange, tagMentions } from '../lib/storyEntries'

const BLOCKS = 'p, h1, h2, h3, h4, h5, h6'

/** The text nodes of a block, with where each starts in the block's text. Code is skipped. */
function textNodesOf(block) {
  const nodes = []
  let text = ''
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest('code, pre') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push({ node, start: text.length })
    text += node.data
  }
  return { nodes, text }
}

function tagFor(text, entry) {
  const span = document.createElement('span')
  span.className = 'entity-mention'
  span.setAttribute('data-entity-path', entry.path)
  span.title = `${linkHint()} to open ${entry.name}`
  span.style.setProperty('--entity-ink', inkColor(entry.ink))
  span.textContent = text
  return span
}

/** `html` with every mention of a story entry wrapped as a tag. */
export function tagCardHtml(html, index, exceptPath = null) {
  if (!index?.pattern || !html) return html
  const template = document.createElement('template')
  template.innerHTML = html
  let changed = false
  for (const block of template.content.querySelectorAll(BLOCKS)) {
    const { nodes, text } = textNodesOf(block)
    const { mentions } = tagMentions(text, index, exceptPath)
    // Last first, so splitting a node leaves the earlier offsets where they were.
    for (const mention of [...mentions].reverse()) {
      const owner = nodes.findLast((item) => item.start <= mention.from)
      if (!owner || mention.to > owner.start + owner.node.data.length) continue
      const named = owner.node.splitText(mention.from - owner.start)
      named.splitText(mention.to - mention.from)
      named.replaceWith(tagFor(named.data, mention.entry))
      changed = true
    }
  }
  return changed ? template.innerHTML : html
}

/* ---------------- what a card's tags depend on ---------------- */

const subscribe = (listener) => {
  const offs = [onStoryEntriesChange(listener), onMarkVisibilityChange(listener), onNameContextReady(listener)]
  return () => offs.forEach((off) => off())
}

// One value per change of any input, so a card re-renders exactly when its tags might.
let snapshot = null
const getSnapshot = () => {
  const index = getMarkVisibility().names ? getNameIndex() : null
  const ready = isNameContextReady()
  if (!snapshot || snapshot.index !== index || snapshot.ready !== ready) snapshot = { index, ready }
  return snapshot
}

/** The names to tag on a card (null while names are hidden), re-rendering as they change. */
export function useCardNameIndex() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot).index
}
