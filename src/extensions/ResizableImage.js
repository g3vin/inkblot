/**
 * ResizableImage.js — Image node with in-editor editing tools.
 *
 * Extends TipTap's Image with width/rotation/flip/align/layout/crop
 * attributes (all serialized as data-* so documents round-trip through
 * HTML), and a DOM node view that shows, when the image is selected, a
 * floating toolbar (crop, rotate, flip, layout mode) plus a drag handle
 * for resizing. Cropping is non-destructive: the crop rectangle is stored
 * as fractional coordinates and applied by offsetting the img inside a
 * fixed-aspect viewport.
 */
import { Image } from '@tiptap/extension-image'
import { NodeSelection } from '@tiptap/pm/state'
import iconElement from '../ui/iconElement.js'

const resizeIcon = () => {
  const icon = iconElement('resize')
  icon.classList.add('resize-corner-icon')
  return icon
}

const MIN_WIDTH = 80
const MIN_CROP_SIZE = 0.08
const DEFAULT_CROP = {
  cropX: 0,
  cropY: 0,
  cropWidth: 1,
  cropHeight: 1,
}
const VALID_ALIGNMENTS = new Set(['left', 'center', 'right'])
// `page` has a page to itself, fitted to the text block; `bleed` fills the page to past
// its trimmed edges (typeset pages and print only: elsewhere both are a block).
const VALID_LAYOUTS = new Set(['inline', 'block', 'wrap-left', 'wrap-right', 'page', 'bleed'])

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const parseNumber = (value, fallback) => {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const parseBoolean = (value) => value === true || value === 'true'

const normalizeRotation = (value) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return 0
  return ((Math.round(parsed / 90) * 90) % 360 + 360) % 360
}

const normalizeAlignment = (value) => (
  VALID_ALIGNMENTS.has(value) ? value : 'left'
)

const normalizeLayout = (value) => (
  VALID_LAYOUTS.has(value) ? value : 'inline'
)

/** Clamp crop attrs to a valid rectangle fully inside the image (fractions of width/height). */
const normalizeCrop = (attrs = {}) => {
  const cropX = clamp(parseNumber(attrs.cropX, DEFAULT_CROP.cropX), 0, 1)
  const cropY = clamp(parseNumber(attrs.cropY, DEFAULT_CROP.cropY), 0, 1)
  const cropWidth = clamp(parseNumber(attrs.cropWidth, DEFAULT_CROP.cropWidth), MIN_CROP_SIZE, 1)
  const cropHeight = clamp(parseNumber(attrs.cropHeight, DEFAULT_CROP.cropHeight), MIN_CROP_SIZE, 1)

  return {
    cropX: clamp(cropX, 0, 1 - cropWidth),
    cropY: clamp(cropY, 0, 1 - cropHeight),
    cropWidth,
    cropHeight,
  }
}

const cropIsFullFrame = (crop) => (
  crop.cropX === 0 &&
  crop.cropY === 0 &&
  crop.cropWidth === 1 &&
  crop.cropHeight === 1
)

const makeButton = (content, title, onClick) => {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'image-tool-button'
  if (typeof content === 'string') {
    button.textContent = content
  } else {
    button.classList.add('image-tool-button-icon-only')
    button.appendChild(content)
  }
  button.title = title
  button.setAttribute('aria-label', title)
  button.contentEditable = 'false'
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    event.stopPropagation()
  })
  button.addEventListener('click', onClick)
  return button
}

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
      rotation: {
        default: 0,
        parseHTML: element => normalizeRotation(element.getAttribute('data-rotation')),
        renderHTML: attributes => {
          const rotation = normalizeRotation(attributes.rotation)
          return rotation ? { 'data-rotation': rotation } : {}
        },
      },
      flipX: {
        default: false,
        parseHTML: element => parseBoolean(element.getAttribute('data-flip-x')),
        renderHTML: attributes => attributes.flipX ? { 'data-flip-x': 'true' } : {},
      },
      flipY: {
        default: false,
        parseHTML: element => parseBoolean(element.getAttribute('data-flip-y')),
        renderHTML: attributes => attributes.flipY ? { 'data-flip-y': 'true' } : {},
      },
      align: {
        default: 'left',
        parseHTML: element => normalizeAlignment(element.getAttribute('data-align')),
        renderHTML: attributes => {
          const align = normalizeAlignment(attributes.align)
          return align !== 'left' ? { 'data-align': align } : {}
        },
      },
      layout: {
        default: 'inline',
        parseHTML: element => normalizeLayout(element.getAttribute('data-layout')),
        renderHTML: attributes => {
          const layout = normalizeLayout(attributes.layout)
          return layout !== 'inline' ? { 'data-layout': layout } : {}
        },
      },
      cropX: {
        default: 0,
        parseHTML: element => parseNumber(element.getAttribute('data-crop-x'), DEFAULT_CROP.cropX),
        renderHTML: attributes => {
          const crop = normalizeCrop(attributes)
          return cropIsFullFrame(crop) ? {} : { 'data-crop-x': crop.cropX }
        },
      },
      cropY: {
        default: 0,
        parseHTML: element => parseNumber(element.getAttribute('data-crop-y'), DEFAULT_CROP.cropY),
        renderHTML: attributes => {
          const crop = normalizeCrop(attributes)
          return cropIsFullFrame(crop) ? {} : { 'data-crop-y': crop.cropY }
        },
      },
      cropWidth: {
        default: 1,
        parseHTML: element => parseNumber(element.getAttribute('data-crop-width'), DEFAULT_CROP.cropWidth),
        renderHTML: attributes => {
          const crop = normalizeCrop(attributes)
          return cropIsFullFrame(crop) ? {} : { 'data-crop-width': crop.cropWidth }
        },
      },
      cropHeight: {
        default: 1,
        parseHTML: element => parseNumber(element.getAttribute('data-crop-height'), DEFAULT_CROP.cropHeight),
        renderHTML: attributes => {
          const crop = normalizeCrop(attributes)
          return cropIsFullFrame(crop) ? {} : { 'data-crop-height': crop.cropHeight }
        },
      },
      cropAspect: {
        default: null,
        parseHTML: element => element.getAttribute('data-crop-aspect'),
        renderHTML: attributes => attributes.cropAspect ? { 'data-crop-aspect': attributes.cropAspect } : {},
      },
    }
  },

  addNodeView() {
    return ({ node, getPos, view }) => {
      let currentNode = node
      let isSelected = false
      let isCropping = false
      let draftCrop = normalizeCrop(node.attrs)
      let naturalRatio = null
      let naturalWidth = null
      const disposers = []

      const container = document.createElement('span')
      container.className = 'image-node'
      container.contentEditable = 'false'

      const toolbar = document.createElement('span')
      toolbar.className = 'image-toolbar'
      toolbar.style.display = 'none'
      toolbar.contentEditable = 'false'

      const viewport = document.createElement('span')
      viewport.className = 'image-viewport'
      viewport.contentEditable = 'false'

      const img = document.createElement('img')
      img.src = node.attrs.src
      img.alt = node.attrs.alt || ''
      img.draggable = false

      const cropOverlay = document.createElement('span')
      cropOverlay.className = 'image-crop-overlay'
      cropOverlay.style.display = 'none'
      cropOverlay.contentEditable = 'false'
      let layoutSelect = null

      const cropBox = document.createElement('span')
      cropBox.className = 'image-crop-box'
      cropBox.contentEditable = 'false'

      const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((handleName) => {
        const handle = document.createElement('span')
        handle.className = `image-crop-handle image-crop-handle-${handleName}`
        handle.dataset.handle = handleName
        handle.contentEditable = 'false'
        cropBox.appendChild(handle)
        return handle
      })

      const resizeHandle = document.createElement('span')
      resizeHandle.className = 'image-resize-handle'
      resizeHandle.style.display = 'none'
      resizeHandle.contentEditable = 'false'
      resizeHandle.appendChild(resizeIcon())

      const selectImage = () => {
        const pos = typeof getPos === 'function' ? getPos() : null
        if (pos == null) return
        const { state, dispatch } = view
        dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)))
      }

      // Write attribute changes into the document and keep the node selected.
      const commitAttributes = (attrs) => {
        const pos = typeof getPos === 'function' ? getPos() : null
        if (pos == null) return
        const nextAttrs = {
          ...currentNode.attrs,
          ...attrs,
        }
        const { state, dispatch } = view
        const tr = state.tr.setNodeMarkup(pos, undefined, nextAttrs)
        tr.setSelection(NodeSelection.create(tr.doc, pos)).scrollIntoView()
        dispatch(tr)
      }

      const updateToolbarState = () => {
        const attrs = currentNode.attrs

        if (layoutSelect) layoutSelect.value = normalizeLayout(attrs.layout)
        toolbar.querySelector('[data-action="crop"]')?.classList.toggle('active', isCropping)
        toolbar.querySelector('[data-action="flip-x"]')?.classList.toggle('active', Boolean(attrs.flipX))
        toolbar.querySelector('[data-action="flip-y"]')?.classList.toggle('active', Boolean(attrs.flipY))
      }

      const setCropBoxStyle = () => {
        cropBox.style.left = `${draftCrop.cropX * 100}%`
        cropBox.style.top = `${draftCrop.cropY * 100}%`
        cropBox.style.width = `${draftCrop.cropWidth * 100}%`
        cropBox.style.height = `${draftCrop.cropHeight * 100}%`
      }

      const syncCropAspectAttr = (crop) => {
        if (!naturalRatio) return null
        return (naturalRatio * crop.cropWidth / crop.cropHeight).toFixed(4)
      }

      const setCropMode = (nextIsCropping) => {
        isCropping = nextIsCropping
        draftCrop = normalizeCrop(currentNode.attrs)
        container.classList.toggle('is-cropping', isCropping)
        cropOverlay.style.display = isCropping ? 'block' : 'none'
        resizeHandle.style.display = isSelected && !isCropping ? 'inline-flex' : 'none'
        setCropBoxStyle()
        syncView()
      }

      const applyCrop = () => {
        const crop = normalizeCrop(draftCrop)
        commitAttributes({
          ...crop,
          cropAspect: syncCropAspectAttr(crop),
        })
        setCropMode(false)
      }

      const resetCrop = () => {
        draftCrop = { ...DEFAULT_CROP }
        setCropBoxStyle()
      }

      const makeToolButton = (label, title, action, extraClass = '') => {
        const button = makeButton(label, title, (event) => {
          event.preventDefault()
          event.stopPropagation()
          action()
        })
        if (extraClass) button.classList.add(extraClass)
        return button
      }

      const cropButton = makeToolButton(iconElement('crop'), 'Crop image', () => setCropMode(!isCropping))
      cropButton.dataset.action = 'crop'
      const applyCropButton = makeToolButton('Apply', 'Apply crop', applyCrop, 'image-crop-action')
      const cancelCropButton = makeToolButton('Cancel', 'Cancel crop', () => setCropMode(false), 'image-crop-action')
      const resetCropButton = makeToolButton('Reset', 'Reset crop frame', resetCrop, 'image-crop-action')

      const rotateLeftButton = makeToolButton('↺', 'Rotate left', () => {
        commitAttributes({ rotation: normalizeRotation(currentNode.attrs.rotation - 90) })
      })
      const rotateRightButton = makeToolButton('↻', 'Rotate right', () => {
        commitAttributes({ rotation: normalizeRotation(currentNode.attrs.rotation + 90) })
      })
      const flipHorizontalButton = makeToolButton(
        iconElement('flip-horizontal'),
        'Flip horizontally',
        () => {
          commitAttributes({ flipX: !currentNode.attrs.flipX })
        },
      )
      flipHorizontalButton.dataset.action = 'flip-x'

      const flipVerticalButton = makeToolButton(
        iconElement('flip-vertical'),
        'Flip vertically',
        () => {
          commitAttributes({ flipY: !currentNode.attrs.flipY })
        },
      )
      flipVerticalButton.dataset.action = 'flip-y'

      layoutSelect = document.createElement('select')
      layoutSelect.className = 'image-tool-select'
      layoutSelect.title = 'Layer'
      layoutSelect.setAttribute('aria-label', 'Layer')
      layoutSelect.contentEditable = 'false'
      ;[
        ['inline', 'Inline'],
        ['block', 'Block'],
        ['wrap-left', 'Wrap L'],
        ['wrap-right', 'Wrap R'],
        ['page', 'Full Page'],
        ['bleed', 'Bleed'],
      ].forEach(([value, label]) => {
        const option = document.createElement('option')
        option.value = value
        option.textContent = label
        layoutSelect.appendChild(option)
      })
      const onLayoutChange = (event) => {
        event.preventDefault()
        event.stopPropagation()
        const layout = normalizeLayout(layoutSelect.value)
        commitAttributes({
          layout,
          align: layout === 'wrap-right' ? 'right' : layout === 'wrap-left' ? 'left' : currentNode.attrs.align,
        })
      }
      const stopLayoutPointer = (event) => {
        event.stopPropagation()
      }
      layoutSelect.addEventListener('pointerdown', stopLayoutPointer)
      layoutSelect.addEventListener('mousedown', stopLayoutPointer)
      layoutSelect.addEventListener('click', stopLayoutPointer)
      layoutSelect.addEventListener('change', onLayoutChange)
      disposers.push(
        () => layoutSelect.removeEventListener('pointerdown', stopLayoutPointer),
        () => layoutSelect.removeEventListener('mousedown', stopLayoutPointer),
        () => layoutSelect.removeEventListener('click', stopLayoutPointer),
        () => layoutSelect.removeEventListener('change', onLayoutChange),
      )

      const addSeparator = () => {
        const separator = document.createElement('span')
        separator.className = 'image-toolbar-separator'
        toolbar.appendChild(separator)
      }

      toolbar.append(
        cropButton,
        applyCropButton,
        resetCropButton,
        cancelCropButton,
      )
      addSeparator()
      toolbar.append(rotateLeftButton, rotateRightButton, flipHorizontalButton, flipVerticalButton)
      addSeparator()
      toolbar.append(layoutSelect)

      const syncCropToolbar = () => {
        toolbar.classList.toggle('is-cropping', isCropping)
        applyCropButton.style.display = isCropping ? '' : 'none'
        resetCropButton.style.display = isCropping ? '' : 'none'
        cancelCropButton.style.display = isCropping ? '' : 'none'
      }

      // Re-render the node view from current attrs: container classes/width,
      // viewport aspect ratio, and the img's crop offset + rotate/flip transform.
      const syncView = () => {
        const attrs = currentNode.attrs
        const crop = normalizeCrop(attrs)
        const displayedCrop = isCropping ? { ...DEFAULT_CROP } : crop
        const rotation = normalizeRotation(attrs.rotation)
        const layout = normalizeLayout(attrs.layout)
        const align = normalizeAlignment(attrs.align)
        const transformScaleX = attrs.flipX ? -1 : 1
        const transformScaleY = attrs.flipY ? -1 : 1
        const width = parseNumber(attrs.width, null)
        const fallbackWidth = naturalWidth || MIN_WIDTH
        const visibleRatio = naturalRatio
          ? naturalRatio * displayedCrop.cropWidth / displayedCrop.cropHeight
          : parseNumber(attrs.cropAspect, null)
        const layoutRatio = rotation === 90 || rotation === 270
          ? (visibleRatio ? 1 / visibleRatio : null)
          : visibleRatio

        container.className = [
          'image-node',
          `image-layout-${layout}`,
          `image-align-${align}`,
          isSelected ? 'is-selected' : '',
          isCropping ? 'is-cropping' : '',
        ].filter(Boolean).join(' ')
        container.style.width = `${width || fallbackWidth}px`
        // Its shape, for a full-page picture fitted to the text block (PrintTypography.css).
        if (layoutRatio) container.style.setProperty('--img-ratio', String(layoutRatio))

        if (layoutRatio) {
          viewport.style.aspectRatio = `${layoutRatio}`
        } else {
          viewport.style.aspectRatio = ''
        }

        img.src = attrs.src
        img.alt = attrs.alt || ''
        img.style.width = `${100 / displayedCrop.cropWidth}%`
        img.style.height = `${100 / displayedCrop.cropHeight}%`
        img.style.left = `${-(displayedCrop.cropX / displayedCrop.cropWidth) * 100}%`
        img.style.top = `${-(displayedCrop.cropY / displayedCrop.cropHeight) * 100}%`
        img.style.transform = `rotate(${rotation}deg) scale(${transformScaleX}, ${transformScaleY})`

        syncCropToolbar()
        updateToolbarState()
      }

      const onResizePointerDown = (event) => {
        event.preventDefault()
        event.stopPropagation()
        const startX = event.clientX
        const startWidth = viewport.getBoundingClientRect().width

        const onPointerMove = (moveEvent) => {
          const delta = moveEvent.clientX - startX
          const nextWidth = Math.max(MIN_WIDTH, startWidth + delta)
          commitAttributes({ width: Math.round(nextWidth) })
        }

        const onPointerUp = () => {
          window.removeEventListener('pointermove', onPointerMove)
          window.removeEventListener('pointerup', onPointerUp)
        }

        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
      }

      const onViewportPointerDown = (event) => {
        if (isCropping) return
        event.preventDefault()
        event.stopPropagation()
        selectImage()
      }

      // Drag interactions inside the crop overlay: 'move' shifts the crop
      // rectangle; edge/corner handles resize it (mode comes from data-handle).
      const onCropPointerDown = (event) => {
        if (!isCropping) return
        event.preventDefault()
        event.stopPropagation()

        const mode = event.target?.dataset?.handle || 'move'
        const rect = cropOverlay.getBoundingClientRect()
        const startX = event.clientX
        const startY = event.clientY
        const startCrop = { ...draftCrop }

        const onPointerMove = (moveEvent) => {
          const deltaX = (moveEvent.clientX - startX) / rect.width
          const deltaY = (moveEvent.clientY - startY) / rect.height
          let next = { ...startCrop }

          if (mode === 'move') {
            next.cropX = clamp(startCrop.cropX + deltaX, 0, 1 - startCrop.cropWidth)
            next.cropY = clamp(startCrop.cropY + deltaY, 0, 1 - startCrop.cropHeight)
          } else {
            const affectsWest = mode.includes('w')
            const affectsEast = mode.includes('e')
            const affectsNorth = mode.includes('n')
            const affectsSouth = mode.includes('s')

            if (affectsWest) {
              const right = startCrop.cropX + startCrop.cropWidth
              next.cropX = clamp(startCrop.cropX + deltaX, 0, right - MIN_CROP_SIZE)
              next.cropWidth = right - next.cropX
            }
            if (affectsEast) {
              next.cropWidth = clamp(startCrop.cropWidth + deltaX, MIN_CROP_SIZE, 1 - startCrop.cropX)
            }
            if (affectsNorth) {
              const bottom = startCrop.cropY + startCrop.cropHeight
              next.cropY = clamp(startCrop.cropY + deltaY, 0, bottom - MIN_CROP_SIZE)
              next.cropHeight = bottom - next.cropY
            }
            if (affectsSouth) {
              next.cropHeight = clamp(startCrop.cropHeight + deltaY, MIN_CROP_SIZE, 1 - startCrop.cropY)
            }
          }

          draftCrop = normalizeCrop(next)
          setCropBoxStyle()
        }

        const onPointerUp = () => {
          window.removeEventListener('pointermove', onPointerMove)
          window.removeEventListener('pointerup', onPointerUp)
        }

        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
      }

      const onImageLoad = () => {
        if (img.naturalWidth && img.naturalHeight) {
          naturalWidth = img.naturalWidth
          naturalRatio = img.naturalWidth / img.naturalHeight
          syncView()
        }
      }

      resizeHandle.addEventListener('pointerdown', onResizePointerDown)
      viewport.addEventListener('pointerdown', onViewportPointerDown)
      cropBox.addEventListener('pointerdown', onCropPointerDown)
      img.addEventListener('load', onImageLoad)
      disposers.push(
        () => resizeHandle.removeEventListener('pointerdown', onResizePointerDown),
        () => viewport.removeEventListener('pointerdown', onViewportPointerDown),
        () => cropBox.removeEventListener('pointerdown', onCropPointerDown),
        () => img.removeEventListener('load', onImageLoad),
      )
      handles.forEach((handle) => {
        handle.addEventListener('pointerdown', onCropPointerDown)
        disposers.push(() => handle.removeEventListener('pointerdown', onCropPointerDown))
      })

      viewport.appendChild(img)
      cropOverlay.appendChild(cropBox)
      viewport.appendChild(cropOverlay)
      container.append(toolbar, viewport, resizeHandle)
      syncView()

      return {
        dom: container,
        selectNode: () => {
          isSelected = true
          toolbar.style.display = 'flex'
          resizeHandle.style.display = isCropping ? 'none' : 'inline-flex'
          syncView()
        },
        deselectNode: () => {
          isSelected = false
          toolbar.style.display = 'none'
          resizeHandle.style.display = 'none'
          if (isCropping) {
            setCropMode(false)
          } else {
            syncView()
          }
        },
        stopEvent: (event) => (
          event.target === resizeHandle ||
          toolbar.contains(event.target) ||
          cropOverlay.contains(event.target)
        ),
        update: (updatedNode) => {
          if (updatedNode.type.name !== currentNode.type.name) return false
          currentNode = updatedNode
          syncView()
          return true
        },
        destroy: () => {
          disposers.forEach(dispose => dispose())
        },
      }
    }
  },
})

export default ResizableImage
