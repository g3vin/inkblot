/**
 * ProjectLanding.jsx — the window Inkblot opens with when no project is open
 * (docs/DESIGN.md §6, "The landing page").
 *
 * Each project is a pile of the pages lately written in it, on a frosted window of
 * leaves (LandingBackdrop): the document it reopens on is on top, the ones opened
 * before it beneath, each with its opening lines (lib/docExcerpts.js). Under a pile
 * are its name, how many files and words it holds (lib/projectSummaries.js) and a ⋯
 * menu; a right-click offers the same. The last place in the grid is an empty pile
 * for a new project.
 *
 * Pointing at a pile fans it out. Clicking a sheet opens the project at that document,
 * and the sheet itself grows into the document card (landing/SheetFlight, started by
 * Editor); anywhere else on the pile, or Enter, opens the top one. The arrow keys move
 * between piles.
 *
 * Nothing here reads a document or counts a project before the first paint: the
 * piles are drawn from what was remembered, and the counts are refreshed afterwards,
 * one project at a time.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getProjectRoot, linkProject, listProjects, moveProject } from '../lib/FileSystem'
import { prefetchProject, recallProjects, rememberProjects } from '../lib/projectPrefetch'
import { excerptsSnapshot, pruneExcerpts, subscribeExcerpts } from '../lib/docExcerpts'
import { scheduleSummaryRefresh, subscribeSummaries, summariesSnapshot } from '../lib/projectSummaries'
import { deleteProjectEverywhere, projectNameProblem, renameProjectEverywhere } from '../lib/projectLifecycle'
import { recentDocs } from '../lib/recentDocs'
import { getDocDisplayName, getDocKind } from '../lib/docKind'
import { useCommands } from '../lib/commands'
import { Button, Dialog, Input, PaperPile, Skeleton, Wordmark, staggerStyle, useReveal } from '../ui'
import { useRovingFocus } from '../ui/hooks'
import { REVEAL } from '../ui/motion.js'
import LandingBackdrop from './landing/LandingBackdrop'
import NewProjectSheet from './landing/NewProjectSheet'
import './ProjectLanding.css'

const DRAG_HEIGHT = 52
const PILE_SHEETS = 5
/** Most placeholder piles drawn while the projects are read. */
const MAX_PLACEHOLDERS = 8
const DRAG_BLOCKERS = 'button, input, select, textarea, a, label, [role="button"], .ib-paper-pile'
const FOOTAGE_CREDIT = 'https://commons.wikimedia.org/wiki/File:Leaves_in_summer.webm'

const plural = (count, one, many) => `${count.toLocaleString()} ${count === 1 ? one : many}`

/** The pile's documents, top first: the one the project reopens on, then the ones opened before it. */
function pileDocs(session, name) {
  const docs = [session?.currentDoc, ...recentDocs(name)].filter(Boolean)
  return [...new Set(docs)].slice(0, PILE_SHEETS)
}

/** Where a sheet lies on screen, unturned, and how far it is turned. */
function sheetBox(element) {
  const box = element.getBoundingClientRect()
  const width = element.offsetWidth
  const height = element.offsetHeight
  const matrix = getComputedStyle(element).transform
  const [a, b] = /matrix\(([^)]+)\)/.exec(matrix)?.[1].split(',').map(Number) ?? [1, 0]
  return {
    rect: { left: box.left + box.width / 2 - width / 2, top: box.top + box.height / 2 - height / 2, width, height },
    rotate: (Math.atan2(b, a) * 180) / Math.PI,
  }
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export default function ProjectLanding({ projectSessions, onOpenProject, onCreateProject, leaving = false, flying = false, onLeft }) {
  // The list as last read this session draws at once; the read below replaces it.
  const [projects, setProjects] = useState(() => recallProjects()?.names ?? null)
  const [roots, setRoots] = useState(() => recallProjects()?.roots ?? {})
  // Whether `projects` has been read from disk this time, not only recalled.
  const [listed, setListed] = useState(false)
  const [version, setVersion] = useState('')
  const [creating, setCreating] = useState(false)
  const [failure, setFailure] = useState('')
  const [renaming, setRenaming] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [lifted, setLifted] = useState(null)
  const [active, setActive] = useState(null)
  const gridRef = useRef(null)
  const excerpts = useSyncExternalStore(subscribeExcerpts, excerptsSnapshot, excerptsSnapshot)
  const summaries = useSyncExternalStore(subscribeSummaries, summariesSnapshot, summariesSnapshot)

  const refresh = useCallback(async () => {
    const names = await listProjects()
    const entries = await Promise.all(names.map(async (name) => [name, await getProjectRoot(name).catch(() => '')]))
    const nextRoots = Object.fromEntries(entries)
    rememberProjects(names, nextRoots)
    setRoots(nextRoots)
    setProjects(names)
    setListed(true)
  }, [])

  useEffect(() => {
    refresh()
    import('@tauri-apps/api/app').then(({ getVersion }) => getVersion()).then(setVersion).catch(() => {})
  }, [refresh])

  // Newest first, by when the page last had each open; then by name.
  const sorted = useMemo(() => {
    const opened = (name) => new Date(projectSessions?.[name]?.updatedAt || 0).getTime() || 0
    return [...(projects || [])].sort((a, b) => (opened(b) - opened(a)) || a.localeCompare(b, undefined, { numeric: true }))
  }, [projects, projectSessions])

  const piles = useMemo(() => sorted.map((name) => {
    const docs = pileDocs(projectSessions?.[name], name)
    const sheets = docs.length
      ? docs.map((docPath) => ({
        id: docPath,
        title: getDocDisplayName(docPath),
        blocks: excerpts[name]?.[docPath]?.blocks ?? null,
        kind: getDocKind(docPath),
      }))
      : [{ id: '', blank: true }]
    return { name, sheets }
  }), [excerpts, projectSessions, sorted])

  const loaded = projects !== null
  const gridReveal = useReveal(loaded)
  const showPlaceholders = gridReveal.phase === 'hidden'
  const placeholders = Math.min(Math.max(Object.keys(projectSessions || {}).length, 1), MAX_PLACEHOLDERS)

  // Once the piles are up, count the projects whose counts are missing or old, most
  // recent first, while nothing else is happening. Projects gone from disk are forgotten,
  // which only a fresh read can say: a recalled list may predate a new project.
  useEffect(() => {
    if (!projects || !listed || leaving) return undefined
    if (projects.length) pruneExcerpts(projects)
    const timer = window.setTimeout(() => scheduleSummaryRefresh(sorted), REVEAL.gateTimeout / 2)
    return () => window.clearTimeout(timer)
  }, [leaving, listed, projects, sorted])

  const activeName = active && sorted.includes(active) ? active : sorted[0] ?? null
  const prefetch = useCallback((name) => prefetchProject(name, projectSessions?.[name]?.currentDoc || ''), [projectSessions])

  const onDragArea = useCallback((event) => {
    if (event.button !== 0 || event.clientY > DRAG_HEIGHT) return
    if (event.target instanceof Element && event.target.closest(DRAG_BLOCKERS)) return
    event.preventDefault()
    getCurrentWindow().startDragging().catch(() => {})
  }, [])

  const open = useCallback((name, sheetId = null, element = null) => {
    if (leaving || lifted) return
    const pile = piles.find((entry) => entry.name === name)
    const sheet = pile?.sheets.find((entry) => entry.id === sheetId) ?? pile?.sheets[0]
    const docPath = sheet && !sheet.blank ? sheet.id : undefined
    if (!element || reducedMotion()) {
      onOpenProject(name, { docPath })
      return
    }
    const { rect, rotate } = sheetBox(element)
    setLifted({ name, sheetId: sheet?.id ?? '' })
    onOpenProject(name, {
      docPath,
      flight: { rect, rotate, sheet: { title: sheet?.title, blocks: sheet?.blocks, kind: sheet?.kind, blank: sheet?.blank } },
    })
  }, [leaving, lifted, onOpenProject, piles])

  const openExisting = useCallback(async () => {
    try {
      const { open: choose } = await import('@tauri-apps/plugin-dialog')
      const folder = await choose({ directory: true, multiple: false, title: 'Choose a project folder' })
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
  }, [onOpenProject, refresh])

  const moveFolder = useCallback(async (name) => {
    const { open: choose, message } = await import('@tauri-apps/plugin-dialog')
    const target = await choose({ directory: true, multiple: false, title: `Choose a new folder for “${name}”` })
    if (typeof target !== 'string' || !target) return
    const result = await moveProject(name, target)
    if (!result?.ok) {
      await message(result?.error === 'target-exists' ? 'A folder with that project name already exists there.' : 'Could not move the project.', { title: 'Move project', kind: 'error' })
      return
    }
    await refresh()
  }, [refresh])

  const reveal = useCallback(async (name) => {
    try {
      const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
      await revealItemInDir(roots[name] || await getProjectRoot(name))
    } catch (err) {
      console.warn('Failed to reveal project:', err)
    }
  }, [roots])

  // Enter commits, and so does the blur that follows as the field goes: only once.
  const renamingNow = useRef(false)
  const commitRename = async () => {
    if (!renaming || renamingNow.current) return
    const { name, value } = renaming
    const trimmed = value.trim()
    if (!trimmed || trimmed === name) { setRenaming(null); return }
    const problem = projectNameProblem(trimmed, projects || [], { except: name })
    if (problem) { setRenaming({ ...renaming, error: problem }); return }
    renamingNow.current = true
    const next = await renameProjectEverywhere(name, trimmed).finally(() => { renamingNow.current = false })
    if (!next) { setRenaming({ ...renaming, error: 'Could not rename the project.' }); return }
    setRenaming(null)
    setActive(next)
    await refresh()
  }

  const confirmDelete = async () => {
    const name = deleting
    setDeleting(null)
    if (!name) return
    if (!(await deleteProjectEverywhere(name))) {
      setFailure(`Could not delete “${name}”.`)
      return
    }
    await refresh()
  }

  const menuFor = (pile) => [
    { text: 'Open', action: () => open(pile.name) },
    pile.sheets.length > 1 ? {
      text: 'Open document',
      items: pile.sheets.map((sheet) => ({ text: sheet.title, action: () => onOpenProject(pile.name, { docPath: sheet.id }) })),
    } : null,
    { separator: true },
    { text: 'Rename…', action: () => setRenaming({ name: pile.name, value: pile.name, error: '' }) },
    { text: 'Show in Finder', action: () => reveal(pile.name) },
    { text: 'Move folder location…', action: () => moveFolder(pile.name) },
    { separator: true },
    { text: 'Delete…', danger: true, action: () => setDeleting(pile.name) },
  ].filter(Boolean)

  const newProjectMenu = [
    { text: 'New project…', action: () => setCreating(true) },
    { text: 'New project in folder…', action: () => setCreating('folder') },
    { separator: true },
    { text: 'Open folder…', action: openExisting },
  ]

  useCommands(() => [
    { id: 'landing.new-project', title: 'New project', section: 'Projects', icon: 'add', when: () => !leaving, run: () => setCreating(true) },
    { id: 'landing.new-project-in-folder', title: 'New project in folder', section: 'Projects', icon: 'folder', when: () => !leaving, run: () => setCreating('folder') },
    { id: 'landing.open-folder', title: 'Open folder as project', section: 'Projects', icon: 'folder-open', keywords: ['link', 'existing'], when: () => !leaving, run: openExisting },
    ...sorted.map((name) => ({
      id: `landing.open.${name}`,
      title: `Open “${name}”`,
      section: 'Projects',
      icon: 'folder',
      when: () => !leaving,
      run: () => open(name),
    })),
  ], [leaving, open, openExisting, sorted])

  const onGridKeyDown = useRovingFocus(gridRef, '.ib-paper-pile-open', { orientation: 'grid', loop: false, typeahead: false })

  return (
    <div
      className={`landing-page picker${lifted ? ' is-launching' : ''}${leaving ? ' is-leaving' : ''}${flying ? ' is-flying' : ''}`}
      onMouseDownCapture={onDragArea}
      onAnimationEnd={(event) => { if (leaving && event.target === event.currentTarget) onLeft?.() }}
      inert={leaving || lifted ? true : undefined}
      data-tauri-drag-region
    >
      <LandingBackdrop still={leaving || Boolean(lifted)} />

      <main className="landing-scroll">
        {failure ? <p className="landing-failure" role="alert">{failure}</p> : null}
        <div
          ref={gridRef}
          className="landing-grid ib-stagger"
          role="list"
          aria-label="Projects"
          aria-busy={loaded ? undefined : true}
          data-reveal={showPlaceholders ? undefined : gridReveal.phase}
          onKeyDown={onGridKeyDown}
        >
          {showPlaceholders ? Array.from({ length: placeholders }, (_, index) => (
            <div key={index} className="landing-placeholder ib-skeleton-host" data-visible={gridReveal.skeleton ? 'true' : 'false'} aria-hidden="true">
              <Skeleton className="landing-placeholder-sheet" width="var(--paper-sheet-w)" height="var(--paper-sheet-h)" />
              <Skeleton width="60%" />
            </div>
          )) : (
            <>
              {piles.map((pile, index) => {
                const summary = summaries[pile.name]
                const isRenaming = renaming?.name === pile.name
                return (
                  <div key={pile.name} role="listitem" style={staggerStyle(index)} className="landing-cell">
                    <PaperPile
                      id={pile.name}
                      label={isRenaming ? (
                        <RenameField renaming={renaming} onChange={(value) => setRenaming({ ...renaming, value, error: '' })} onCommit={commitRename} onCancel={() => setRenaming(null)} />
                      ) : pile.name}
                      openLabel={`Open ${pile.name}`}
                      menuLabel={`${pile.name} options`}
                      meta={summary ? `${plural(summary.files, 'file', 'files')} · ${plural(summary.words, 'word', 'words')}` : <Skeleton width="8em" height="0.8em" />}
                      sheets={pile.sheets}
                      menuItems={menuFor(pile)}
                      active={pile.name === activeName}
                      hiddenSheet={lifted?.name === pile.name ? lifted.sheetId : null}
                      onPoint={() => { prefetch(pile.name); setActive(pile.name) }}
                      onOpen={(sheetId, element) => open(pile.name, sheetId, element)}
                    />
                  </div>
                )
              })}
              <div role="listitem" style={staggerStyle(piles.length)} className="landing-cell">
                <PaperPile
                  id="new"
                  dashed
                  label="New project"
                  openLabel="New project"
                  menuLabel="New project options"
                  meta={piles.length ? null : 'Start one, or open a folder you already write in.'}
                  menuItems={newProjectMenu}
                  active={!sorted.length}
                  onOpen={() => setCreating(true)}
                />
              </div>
            </>
          )}
        </div>
      </main>

      <footer className="landing-footer">
        <span className="landing-signature">
          <Wordmark height={20} />
          {version ? <span className="ib-meta">v{version}</span> : null}
        </span>
        <a
          className="landing-credit ib-meta"
          href={FOOTAGE_CREDIT}
          onClick={(event) => {
            event.preventDefault()
            import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(FOOTAGE_CREDIT)).catch(() => {})
          }}
        >
          Leaves in summer · Joaquim Baeta · CC BY 4.0
        </a>
      </footer>

      {creating ? (
        <NewProjectSheet
          existing={projects || []}
          pickFolder={creating === 'folder'}
          onClose={() => setCreating(false)}
          onCreated={async (name) => {
            setCreating(false)
            await refresh()
            onCreateProject(name)
          }}
        />
      ) : null}

      {deleting ? (
        <Dialog
          title={`Delete “${deleting}”?`}
          description="This deletes the project’s folder and every file in it. It can’t be undone."
          size="small"
          onClose={() => setDeleting(null)}
          footer={(
            <>
              <Button onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="destructive" onClick={confirmDelete}>Delete project</Button>
            </>
          )}
        />
      ) : null}
    </div>
  )
}

function RenameField({ renaming, onChange, onCommit, onCancel }) {
  return (
    <span className="landing-rename">
      <Input
        autoFocus
        size="sm"
        aria-label="Project name"
        aria-invalid={renaming.error ? true : undefined}
        value={renaming.value}
        onFocus={(event) => event.target.select()}
        onChange={(event) => onChange(event.target.value)}
        // Escape cancels; the blur as the field goes must not commit after it.
        onBlur={(event) => { if (!event.target.dataset.cancelled) onCommit() }}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Enter') { event.preventDefault(); onCommit() }
          if (event.key === 'Escape') {
            event.preventDefault()
            event.currentTarget.dataset.cancelled = 'true'
            onCancel()
          }
        }}
      />
      {renaming.error ? <span className="landing-rename-error" role="alert">{renaming.error}</span> : null}
    </span>
  )
}
