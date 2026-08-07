/**
 * CanvasGroupLabel.jsx — the name chip on a group, and its inline rename.
 *
 * Renaming reuses `editingNodeId`, the same single-value slot a live text card
 * uses (invariant 5: only one thing is being edited at a time). A group's label is
 * plain text, so this is an <input>, not an editor — but the commit-on-blur shape
 * matches CanvasCardEditor's, so a rename is likewise a single undo step.
 */
import { useEffect, useRef, useState } from 'react'

export default function CanvasGroupLabel({ node, editing, onStartEditing, onCommit, onExit }) {
  const [value, setValue] = useState(node.label || '')
  const inputRef = useRef(null)

  useEffect(() => {
    if (!editing) return
    setValue(node.label || '')
    // Select the whole name, so typing replaces it — the usual rename behavior.
    const input = inputRef.current
    input?.focus()
    input?.select()
  }, [editing, node.label])

  const commit = () => {
    const label = value.trim()
    if (label !== (node.label || '')) onCommit?.(node.id, label)
    onExit?.()
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="canvas-group-label canvas-group-label-input"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onExit?.()
          }
          // The surface's keydown handler already bails on text fields, but the
          // input must also keep its own keys away from the node beneath it.
          event.stopPropagation()
        }}
        // Without this the press starts a drag of the group instead of placing a
        // caret in the field.
        onPointerDown={(event) => event.stopPropagation()}
      />
    )
  }

  return (
    <div
      className="canvas-group-label"
      onDoubleClick={(event) => {
        event.stopPropagation()
        onStartEditing(node.id)
      }}
    >
      {node.label || 'Group'}
    </div>
  )
}
