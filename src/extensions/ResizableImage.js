import { Image } from '@tiptap/extension-image'
import { NodeSelection } from '@tiptap/pm/state'

const MIN_WIDTH = 80

const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: element => element.getAttribute('data-width') || element.getAttribute('width'),
        renderHTML: attributes => {
          if (!attributes.width) return {}
          return {
            'data-width': attributes.width,
            width: attributes.width,
          }
        },
      },
    }
  },

  addNodeView() {
    return ({ node, updateAttributes, getPos, view }) => {
      const container = document.createElement('span')
      container.className = 'image-node'

      const img = document.createElement('img')
      img.src = node.attrs.src
      img.alt = node.attrs.alt || ''
      img.draggable = false
      if (node.attrs.width) {
        img.style.width = `${node.attrs.width}px`
      }
      img.style.height = 'auto'

      const handle = document.createElement('span')
      handle.className = 'image-resize-handle'
      handle.style.display = 'none'

      let startX = 0
      let startWidth = 0

      const onPointerDown = (event) => {
        event.preventDefault()
        startX = event.clientX
        startWidth = img.getBoundingClientRect().width

        const onPointerMove = (moveEvent) => {
          const delta = moveEvent.clientX - startX
          const nextWidth = Math.max(MIN_WIDTH, startWidth + delta)
          updateAttributes({ width: Math.round(nextWidth) })
        }

        const onPointerUp = () => {
          window.removeEventListener('pointermove', onPointerMove)
          window.removeEventListener('pointerup', onPointerUp)
        }

        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
      }

      handle.addEventListener('pointerdown', onPointerDown)

      const onImagePointerDown = (event) => {
        event.preventDefault()
        event.stopPropagation()
        const pos = typeof getPos === 'function' ? getPos() : null
        if (pos != null) {
          const { state, dispatch } = view
          dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)))
        }
      }

      img.addEventListener('pointerdown', onImagePointerDown)

      container.appendChild(img)
      container.appendChild(handle)

      return {
        dom: container,
        selectNode: () => {
          container.classList.add('is-selected')
          handle.style.display = 'block'
        },
        deselectNode: () => {
          container.classList.remove('is-selected')
          handle.style.display = 'none'
        },
        stopEvent: (event) => {
          return event.target === handle
        },
        update: (updatedNode) => {
          if (updatedNode.type.name !== node.type.name) return false
          img.src = updatedNode.attrs.src
          img.alt = updatedNode.attrs.alt || ''
          if (updatedNode.attrs.width) {
            img.style.width = `${updatedNode.attrs.width}px`
          } else {
            img.style.width = ''
          }
          return true
        },
        destroy: () => {
          handle.removeEventListener('pointerdown', onPointerDown)
          img.removeEventListener('pointerdown', onImagePointerDown)
        },
      }
    }
  },
})

export default ResizableImage
