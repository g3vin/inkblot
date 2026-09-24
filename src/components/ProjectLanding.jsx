/**
 * ProjectLanding.jsx — the full-window screen shown when no project is open.
 *
 * A searchable project grid sorted by recent activity, plus the create-project
 * dialog. Lifted out of Editor.jsx, where it was a 390-line component sharing a
 * file with the workspace container.
 */
import { useState, useEffect, useCallback } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { listProjects, createProject, linkProject, listProjectTree, moveProject, getProjectRoot } from '../lib/FileSystem'
import SFIcon from './SFIcon'
import { nativeOwns } from '../lib/host'
import appIconUrl from '../../src-tauri/icons/icon.png'

const LANDING_WINDOW_DRAG_HEIGHT = 52
const LANDING_WINDOW_DRAG_BLOCKER_SELECTOR = [
  'button',
  'input',
  'select',
  'textarea',
  'a',
  'label',
  '[role="button"]',
].join(',')

/** Count the files in a project tree (for the landing-page project cards). */
const countTreeFiles = (node) => {
  if (!node) return 0
  if (node.type === 'file') return 1
  return (node.children || []).reduce((sum, child) => sum + countTreeFiles(child), 0)
}

/** Format a timestamp like "Jul 10, 5:32 PM" for the landing page, or a fallback label. */
const formatRecentDate = (value) => {
  if (!value) return 'No recent activity'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No recent activity'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

/**
 * Full-window landing screen shown when no project is open: searchable
 * project grid (sorted by recent activity) plus a create-project dialog.
 */
export default function ProjectLanding({
  projectSessions,
  onOpenProject,
  onCreateProject,
}) {
  const [projects, setProjects] = useState([])
  const [query, setQuery] = useState('')
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectLocation, setNewProjectLocation] = useState(null)
  const [createPromptOpen, setCreatePromptOpen] = useState(false)
  const [status, setStatus] = useState('')
  const [statusTone, setStatusTone] = useState('error')
  const [settingsMenuProject, setSettingsMenuProject] = useState(null)

  const showError = (text) => {
    setStatus(text)
    setStatusTone('error')
  }
  const showNotice = (text) => {
    setStatus(text)
    setStatusTone('ok')
  }

  const refreshProjects = useCallback(async () => {
    const names = await listProjects()
    const summaries = await Promise.all(
      names.map(async (name) => {
        try {
          const tree = await listProjectTree(name)
          return { name, files: countTreeFiles(tree) }
        } catch {
          return { name, files: 0 }
        }
      })
    )
    setProjects(summaries)
  }, [])

  useEffect(() => {
    refreshProjects()
  }, [refreshProjects])

  // The landing page has no native titlebar, so dragging near the top edge moves the window.
  const handleLandingMouseDown = useCallback((event) => {
    // Under the Swift shell the window has a real toolbar to drag it by.
    if (nativeOwns('toolbar')) return
    if (event.button !== 0) return
    if (event.clientY > LANDING_WINDOW_DRAG_HEIGHT) return
    if (event.target instanceof Element && event.target.closest(LANDING_WINDOW_DRAG_BLOCKER_SELECTOR)) {
      return
    }

    event.preventDefault()
    getCurrentWindow().startDragging().catch(error => {
      console.warn('Failed to start landing window drag:', error)
    })
  }, [])

  const visibleProjects = projects
    .filter(project => project.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((left, right) => {
      const leftTime = new Date(projectSessions[left.name]?.updatedAt || 0).getTime() || 0
      const rightTime = new Date(projectSessions[right.name]?.updatedAt || 0).getTime() || 0
      if (rightTime !== leftTime) return rightTime - leftTime
      return left.name.localeCompare(right.name)
    })

  const handleCreateProject = async (event) => {
    event?.preventDefault?.()
    const trimmed = newProjectName.trim()
    if (!trimmed) return

    if (projects.some(project => project.name.toLowerCase() === trimmed.toLowerCase())) {
      showError('A project with that name already exists.')
      return
    }

    const ok = await createProject(trimmed, newProjectLocation || null)
    if (!ok) {
      showError('Could not create that project.')
      return
    }

    setStatus('')
    setNewProjectName('')
    setNewProjectLocation(null)
    setCreatePromptOpen(false)
    await refreshProjects()
    onCreateProject(trimmed)
  }

  const chooseNewProjectLocation = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Choose a folder to store this project',
      })
      if (typeof selected === 'string' && selected) {
        setNewProjectLocation(selected)
      }
    } catch (err) {
      console.warn('Failed to choose project location:', err)
    }
  }

  /**
   * Point the app back at a project folder that already exists on disk — the way
   * out when a project stops appearing because its folder moved, or because the
   * app was reinstalled and lost the registry that knew where it lived.
   */
  const handleLinkExistingProject = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Choose an existing project folder',
      })
      if (typeof selected !== 'string' || !selected) return

      const result = await linkProject(selected)
      if (!result?.ok) {
        showError(
          result?.error === 'name-exists'
            ? `A different project is already named “${result.name}”. Rename one of the folders, then link again.`
            : result?.error === 'invalid-name'
              ? 'That folder’s name can’t be used for a project.'
              : 'Could not link that folder.'
        )
        return
      }

      // The project may not match whatever is in the search box; clearing it
      // guarantees the tile the user just linked is actually on screen.
      setQuery('')
      await refreshProjects()
      showNotice(
        result.alreadyLinked
          ? `“${result.name}” was already linked.`
          : `Linked “${result.name}”.`
      )
    } catch (err) {
      console.warn('Failed to link project:', err)
      showError('Could not link that folder.')
    }
  }

  // Close the per-project settings menu on any outside interaction.
  useEffect(() => {
    if (!settingsMenuProject) return
    const close = () => setSettingsMenuProject(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [settingsMenuProject])

  const handleMoveProjectLocation = async (name) => {
    setSettingsMenuProject(null)
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const target = await open({
        directory: true,
        multiple: false,
        title: `Choose a new folder for "${name}"`,
      })
      if (typeof target !== 'string' || !target) return

      const result = await moveProject(name, target)
      if (!result?.ok) {
        const { message } = await import('@tauri-apps/plugin-dialog')
        const reason =
          result?.error === 'target-exists'
            ? 'A folder with that project name already exists there.'
            : 'Could not move the project.'
        await message(reason, { title: 'Move Project', kind: 'error' })
        return
      }
      await refreshProjects()
    } catch (err) {
      console.warn('Failed to move project:', err)
    }
  }

  const handleRevealProject = async (name) => {
    setSettingsMenuProject(null)
    try {
      const root = await getProjectRoot(name)
      const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
      await revealItemInDir(root)
    } catch (err) {
      console.warn('Failed to reveal project:', err)
    }
  }

  return (
    <div className="landing-page" onMouseDownCapture={handleLandingMouseDown} data-tauri-drag-region>
      <div className="landing-shell">
        <header className="landing-header">
          <svg className="landing-app-icon" viewBox="0 0 512 512" role="img" aria-label="Inkblot">
            <defs>
              <filter id="landing-app-icon-remove-bg" colorInterpolationFilters="sRGB">
                <feColorMatrix
                  type="matrix"
                  values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -4 -4 -4 0 11.1"
                />
              </filter>
            </defs>
            <image
              href={appIconUrl}
              width="512"
              height="512"
              preserveAspectRatio="xMidYMid meet"
              filter="url(#landing-app-icon-remove-bg)"
            />
          </svg>
        </header>

        <div className="landing-controls">
          <label className="landing-search">
            <SFIcon name="magnifyingglass.circle" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search projects"
              aria-label="Search projects"
            />
          </label>
        </div>

        {status && !createPromptOpen ? (
          <div className={`landing-status${statusTone === 'ok' ? ' landing-status-ok' : ''}`}>{status}</div>
        ) : null}

        <div className="landing-project-actions">
          <button
            type="button"
            className="landing-create-button"
            onClick={() => {
              setCreatePromptOpen(true)
              setNewProjectLocation(null)
              setStatus('')
            }}
            aria-label="Create project"
            title="Create project"
          >
            <SFIcon name="plus" size={22} strokeWidth={1.7} />
          </button>
          <button
            type="button"
            className="landing-create-button"
            onClick={handleLinkExistingProject}
            aria-label="Link an existing project folder"
            title="Link an existing project folder"
          >
            <SFIcon name="folder" size={22} strokeWidth={1.7} />
          </button>
        </div>

        <div className="landing-project-grid">
          {visibleProjects.length === 0 ? (
            <div className="landing-empty">
              {projects.length === 0 ? 'Create a project to begin.' : 'No projects match your search.'}
            </div>
          ) : (
            visibleProjects.map((project) => {
              const projectSession = projectSessions[project.name] || {}
              const menuOpen = settingsMenuProject === project.name
              return (
                <div
                  key={project.name}
                  role="button"
                  tabIndex={0}
                  className={`landing-project-tile${menuOpen ? ' menu-open' : ''}`}
                  onClick={() => onOpenProject(project.name)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onOpenProject(project.name)
                    }
                  }}
                >
                  <div className="landing-project-icon">
                    <SFIcon name="folder" />
                  </div>
                  <div className="landing-project-main">
                    <div className="landing-project-name">{project.name}</div>
                    <div className="landing-project-meta">
                      <span>{project.files} file{project.files === 1 ? '' : 's'}</span>
                      <span>{formatRecentDate(projectSession.updatedAt)}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="landing-project-settings"
                    aria-label={`Settings for ${project.name}`}
                    title="Project settings"
                    onClick={(event) => {
                      event.stopPropagation()
                      setSettingsMenuProject((current) =>
                        current === project.name ? null : project.name
                      )
                    }}
                  >
                    <SFIcon name="gearshape" />
                  </button>

                  {menuOpen ? (
                    <div
                      className="landing-project-settings-menu"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="landing-project-settings-option"
                        onClick={() => handleMoveProjectLocation(project.name)}
                      >
                        <SFIcon name="folder" />
                        <span>Move Folder Location…</span>
                      </button>
                      <button
                        type="button"
                        className="landing-project-settings-option"
                        onClick={() => handleRevealProject(project.name)}
                      >
                        <SFIcon name="magnifyingglass" />
                        <span>Reveal in Finder</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              )
            })
          )}
        </div>
      </div>

      {createPromptOpen ? (
        <div className="landing-create-overlay" onMouseDown={() => setCreatePromptOpen(false)}>
          <form
            className="landing-create-dialog"
            onSubmit={handleCreateProject}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="landing-create-dialog-header">
              <h2>New Project</h2>
              <button
                type="button"
                className="landing-create-close"
                onClick={() => setCreatePromptOpen(false)}
                aria-label="Close"
              >
                <SFIcon name="xmark" />
              </button>
            </div>
            <input
              value={newProjectName}
              onChange={(event) => {
                setNewProjectName(event.target.value)
                setStatus('')
              }}
              placeholder="Project name"
              aria-label="Project name"
              autoFocus
            />
            <button
              type="button"
              className="landing-create-location"
              onClick={chooseNewProjectLocation}
              title={newProjectLocation || 'Stored in the app’s default location'}
            >
              <SFIcon name="folder" />
              <span className="landing-create-location-label">
                {newProjectLocation
                  ? `Location: ${newProjectLocation}`
                  : 'Location: Default (app storage)'}
              </span>
              <span className="landing-create-location-action">Change…</span>
            </button>
            {status ? <div className="landing-status landing-dialog-status">{status}</div> : null}
            <button type="submit" className="landing-create-submit">
              Create
            </button>
          </form>
        </div>
      ) : null}
    </div>
  )
}
