/**
 * useMapProject.js — what a map needs to know about the project it is in: which
 * documents exist (to link pins and travellers to them, and to notice a link that
 * points at nothing), and the story calendar its dates are written in.
 */
import { PROJECT_FILES_CHANGED } from '../lib/projectFiles'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { listProjectTree } from '../lib/FileSystem'
import { getDocDisplayName, getDocKind } from '../lib/docKind'
import { isCharacterDoc, isLocationDoc } from '../lib/storyStructure'
import { loadStoryCalendar, saveStoryCalendar, STORY_CALENDAR_CHANGED_EVENT } from '../lib/map/storyCalendarStore'
import { normalizeCalendar } from '../lib/map/calendar'

const flatten = (node, out = []) => {
  if (!node) return out
  if (node.type === 'file') {
    out.push({
      path: node.path,
      name: getDocDisplayName(node.path),
      kind: getDocKind(node.path),
      isLocation: isLocationDoc(node.path),
      isCharacter: isCharacterDoc(node.path),
    })
    return out
  }
  for (const child of node.children || []) flatten(child, out)
  return out
}

/** The project's documents. `loaded` is false until the first listing lands. */
export function useProjectDocs(projectName) {
  const [state, setState] = useState({ loaded: false, docs: [] })

  const refresh = useCallback(async () => {
    if (!projectName) return
    try {
      const tree = await listProjectTree(projectName)
      setState({ loaded: true, docs: flatten(tree) })
    } catch (error) {
      console.warn('[map] could not list the project:', error)
    }
  }, [projectName])

  useEffect(() => {
    void refresh()
    // A rename or a new document elsewhere shows up when the window comes back.
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    window.addEventListener(PROJECT_FILES_CHANGED, onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener(PROJECT_FILES_CHANGED, onFocus)
    }
  }, [refresh])

  const paths = useMemo(() => new Set(state.docs.map((doc) => doc.path)), [state.docs])
  return useMemo(() => ({ ...state, paths, refresh }), [paths, refresh, state])
}

/** The project's story calendar, kept in step with every other open map. */
export function useStoryCalendar(projectName) {
  const [calendar, setCalendar] = useState(() => normalizeCalendar(null))

  useEffect(() => {
    let cancelled = false
    loadStoryCalendar(projectName).then((loaded) => {
      if (!cancelled) setCalendar(loaded)
    })
    const onChanged = (event) => {
      if (event.detail?.projectName === projectName) setCalendar(event.detail.calendar)
    }
    window.addEventListener(STORY_CALENDAR_CHANGED_EVENT, onChanged)
    return () => {
      cancelled = true
      window.removeEventListener(STORY_CALENDAR_CHANGED_EVENT, onChanged)
    }
  }, [projectName])

  const save = useCallback(
    async (next) => {
      setCalendar(normalizeCalendar(next))
      await saveStoryCalendar(projectName, next)
    },
    [projectName]
  )

  return [calendar, save]
}
