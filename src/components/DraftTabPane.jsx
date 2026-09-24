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
import { DOCUMENT_KINDS as KINDS } from '../lib/createDocument'
import { createDraftDocument, DraftRefusal } from '../lib/draftDocument'

export default function DraftTabPane({ projectName, onCreated, refreshFiles }) {
  const [kind, setKind] = useState('doc')
  const [name, setName] = useState('')
  const [status, setStatus] = useState('')
  const [creating, setCreating] = useState(false)

  const create = async (event) => {
    event?.preventDefault?.()
    if (creating || !projectName) return

    setCreating(true)
    try {
      const path = await createDraftDocument(projectName, name, kind)
      await refreshFiles?.()
      onCreated?.(path)
    } catch (error) {
      if (error instanceof DraftRefusal) {
        setStatus(error.message)
      } else {
        console.warn('Failed to create document:', error)
        setStatus('Could not create that document.')
      }
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
