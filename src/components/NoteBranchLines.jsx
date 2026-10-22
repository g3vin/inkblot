/**
 * NoteBranchLines — the lines a note's replies hang from, in the notes panel.
 *
 * One path per reply, from the parent card's foot down a line just inside its edge,
 * curving into the middle of the reply's edge. The replies' paths share the run down,
 * so the colour is opaque (overlaps don't darken). Drawn in SVG, measured from the
 * cards as laid out, so a line can draw itself along its length as a hover note's
 * string does (lib/noteReveal; the timings come from NotesPanel).
 *
 * Each path's length goes into `lengths` (by reply id) as it is measured, for the
 * panel to time the next reveal by.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { noteColor } from '../lib/noteUtils'

// Where the line runs, in from the parent's edge, and the radius of its turn.
const TRUNK_IN = 10
const TURN = 8

// Offsets, not client rects: a reply popping in is scaled, and its line must run to
// where it will be, not where the pop has it. The replies' offsets are from their
// container (it is positioned); the parent card is the container's sibling.
const measure = (container) => {
  const parentTile = container.previousElementSibling
  if (!parentTile) return []
  const x = parentTile.offsetLeft - container.offsetLeft + TRUNK_IN
  const top = parentTile.offsetTop + parentTile.offsetHeight - container.offsetTop
  return [...container.children].flatMap((branch) => {
    const tile = branch.querySelector?.(':scope > .note-tile')
    const id = branch.dataset?.noteId
    if (!tile || !id) return []
    const end = tile.offsetLeft
    const mid = tile.offsetTop + tile.offsetHeight / 2
    const turn = Math.max(0, Math.min(TURN, end - x, mid - top))
    const d = `M ${x} ${top} V ${mid - turn} Q ${x} ${mid} ${x + turn} ${mid} H ${end}`
    const length = (mid - turn - top) + turn * 1.6 + (end - x - turn)
    return [{ id, d, length }]
  })
}

export default function NoteBranchLines({ parentColor, childIds, lengths, motionFor }) {
  const [paths, setPaths] = useState([])
  const svgRef = useRef(null)
  const key = childIds.join(' ')

  useLayoutEffect(() => {
    // Drawn inside the replies' container, out of its flow.
    const container = svgRef.current?.parentElement
    if (!container) return undefined
    const update = () => {
      const next = measure(container)
      next.forEach(({ id, length }) => lengths.set(id, length))
      setPaths((current) => (
        current.length === next.length && current.every((path, i) => path.d === next[i].d) ? current : next
      ))
    }
    update()
    // A reply grows as it is written, and the panel narrows with the sidebar.
    const observer = new ResizeObserver(update)
    observer.observe(container)
    const parentTile = container.previousElementSibling
    if (parentTile) observer.observe(parentTile)
    container.querySelectorAll(':scope > .note-branch > .note-tile').forEach((tile) => observer.observe(tile))
    return () => observer.disconnect()
  }, [key, lengths])

  return (
    <svg
      ref={svgRef}
      className="note-branch-lines"
      style={{ '--note-branch-ink': noteColor(parentColor) }}
      aria-hidden="true"
    >
      {paths.map(({ id, d }) => {
        const motion = motionFor(id)
        return (
          <path
            key={id}
            d={d}
            pathLength={1}
            className={`note-branch-line${motion?.state ? ` is-${motion.state}` : ''}`}
            style={motion?.line ? {
              '--string-delay': `${motion.line.delay}ms`,
              '--string-ms': `${motion.line.ms}ms`,
            } : undefined}
          />
        )
      })}
    </svg>
  )
}
