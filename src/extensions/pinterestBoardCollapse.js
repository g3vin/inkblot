/**
 * pinterestBoardCollapse.js — a tall board folds down to a click-to-expand card.
 *
 * Owns `expanded` and the two observers that decide when it goes back. A board is
 * collapsed whenever its masonry measures taller than the cut-off, and it stays
 * expanded only while it is the selected node: clicking elsewhere, moving the text
 * selection, or the window losing focus all fold it again. That is three separate
 * sources for one piece of state, which is why it lives in one factory rather than
 * as flags in the node view.
 *
 * The height has to be re-measured rather than computed. Masonry images load late
 * and each one changes the total, so updateCollapseState() runs again on every image
 * load, on a frame after render, and from a ResizeObserver on the masonry itself.
 *
 * A factory, not a module of functions: `expanded` and both observer handles are
 * reassigned from several callbacks, and parameters cannot carry a write back out.
 */
export function createPinterestBoardCollapse({ container, expandHint, masonry }) {
  const COLLAPSE_HEIGHT_PX = 600

  let expanded = false
  let resizeObserver = null
  let selectionClassObserver = null

  const updateCollapseState = () => {
    if (expanded) {
      container.classList.remove('is-collapsed')
      container.classList.add('is-expanded')
      expandHint.style.display = 'none'
      return
    }

    // Only collapse when masonry is actually rendered.
    if (masonry.style.display === 'none' || !masonry.isConnected) {
      container.classList.remove('is-collapsed')
      container.classList.remove('is-expanded')
      expandHint.style.display = 'none'
      return
    }

    const measuredHeight = Math.max(
      masonry.scrollHeight || 0,
      Math.ceil(masonry.getBoundingClientRect().height || 0)
    )

    const tooTall = measuredHeight > COLLAPSE_HEIGHT_PX
    if (tooTall) {
      container.classList.add('is-collapsed')
      container.classList.remove('is-expanded')
      expandHint.style.display = ''
    } else {
      container.classList.remove('is-collapsed')
      container.classList.remove('is-expanded')
      expandHint.style.display = 'none'
    }
  }

  const attachResizeObserver = () => {
    if (resizeObserver) return
    if (typeof ResizeObserver === 'undefined') return
    resizeObserver = new ResizeObserver(() => {
      updateCollapseState()
    })
    try {
      resizeObserver.observe(masonry)
    } catch {
      // ignore
    }
  }

  const onExpand = (e) => {
    // While collapsed, any click inside the board (including images/links)
    // should expand it first.
    if (container.classList.contains('is-collapsed')) {
      e?.preventDefault?.()
      e?.stopPropagation?.()
      expanded = true
      updateCollapseState()
      return
    }

    // When already expanded, don't hijack normal interactions.
  }

  const collapseIfExpanded = () => {
    if (!expanded) return
    expanded = false
    updateCollapseState()
  }

  const attachSelectionClassObserver = () => {
    if (selectionClassObserver) return
    if (typeof MutationObserver === 'undefined') return

    selectionClassObserver = new MutationObserver(() => {
      // Mirror the visual selection state (blue border):
      // when the selected class is removed, collapse.
      if (!container.classList.contains('is-selected')) {
        collapseIfExpanded()
      }
    })

    try {
      selectionClassObserver.observe(container, {
        attributes: true,
        attributeFilter: ['class'],
      })
    } catch {
      // ignore
    }
  }

  const onOutsidePointerDown = (e) => {
    const target = e?.target
    if (!target) return
    if (container.contains(target)) return
    collapseIfExpanded()
  }

  const onSelectionChange = () => {
    // Let ProseMirror apply node selection classes first.
    requestAnimationFrame(() => {
      if (!container.classList.contains('is-selected')) {
        collapseIfExpanded()
      }
    })
  }

  const onWindowBlur = () => {
    collapseIfExpanded()
  }

  container.addEventListener('click', onExpand)

  return {
    attachResizeObserver,
    attachSelectionClassObserver,
    collapseIfExpanded,
    onExpand,
    onOutsidePointerDown,
    onSelectionChange,
    onWindowBlur,
    updateCollapseState,

    // A refresh drops the expansion without re-measuring: the masonry it was
    // measured against is about to be replaced, so collapseIfExpanded() here would
    // measure the outgoing board.
    resetExpansion: () => {
      expanded = false
      container.classList.remove('is-expanded')
    },

    destroy: () => {
      try {
        resizeObserver?.disconnect()
      } catch {
        // ignore
      }
      resizeObserver = null
      try {
        selectionClassObserver?.disconnect()
      } catch {
        // ignore
      }
      selectionClassObserver = null
    },
  }
}
