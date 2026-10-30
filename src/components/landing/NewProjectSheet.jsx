/**
 * NewProjectSheet — naming a new project, and choosing where it lives (the landing
 * page's "New project" pile and its menu).
 */
import { useEffect, useState } from 'react'
import { createProject } from '../../lib/FileSystem'
import { projectNameProblem } from '../../lib/projectLifecycle'
import { Button, Dialog, Field, Input } from '../../ui'
import Icon from '../../ui/Icon.jsx'

export default function NewProjectSheet({ existing, pickFolder, onCreated, onClose }) {
  const [name, setName] = useState('')
  const [location, setLocation] = useState(null)
  const [error, setError] = useState('')
  const choose = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({ directory: true, multiple: false, title: 'Choose the folder to create the project in' })
      if (typeof selected === 'string' && selected) setLocation(selected)
    } catch (err) {
      console.warn('Failed to choose project location:', err)
    }
  }
  // New Project in Folder… asks where first.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (pickFolder) choose() }, [])
  const submit = async (event) => {
    event?.preventDefault?.()
    const trimmed = name.trim()
    const problem = projectNameProblem(trimmed, existing)
    if (problem) { setError(problem); return }
    if (!(await createProject(trimmed, location))) { setError('Could not create that project.'); return }
    onCreated(trimmed)
  }
  return (
    <Dialog title="New project" size="small" onClose={onClose} footer={(
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="filled" disabled={!name.trim()} onClick={submit}>Create</Button>
      </>
    )}>
      <form className="landing-new" onSubmit={submit}>
        <Field error={error}>
          <Input
            autoFocus
            aria-label="Project name"
            placeholder="Project name"
            value={name}
            onChange={(event) => { setName(event.target.value); setError('') }}
          />
        </Field>
        <div className="landing-new-location">
          <Icon name="folder" />
          <span title={location || 'Stored in the app’s own folder'}>{location || 'In Inkblot’s own folder'}</span>
          <Button onClick={choose}>Change…</Button>
        </div>
      </form>
    </Dialog>
  )
}
