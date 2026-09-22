/**
 * PinterestBoard.js — embedded Pinterest board node.
 *
 * Created automatically when a Pinterest board URL is pasted (see the editor's paste
 * handler / normalizePinterestBoardUrl). This file is the TipTap node: the schema,
 * the paste-to-embed plugin, the node view's DOM, and the right-click menu.
 *
 * The two pieces of the node view that carry state of their own live beside it —
 * pinterestBoardPreview.js, which decides where pins come from, and
 * pinterestBoardCollapse.js, which folds a tall board down. Both are factories
 * rather than modules of functions: the node view closure used to reassign their
 * state (the current URL, whether the board is expanded) from half a dozen
 * callbacks, and a parameter cannot carry a write back out.
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { openPinterest } from '../lib/openPinterest'
import { normalizePinterestBoardUrl } from '../lib/pinterestBoard'
import { createPinterestBoardCollapse } from './pinterestBoardCollapse'
import { createPinterestBoardPreview } from './pinterestBoardPreview'

// Re-exported: the editor's paste handler imports it from here.
export { normalizePinterestBoardUrl }

const PINTEREST_OPEN_WINDOW_EVENT = 'inkblot:pinterest-open-window'
const PINTEREST_COPY_LINK_EVENT = 'inkblot:pinterest-copy-link'

const ensurePinterestMenuBridge = (() => {
  let installed = false

  return () => {
    if (installed) return
    if (typeof window === 'undefined') return

    window.addEventListener(PINTEREST_OPEN_WINDOW_EVENT, async (event) => {
      const url = String(event?.detail?.url || '').trim()
      if (!url) return
      try {
        await openPinterest(url)
      } catch {
        try {
          window.open(url, '_blank', 'noopener,noreferrer')
        } catch {
          // ignore
        }
      }
    })

    window.addEventListener(PINTEREST_COPY_LINK_EVENT, async (event) => {
      const url = String(event?.detail?.url || '').trim()
      if (!url) return
      try {
        await navigator.clipboard.writeText(url)
      } catch {
        // ignore
      }
    })

    installed = true
  }
})()

ensurePinterestMenuBridge()


const PinterestBoard = Node.create({
  name: 'pinterestBoard',

  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  isolating: true,

  addAttributes() {
    return {
      url: {
        default: null,
        parseHTML: element => element.getAttribute('data-url') || null,
        renderHTML: attributes => ({
          'data-url': attributes.url || null,
        }),
      },
      boardWidth: {
        default: 400,
        parseHTML: element => {
          const v = element.getAttribute('data-board-width')
          return v ? Number(v) : 400
        },
        renderHTML: attributes => ({
          'data-board-width': attributes.boardWidth,
        }),
      },
      scaleHeight: {
        default: 320,
        parseHTML: element => {
          const v = element.getAttribute('data-scale-height')
          return v ? Number(v) : 320
        },
        renderHTML: attributes => ({
          'data-scale-height': attributes.scaleHeight,
        }),
      },
      scaleWidth: {
        default: 80,
        parseHTML: element => {
          const v = element.getAttribute('data-scale-width')
          return v ? Number(v) : 80
        },
        renderHTML: attributes => ({
          'data-scale-width': attributes.scaleWidth,
        }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="pinterest-board"]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'pinterest-board',
      }),
    ]
  },

  addCommands() {
    return {
      insertPinterestBoard:
        (attrs) =>
        ({ commands }) => {
          const url = normalizePinterestBoardUrl(attrs?.url)
          if (!url) return false
          return commands.insertContent({
            type: this.name,
            attrs: {
              url,
              boardWidth: attrs?.boardWidth ?? 400,
              scaleHeight: attrs?.scaleHeight ?? 320,
              scaleWidth: attrs?.scaleWidth ?? 80,
            },
          })
        },
    }
  },

  addNodeView() {
    return ({ node }) => {
      const container = document.createElement('div')
      container.className = 'pinterest-board-node'

      const inner = document.createElement('div')
      inner.className = 'pinterest-board-inner'

      const masonry = document.createElement('div')
      masonry.className = 'pinterest-board-masonry'

      const expandHint = document.createElement('div')
      expandHint.className = 'pinterest-board-expand-hint'
      expandHint.textContent = 'Click to expand'

      const link = document.createElement('a')
      link.href = node.attrs.url
      link.target = '_blank'
      link.rel = 'noreferrer'
      link.setAttribute('data-pin-do', 'embedBoard')
      link.setAttribute('data-pin-board-width', String(node.attrs.boardWidth || 400))
      link.setAttribute('data-pin-scale-height', String(node.attrs.scaleHeight || 320))
      link.setAttribute('data-pin-scale-width', String(node.attrs.scaleWidth || 80))

      // Pinterest replaces the <a> with the embed.
      inner.appendChild(link)

      const fallback = document.createElement('div')
      fallback.className = 'pinterest-board-fallback'
      fallback.textContent = 'Loading Pinterest board…'

      const refreshPreviewBtn = document.createElement('button')
      refreshPreviewBtn.type = 'button'
      refreshPreviewBtn.className = 'pinterest-board-refresh-btn'
      refreshPreviewBtn.title = 'Refresh preview'
      refreshPreviewBtn.setAttribute('aria-label', 'Refresh preview')
      refreshPreviewBtn.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M3 12a9 9 0 0 1 15.74-6.26L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-15.74 6.26L3 16" />
          <path d="M3 21v-5h5" />
        </svg>
      `

      container.appendChild(inner)
      container.appendChild(refreshPreviewBtn)
      container.appendChild(fallback)
      container.appendChild(expandHint)

      // Collapse first: the preview machine measures through it, and clears the
      // masonry — which re-measures — while it is still being built.
      const collapse = createPinterestBoardCollapse({ container, expandHint, masonry })

      const preview = createPinterestBoardPreview({
        attachResizeObserver: collapse.attachResizeObserver,
        container,
        fallback,
        initialUrl: node.attrs.url,
        inner,
        link,
        masonry,
        resetExpansion: collapse.resetExpansion,
        updateCollapseState: collapse.updateCollapseState,
      })

      const onTileContextMenu = async (e) => {
        e.preventDefault()
        e.stopPropagation()
        try {
          const { Menu, MenuItem, PredefinedMenuItem } = await import('@tauri-apps/api/menu')
          const openItem = await MenuItem.new({
            text: 'Open in Pinterest window',
            action: () => {
              window.setTimeout(() => {
                window.dispatchEvent(new CustomEvent(PINTEREST_OPEN_WINDOW_EVENT, {
                  detail: { url: preview.getUrl() },
                }))
              }, 0)
            },
          })
          const copyItem = await MenuItem.new({
            text: 'Copy link',
            action: () => {
              window.setTimeout(() => {
                window.dispatchEvent(new CustomEvent(PINTEREST_COPY_LINK_EVENT, {
                  detail: { url: preview.getUrl() },
                }))
              }, 0)
            },
          })
          const separator = await PredefinedMenuItem.new({ item: 'Separator' })
          const menu = await Menu.new({ items: [openItem, separator, copyItem] })
          await menu.popup()
        } catch {
          // ignore
        }
      }

      refreshPreviewBtn.addEventListener('click', preview.onRefreshPreview)
      container.addEventListener('click', collapse.onExpand)
      container.addEventListener('contextmenu', onTileContextMenu)
      expandHint.addEventListener('click', collapse.onExpand)
      collapse.attachSelectionClassObserver()
      document.addEventListener('pointerdown', collapse.onOutsidePointerDown, true)
      document.addEventListener('selectionchange', collapse.onSelectionChange)
      window.addEventListener('blur', collapse.onWindowBlur)

      preview.start()

      return {
        dom: container,
        selectNode: () => {
          container.classList.add('is-selected')
        },
        deselectNode: () => {
          container.classList.remove('is-selected')
          // Keep behavior aligned with editor selection state:
          // if user clicks away/unselects, collapse back.
          collapse.collapseIfExpanded()
        },
        update: (updatedNode) => {
          if (updatedNode.type.name !== node.type.name) return false

          // Update in-place.
          link.href = updatedNode.attrs.url
          link.setAttribute('data-pin-board-width', String(updatedNode.attrs.boardWidth || 400))
          link.setAttribute('data-pin-scale-height', String(updatedNode.attrs.scaleHeight || 320))
          link.setAttribute('data-pin-scale-width', String(updatedNode.attrs.scaleWidth || 80))

          preview.onNodeUrlChanged(updatedNode.attrs.url)
          return true
        },
        destroy: () => {
          preview.destroy()
          refreshPreviewBtn.removeEventListener('click', preview.onRefreshPreview)
          container.removeEventListener('click', collapse.onExpand)
          container.removeEventListener('contextmenu', onTileContextMenu)
          expandHint.removeEventListener('click', collapse.onExpand)
          document.removeEventListener('pointerdown', collapse.onOutsidePointerDown, true)
          document.removeEventListener('selectionchange', collapse.onSelectionChange)
          window.removeEventListener('blur', collapse.onWindowBlur)
          collapse.destroy()
        },
      }
    }
  },

  addProseMirrorPlugins() {
    const key = new PluginKey('pinterestBoardAutoEmbed')

    return [
      new Plugin({
        key,
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some(t => t.docChanged)) return null

          const boardType = newState.schema.nodes.pinterestBoard
          if (!boardType) return null

          let tr = newState.tr
          let modified = false

          newState.doc.descendants((node, pos) => {
            if (node.type.name !== 'paragraph') return

            // Only transform paragraphs that are *just* a URL.
            if (node.content.childCount !== 1) return
            const child = node.firstChild
            if (!child?.isText) return

            const raw = child.text
            if (!raw) return

            const url = normalizePinterestBoardUrl(raw)
            if (!url) return

            // Require that trimming doesn't remove other characters (avoid converting mid-sentence).
            if (raw.trim() !== raw) return

            const from = tr.mapping.map(pos)
            const to = from + node.nodeSize

            const boardNode = boardType.create({
              url,
              boardWidth: 400,
              scaleHeight: 320,
              scaleWidth: 80,
            })

            tr = tr.replaceWith(from, to, boardNode)
            modified = true

            // Don’t descend into replaced content.
            return false
          })

          return modified ? tr : null
        },
      }),
    ]
  },
})

export default PinterestBoard
