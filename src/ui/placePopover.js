/** Where a popover of `size` goes under (or, without room, over) an anchor rect. */
const GAP = 6
const MARGIN = 8

export function placePopover(anchor, size, viewport, align = 'start') {
  let left = align === 'end' ? anchor.right - size.width : align === 'center' ? anchor.left + (anchor.width - size.width) / 2 : anchor.left
  left = Math.max(MARGIN, Math.min(left, viewport.width - size.width - MARGIN))
  let top = anchor.bottom + GAP
  if (top + size.height > viewport.height - MARGIN && anchor.top - GAP - size.height >= MARGIN) {
    top = anchor.top - GAP - size.height
  }
  return { left, top }
}
