/**
 * useCanvasImageImport.js — getting images onto the canvas.
 *
 * Two routes in:
 *   - paste (⌘V) — a normal clipboard event
 *   - dragging a file from Finder — NOT a normal drop event. Tauri's webview
 *     handles OS drags natively and swallows the DOM `drop`, so `dataTransfer.
 *     files` is always empty. The paths only arrive through onDragDropEvent.
 *
 * Both land as JSON Canvas `file` nodes pointing into the project's .assets
 * folder — never base64 inlined.
 */
import { useCallback, useEffect } from 'react'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import {
  assetUrl,
  importAssetFromPath,
  isImagePath,
  measureImage,
  writeAssetFromFile,
  IMAGE_EXTENSIONS_LIST,
} from '../lib/assets'
import { makeFileNode } from '../lib/canvasModel'

// Big photos would otherwise land as a card the size of a building.
const MAX_INITIAL_WIDTH = 420
const CASCADE_STEP = 28

export function useCanvasImageImport({
  projectName,
  surfaceRef,
  screenToWorldAt,
  dispatch,
  selectNode,
  onActivate,
}) {
  /** Turn a stored asset into a node sized to the image's aspect ratio. */
  const addImageNode = useCallback(
    async (relativePath, worldPoint) => {
      const url = await assetUrl(projectName, relativePath)
      const size = await measureImage(url)

      let width = MAX_INITIAL_WIDTH
      let height = Math.round(MAX_INITIAL_WIDTH * 0.66)
      if (size?.width && size?.height) {
        width = Math.min(MAX_INITIAL_WIDTH, size.width)
        height = Math.round((width / size.width) * size.height)
      }

      const node = makeFileNode({
        file: relativePath,
        x: worldPoint.x - width / 2,
        y: worldPoint.y - height / 2,
        width,
        height,
      })

      dispatch({ type: 'nodes/add', nodes: [node] })
      selectNode(node.id)
      return node
    },
    [dispatch, projectName, selectNode]
  )

  /* ---------------- pick from a file dialog ---------------- */

  /**
   * The explicit route in: the toolbar's image button, and the context menu. Paste
   * and OS-drag both need the user to already have the image somewhere; this is the
   * one path that works from a standing start.
   */
  const importImageAt = useCallback(
    async (worldPoint) => {
      if (!projectName) return

      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        multiple: true,
        filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS_LIST }],
      })
      if (!selected) return

      const paths = Array.isArray(selected) ? selected : [selected]

      for (const [index, path] of paths.entries()) {
        try {
          const relativePath = await importAssetFromPath(projectName, path)
          await addImageNode(relativePath, {
            x: worldPoint.x + index * CASCADE_STEP,
            y: worldPoint.y + index * CASCADE_STEP,
          })
        } catch (error) {
          console.error('[canvas] failed to import chosen image:', error)
        }
      }
    },
    [addImageNode, projectName]
  )

  /* ---------------- paste ---------------- */

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface || !projectName) return

    const onPaste = async (event) => {
      // A card being edited handles its own paste — don't steal it.
      const target = event.target
      if (target instanceof HTMLElement && target.closest('[contenteditable="true"], input, textarea')) {
        return
      }

      const files = [...(event.clipboardData?.items || [])]
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter(Boolean)

      if (!files.length) return
      event.preventDefault()
      onActivate?.()

      // Paste lands at the center of the view — there is no cursor to aim at.
      const rect = surface.getBoundingClientRect()
      const center = screenToWorldAt(rect.left + rect.width / 2, rect.top + rect.height / 2)

      for (const [index, file] of files.entries()) {
        try {
          const relativePath = await writeAssetFromFile(projectName, file)
          await addImageNode(relativePath, {
            x: center.x + index * CASCADE_STEP,
            y: center.y + index * CASCADE_STEP,
          })
        } catch (error) {
          console.error('[canvas] failed to import pasted image:', error)
        }
      }
    }

    surface.addEventListener('paste', onPaste)
    return () => surface.removeEventListener('paste', onPaste)
  }, [addImageNode, onActivate, projectName, screenToWorldAt, surfaceRef])

  /* ---------------- drag from the OS ---------------- */

  useEffect(() => {
    if (!projectName) return
    let unlisten = null
    let cancelled = false

    getCurrentWebview()
      .onDragDropEvent(async ({ payload }) => {
        if (payload.type !== 'drop' || !payload.paths?.length) return

        const surface = surfaceRef.current
        if (!surface) return

        // The listener is webview-wide, so a drop meant for another pane (or the
        // file tree) would otherwise land here too. Position is in physical
        // pixels; the DOM works in logical ones.
        const dpr = window.devicePixelRatio || 1
        const clientX = payload.position.x / dpr
        const clientY = payload.position.y / dpr

        const rect = surface.getBoundingClientRect()
        const inside =
          clientX >= rect.left && clientX <= rect.right &&
          clientY >= rect.top && clientY <= rect.bottom
        if (!inside) return

        onActivate?.()
        const point = screenToWorldAt(clientX, clientY)
        const images = payload.paths.filter(isImagePath)

        for (const [index, path] of images.entries()) {
          try {
            const relativePath = await importAssetFromPath(projectName, path)
            await addImageNode(relativePath, {
              x: point.x + index * CASCADE_STEP,
              y: point.y + index * CASCADE_STEP,
            })
          } catch (error) {
            console.error('[canvas] failed to import dropped image:', error)
          }
        }
      })
      .then((fn) => {
        if (cancelled) fn()
        else unlisten = fn
      })
      .catch((error) => console.error('[canvas] could not listen for file drops:', error))

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [addImageNode, onActivate, projectName, screenToWorldAt, surfaceRef])

  return { addImageNode, importImageAt }
}
