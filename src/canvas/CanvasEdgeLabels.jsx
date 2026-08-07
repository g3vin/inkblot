/**
 * CanvasEdgeLabels.jsx — the text sitting on an edge.
 *
 * HTML rather than <svg:text> so labels get real typography, wrapping, and an
 * <input> to edit in place. They live inside the world layer, so they scale with
 * the canvas — which is what Obsidian does, and what makes a zoomed-out canvas
 * read as a diagram rather than a wall of same-size text.
 *
 * An edge with no label renders nothing at all. Double-clicking a bare edge sets
 * `editingEdgeId`, which conjures an empty input on it — that is how an edge gets
 * its first label.
 */
import { memo, useEffect, useRef, useState } from 'react'
import { edgeGeometry } from '../lib/canvasGeometry'

function EdgeLabel({ edge, mid, autoEdit, onCommit, onStopEditing }) {
  const [editing, setEditing] = useState(autoEdit)
  const [draft, setDraft] = useState(edge.label || '')
  const inputRef = useRef(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const stop = () => {
    setEditing(false)
    onStopEditing()
  }

  const commit = () => {
    stop()
    if (draft !== (edge.label || '')) onCommit(edge.id, draft)
  }

  return (
    <div
      className={`canvas-edge-label${editing ? ' is-editing' : ''}`}
      style={{ transform: `translate3d(${mid.x}px, ${mid.y}px, 0) translate(-50%, -50%)` }}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => {
        event.stopPropagation()
        setDraft(edge.label || '')
        setEditing(true)
      }}
    >
      {editing ? (
        <input
          ref={inputRef}
          className="canvas-edge-label-input"
          value={draft}
          placeholder="Label"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              setDraft(edge.label || '')
              stop()
            }
          }}
        />
      ) : (
        edge.label
      )}
    </div>
  )
}

function CanvasEdgeLabelsInner({ state, editingEdgeId, onCommitLabel, onStopEditing }) {
  return state.edgeOrder.map((id) => {
    const edge = state.edges[id]
    const isEditing = id === editingEdgeId
    if (!edge || (!edge.label && !isEditing)) return null

    const geometry = edgeGeometry(edge, state.nodes[edge.fromNode], state.nodes[edge.toNode])
    if (!geometry) return null

    return (
      <EdgeLabel
        // Remount when editing begins so the input mounts already focused.
        key={isEditing ? `${id}-editing` : id}
        edge={edge}
        mid={geometry.mid}
        autoEdit={isEditing}
        onCommit={onCommitLabel}
        onStopEditing={onStopEditing}
      />
    )
  })
}

export default memo(CanvasEdgeLabelsInner)
