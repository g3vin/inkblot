/**
 * CanvasNode.jsx — one node on the canvas: chrome, selection, resize handles.
 *
 * Memoized on the node object. The reducer preserves identity for untouched
 * nodes, so dragging one card does not re-render the other forty-nine.
 *
 * Positioned with a transform rather than left/top: useCanvasDrag overwrites
 * that transform directly during a gesture, and transforms don't trigger layout.
 */
import { memo, useCallback } from 'react'
import { EDGE_SIDES } from '../lib/canvasGeometry'
import { resolveCanvasColor } from '../lib/canvasModel'
import { isImagePath } from '../lib/assets'
import { nodeTransform, RESIZE_HANDLES } from './useCanvasDrag'
import CanvasTextNode from './CanvasTextNode'
import CanvasFileNode from './CanvasFileNode'
import CanvasLinkNode from './CanvasLinkNode'
import CanvasGroupLabel from './CanvasGroupLabel'

/** A file node is a document card unless it points at an image. */
const isDocNode = (node) => node.type === 'file' && !isImagePath(node.file)

function CanvasNodeInner({
  node,
  projectName,
  selected,
  editing,
  locked,
  registerNodeEl,
  setActiveEditor,
  onPointerDown,
  onResizePointerDown,
  onConnectPointerDown,
  onStartEditing,
  onCommitText,
  onExitEditing,
  onOpenDoc,
  onCommitGroupLabel,
}) {
  const ref = useCallback(
    (el) => registerNodeEl(node.id, el),
    [node.id, registerNodeEl]
  )

  const isGroup = node.type === 'group'

  const handleDoubleClick = useCallback(
    (event) => {
      if (editing) return

      // Read mode: a document card still OPENS on double-click (that is reading), but
      // a text card must not drop into an editor.
      if (locked && node.type === 'text') return

      if (node.type === 'text') {
        event.stopPropagation()
        onStartEditing(node.id)
        return
      }

      // A document card is a window onto a real document — double-click opens it
      // in the pane rather than trying to edit it in place.
      if (isDocNode(node)) {
        event.stopPropagation()
        onOpenDoc?.(node)
      }
    },
    [editing, locked, node, onOpenDoc, onStartEditing]
  )

  return (
    <div
      ref={ref}
      className={`canvas-node canvas-node-${node.type}${selected ? ' is-selected' : ''}${
        editing ? ' is-editing' : ''
      }`}
      data-node-id={node.id}
      style={{
        transform: nodeTransform(node),
        width: `${node.width}px`,
        height: `${node.height}px`,
        '--node-color': resolveCanvasColor(node.color),
      }}
      // A card being edited must not also be draggable — the pointer belongs to
      // text selection until the user leaves the card.
      onPointerDown={editing ? undefined : (event) => onPointerDown(event, node)}
      onDoubleClick={handleDoubleClick}
    >
      {node.type === 'text' ? (
        <CanvasTextNode
          node={node}
          editing={editing}
          setActiveEditor={setActiveEditor}
          onCommit={(patch) => onCommitText(node.id, patch)}
          onExit={onExitEditing}
        />
      ) : null}

      {node.type === 'file' ? <CanvasFileNode node={node} projectName={projectName} /> : null}

      {node.type === 'link' ? <CanvasLinkNode node={node} /> : null}

      {isGroup ? (
        <CanvasGroupLabel
          node={node}
          editing={editing}
          onStartEditing={onStartEditing}
          onCommit={onCommitGroupLabel}
          onExit={onExitEditing}
        />
      ) : null}

      {/*
        Resize zones: invisible strips lying along the card's border, not the little
        boxes that used to appear on selection. You resize by grabbing the edge, the
        way you would anywhere else, so nothing has to be shown to advertise it.

        Rendered BEFORE the ports on purpose: a port sits at the midpoint of each
        side, right on top of an edge strip, and the later sibling wins the pointer.
        Reverse these two and the ports become ungrabbable.
      */}
      {!editing && !locked
        ? RESIZE_HANDLES.map((handle) => (
            <span
              key={handle}
              className={`canvas-resize-handle canvas-resize-${handle}`}
              data-handle={handle}
              onPointerDown={(event) => onResizePointerDown(event, node, handle)}
            />
          ))
        : null}

      {/* Connection ports. Always rendered (CSS reveals them on hover or select)
          so an arrow can be dragged out without selecting the card first. */}
      {!editing && !isGroup && !locked
        ? EDGE_SIDES.map((side) => (
            <span
              key={side}
              className={`canvas-port canvas-port-${side}`}
              data-port-side={side}
              onPointerDown={(event) => onConnectPointerDown(event, node, side)}
            />
          ))
        : null}
    </div>
  )
}

export default memo(CanvasNodeInner)
