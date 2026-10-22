/**
 * ProjectLanding.jsx — the window Inkblot opens with when no project is open: pick a
 * project and the editor opens on it (ProjectPicker.swift).
 *
 * Modelled on Xcode's welcome window: the app's icon and name, Open… and New Project
 * under them, and the projects in one centred list, newest first. A click selects,
 * a double-click or Return opens; ↑/↓ move the selection. A project's context menu
 * opens it, reveals it, or moves its folder.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { createProject, getProjectRoot, linkProject, listProjects, moveProject } from '../lib/FileSystem'
import { Button, EmptyState, Sheet } from '../ui'
import { popUpNativeMenu } from '../ui/useNativeMenu.js'
import Icon from '../ui/Icon.jsx'
import { AppIcon, Wordmark } from '../ui/Brand.jsx'
import './ProjectLanding.css'

const DRAG_HEIGHT = 52
const DRAG_BLOCKERS = 'button, input, select, textarea, a, label, [role="button"], [role="option"]'

/** Where a project lives, as the Finder would say it: the folder that holds it. */
function locationOf(root, home) {
  if (!root) return ''
  const parent = root.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/'
  return home && parent.startsWith(home) ? `~${parent.slice(home.replace(/\/+$/, '').length)}` : parent
}

function NewProjectSheet({ existing, pickFolder, onCreated, onClose }) {
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
    if (!trimmed) { setError('Give the project a name.'); return }
    if (trimmed.startsWith('.') || trimmed.includes('/')) { setError('That name can’t be used for a project.'); return }
    if (existing.some((project) => project.toLowerCase() === trimmed.toLowerCase())) { setError('A project with that name already exists.'); return }
    if (!(await createProject(trimmed, location))) { setError('Could not create that project.'); return }
    onCreated(trimmed)
  }
  return (
    <Sheet title="New project" width={400} onClose={onClose} footer={(
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="filled" disabled={!name.trim()} onClick={submit}>Create</Button>
      </>
    )}>
      <form className="picker-new" onSubmit={submit}>
        <input
          className="picker-input"
          aria-label="Project name"
          placeholder="Project name"
          value={name}
          onChange={(event) => { setName(event.target.value); setError('') }}
        />
        <button type="button" className="picker-location" onClick={choose} title={location || 'Stored in the app’s own folder'}>
          <Icon name="folder" />
          <span>{location ? location : 'In Inkblot’s own folder'}</span>
          <strong>Change…</strong>
        </button>
        {error ? <p className="picker-error" role="alert">{error}</p> : null}
      </form>
    </Sheet>
  )
}

export default function ProjectLanding({ projectSessions, onOpenProject, onCreateProject }) {
  const [projects, setProjects] = useState([])
  const [roots, setRoots] = useState({})
  const [home, setHome] = useState('')
  const [version, setVersion] = useState('')
  const [selection, setSelection] = useState(null)
  const [creating, setCreating] = useState(false)
  const [failure, setFailure] = useState('')
  const listRef = useRef(null)

  const refresh = useCallback(async () => {
    const names = await listProjects()
    setProjects(names)
    const entries = await Promise.all(names.map(async (name) => [name, await getProjectRoot(name).catch(() => '')]))
    setRoots(Object.fromEntries(entries))
  }, [])

  useEffect(() => {
    refresh()
    import('@tauri-apps/api/path').then(({ homeDir }) => homeDir()).then(setHome).catch(() => {})
    import('@tauri-apps/api/app').then(({ getVersion }) => getVersion()).then(setVersion).catch(() => {})
  }, [refresh])

  // Newest first, by when the page last had each open; then by name.
  const sorted = useMemo(() => {
    const opened = (name) => new Date(projectSessions?.[name]?.updatedAt || 0).getTime() || 0
    return [...projects].sort((a, b) => (opened(b) - opened(a)) || a.localeCompare(b, undefined, { numeric: true }))
  }, [projects, projectSessions])

  const selected = selection && sorted.includes(selection) ? selection : sorted[0] ?? null

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [selected])

  const onDragArea = useCallback((event) => {
    if (event.button !== 0 || event.clientY > DRAG_HEIGHT) return
    if (event.target instanceof Element && event.target.closest(DRAG_BLOCKERS)) return
    event.preventDefault()
    getCurrentWindow().startDragging().catch(() => {})
  }, [])

  const openExisting = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const folder = await open({ directory: true, multiple: false, title: 'Choose a project folder' })
      if (typeof folder !== 'string' || !folder) return
      const result = await linkProject(folder)
      if (!result?.ok) {
        setFailure(result?.error === 'name-exists'
          ? `A different project is already named “${result.name}”. Rename one of the folders, then open it again.`
          : result?.error === 'invalid-name' ? 'That folder’s name can’t be used for a project.' : 'Could not open that folder.')
        return
      }
      await refresh()
      onOpenProject(result.name)
    } catch (err) {
      console.warn('Failed to open a project folder:', err)
      setFailure('Could not open that folder.')
    }
  }

  const moveFolder = async (name) => {
    const { open, message } = await import('@tauri-apps/plugin-dialog')
    const target = await open({ directory: true, multiple: false, title: `Choose a new folder for “${name}”` })
    if (typeof target !== 'string' || !target) return
    const result = await moveProject(name, target)
    if (!result?.ok) {
      await message(result?.error === 'target-exists' ? 'A folder with that project name already exists there.' : 'Could not move the project.', { title: 'Move project', kind: 'error' })
      return
    }
    await refresh()
  }

  const reveal = async (name) => {
    try {
      const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
      await revealItemInDir(roots[name] || await getProjectRoot(name))
    } catch (err) {
      console.warn('Failed to reveal project:', err)
    }
  }

  const moveSelection = (step) => {
    if (!sorted.length) return
    const at = sorted.indexOf(selected)
    setSelection(sorted[Math.min(Math.max((at === -1 ? (step > 0 ? -1 : sorted.length) : at) + step, 0), sorted.length - 1)])
  }

  return (
    <div className="landing-page picker" onMouseDownCapture={onDragArea} data-tauri-drag-region>
      <div className="picker-column">
        <header className="picker-header">
          <AppIcon className="picker-logo" size={98} label="" />
          <h1 className="picker-wordmark"><Wordmark height={40} /></h1>
          {version ? <p>Version {version}</p> : null}
        </header>

        <div className="picker-actions">
          <button type="button" className="picker-capsule" onClick={openExisting}>Open…</button>
          <span className="picker-capsule picker-split">
            <button type="button" onClick={() => setCreating(true)}>New project</button>
            <button
              type="button"
              className="picker-chevron"
              aria-label="New project options"
              onClick={(event) => popUpNativeMenu(event, [
                { text: 'New project…', action: () => setCreating(true) },
                { text: 'New project in folder…', action: () => setCreating('folder') },
              ])}
            >
              <Icon name="chevron-down" />
            </button>
          </span>
        </div>

        {failure ? <p className="picker-error picker-failure" role="alert">{failure}</p> : null}

        <div
          ref={listRef}
          className="picker-list"
          role="listbox"
          aria-label="Projects"
          tabIndex={0}
          aria-activedescendant={selected ? `picker-${selected}` : undefined}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); moveSelection(1) }
            if (event.key === 'ArrowUp') { event.preventDefault(); moveSelection(-1) }
            if (event.key === 'Enter' && selected) { event.preventDefault(); onOpenProject(selected) }
          }}
        >
          {sorted.length === 0 ? <EmptyState icon="folder" title="No projects yet." hint="Start one with New project, or open a folder you already write in." /> : sorted.map((name) => (
            <div
              key={name}
              id={`picker-${name}`}
              role="option"
              aria-selected={name === selected}
              className="picker-row"
              data-project-name={name}
              onClick={() => { setSelection(name); listRef.current?.focus() }}
              onDoubleClick={() => onOpenProject(name)}
              onContextMenu={(event) => {
                setSelection(name)
                popUpNativeMenu(event, [
                  { text: 'Open', action: () => onOpenProject(name) },
                  { text: 'Show in Finder', action: () => reveal(name) },
                  { separator: true },
                  { text: 'Move folder location…', action: () => moveFolder(name) },
                ])
              }}
            >
              <span className="picker-row-icon"><Icon name="folder" size={20} /></span>
              <span className="picker-row-text">
                <strong>{name}</strong>
                <small>{locationOf(roots[name], home)}</small>
              </span>
            </div>
          ))}
        </div>
      </div>

      {creating ? (
        <NewProjectSheet
          existing={projects}
          pickFolder={creating === 'folder'}
          onClose={() => setCreating(false)}
          onCreated={async (name) => {
            setCreating(false)
            await refresh()
            onCreateProject(name)
          }}
        />
      ) : null}
    </div>
  )
}
