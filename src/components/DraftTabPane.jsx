/**
 * DraftTabPane.jsx — what a tab shows before it is a document.
 *
 * A draft tab holds no file: nothing is written to disk until the user names it
 * here and picks a kind. Creating goes straight through FileSystem rather than
 * the file tree's inline "new entry" box, because the left sidebar may be
 * collapsed — the pane the user is looking at has to be able to finish the job
 * on its own. Once created, the tab adopts the new document (see Editor.jsx).
 */
import { useState } from 'react'
import SFIcon from './SFIcon'
import { documentExists, saveDocument } from '../lib/FileSystem'
import { saveCanvasDocument } from '../lib/canvasFileSystem'
import { createEmptyCanvas } from '../lib/canvasModel'
import { stripCanvasSuffix, withCanvasSuffix } from '../lib/docKind'

const KINDS = [
  { id: 'doc', label: 'Document', icon: 'doc.text', hint: 'A page for writing' },
  { id: 'canvas', label: 'Canvas', icon: 'canvas', hint: 'An open board for cards' },
]

export default function DraftTabPane({ projectName, onCreated, refreshFiles }) {
  const [kind, setKind] = useState('doc')
  const [name, setName] = useState('')
  const [status, setStatus] = useState('')
  const [creating, setCreating] = useState(false)

  const create = async (event) => {
    event?.preventDefault?.()
    if (creating || !projectName) return

    // The `.canvas` suffix is what routes a document to the canvas editor, so it
    // follows the kind being created — never whatever the user typed.
    const bare = stripCanvasSuffix(name.trim())
    if (!bare) {
      setStatus('Give it a name first.')
      return
    }
    if (bare.includes('/')) {
      setStatus('Names can’t contain “/”.')
      return
    }

    const path = kind === 'canvas' ? withCanvasSuffix(bare) : bare

    setCreating(true)
    try {
      // Writing over a document that already exists would destroy it, and the
      // draft has no other way to notice — it never listed the project.
      if (await documentExists(projectName, path)) {
        setStatus('A document with that name already exists.')
        return
      }

      if (kind === 'canvas') {
        await saveCanvasDocument(projectName, path, createEmptyCanvas())
      } else {
        await saveDocument(projectName, path, { content: [] })
      }
      await refreshFiles?.()
      onCreated?.(path)
    } catch (error) {
      console.warn('Failed to create document:', error)
      setStatus('Could not create that document.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="draft-pane">
      <form className="draft-pane-card" onSubmit={create}>
        <div className="draft-pane-kinds">
          {KINDS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`draft-pane-kind${kind === option.id ? ' is-active' : ''}`}
              onClick={() => {
                setKind(option.id)
                setStatus('')
              }}
              aria-pressed={kind === option.id}
            >
              <SFIcon name={option.icon} size={22} strokeWidth={1.2} />
              <span className="draft-pane-kind-label">{option.label}</span>
              <span className="draft-pane-kind-hint">{option.hint}</span>
            </button>
          ))}
        </div>

        <div className="draft-pane-name">
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setStatus('')
            }}
            placeholder={kind === 'canvas' ? 'Canvas name' : 'Document name'}
            aria-label="Name"
            autoFocus
          />
          <button type="submit" className="draft-pane-create" disabled={creating}>
            Create
          </button>
        </div>

        {status ? <div className="draft-pane-status">{status}</div> : null}

        <p className="draft-pane-tip">
          Or drag a file from the sidebar onto the dock below to open it in this tab bar.
        </p>
      </form>
    </div>
  )
}
