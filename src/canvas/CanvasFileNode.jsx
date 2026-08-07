/**
 * CanvasFileNode.jsx — a node pointing at a file.
 *
 * JSON Canvas gives `file` nodes one job: reference a path. Two kinds matter here:
 *   - an image in the project's .assets folder → render it
 *   - a project document → render a read-only preview; double-click opens it
 *
 * The image is loaded through the asset protocol rather than inlined as base64,
 * so the canvas file stays small no matter how many pictures it holds.
 *
 * A document card renders the document's own content as static HTML, the same way
 * a text card renders its stored JSON — never as a live editor. To edit the
 * document you open it (double-click), which is what CanvasNode's handler does.
 */
import { useState } from 'react'
import { isAudioPath, isImagePath } from '../lib/assets'
import { isCanvasDoc } from '../lib/docKind'
import { useAssetUrl } from './useAssetUrl'
import { useDocPreview, filePathToDocPath } from './useDocPreview'
import { useCanvasPreview } from './useCanvasPreview'
import CanvasNoteNode from './CanvasNoteNode'
import CanvasAudioNode from './CanvasAudioNode'

/**
 * A card referencing another CANVAS, drawn as a minimap of its shapes. Obsidian shows
 * a live nested canvas here; a minimap gets you the same recognition for none of the
 * cost, and double-clicking opens the real thing.
 */
function CanvasCanvasNode({ node, projectName }) {
  const docPath = filePathToDocPath(node.file)
  const { status, shapes } = useCanvasPreview(projectName, docPath)
  const title = docPath.split('/').filter(Boolean).pop() || docPath

  return (
    <div className="canvas-doc">
      <div className="canvas-doc-header">
        <span className="canvas-doc-title">{title}</span>
        <span className="canvas-doc-kind">canvas</span>
      </div>

      {status === 'ready' && shapes ? (
        <svg
          className="canvas-minimap"
          viewBox={`${shapes.bounds.x} ${shapes.bounds.y} ${shapes.bounds.width} ${shapes.bounds.height}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          {shapes.edges.map((edge) => (
            <line
              key={edge.id}
              className="canvas-minimap-edge"
              x1={edge.x1}
              y1={edge.y1}
              x2={edge.x2}
              y2={edge.y2}
            />
          ))}
          {shapes.nodes.map((shape) => (
            <rect
              key={shape.id}
              className={`canvas-minimap-node${shape.isGroup ? ' is-group' : ''}`}
              x={shape.x}
              y={shape.y}
              width={shape.width}
              height={shape.height}
              rx="8"
              style={{ '--shape-color': shape.color }}
            />
          ))}
        </svg>
      ) : (
        <div className="canvas-doc-body canvas-doc-empty">
          {status === 'loading' ? '' : null}
          {status === 'empty' ? 'Empty canvas' : null}
          {status === 'missing' ? 'Canvas not found' : null}
        </div>
      )}
    </div>
  )
}

function CanvasDocNode({ node, projectName }) {
  const { status, html, title } = useDocPreview(projectName, node.file)

  return (
    <div className="canvas-doc">
      <div className="canvas-doc-header">
        <span className="canvas-doc-title">{title || node.file}</span>
      </div>

      {status === 'ready' && html ? (
        // `ProseMirror` reuses the editor typography from Editor.css, so a preview
        // looks like the document it points at.
        <div
          className="canvas-doc-body ProseMirror"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div className="canvas-doc-body canvas-doc-empty">
          {status === 'loading' ? '' : null}
          {status === 'missing' ? 'Document not found' : null}
          {status === 'unrenderable' ? 'Preview unavailable' : null}
          {status === 'ready' ? 'Empty document' : null}
        </div>
      )}
    </div>
  )
}

function CanvasImageNode({ node, projectName }) {
  const url = useAssetUrl(projectName, node.file)
  const [failed, setFailed] = useState(false)

  // A project stored in iCloud or OneDrive can have its assets evicted from local
  // disk, in which case the asset URL 404s. Say so rather than showing a blank card.
  if (failed) {
    return (
      <div className="canvas-file-placeholder">
        <span>Image unavailable</span>
        <span className="canvas-file-path">{node.file}</span>
      </div>
    )
  }

  return url ? (
    <img
      className="canvas-image"
      src={url}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
    />
  ) : null
}

export default function CanvasFileNode({ node, projectName }) {
  // A note card is a file node that also names ONE note inside that file — it shows
  // the note, not the document.
  if (node.inkblotNoteId) return <CanvasNoteNode node={node} />

  if (isImagePath(node.file)) return <CanvasImageNode node={node} projectName={projectName} />

  // A standalone voice memo dropped on the board.
  if (isAudioPath(node.file)) return <CanvasAudioNode node={node} projectName={projectName} />

  // A canvas is a document too, but it has no prose to preview — it gets a minimap.
  if (isCanvasDoc(filePathToDocPath(node.file))) {
    return <CanvasCanvasNode node={node} projectName={projectName} />
  }

  return <CanvasDocNode node={node} projectName={projectName} />
}
