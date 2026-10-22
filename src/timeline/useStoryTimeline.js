/**
 * useStoryTimeline.js — the project's chronology and cursor, as React state.
 *
 * Every component that shows events reads them through here, so a drag in a timeline
 * view — previewed, not yet saved — moves them everywhere in the same frame. The
 * calendar and the project's documents come from the map's hooks (useMapProject.js).
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { getStoryCursor, subscribeStoryCursor } from '../lib/timeline/storyCursor'
import { loadStoryTimeline, peekStoryTimeline, subscribeTimeline } from '../lib/timeline/timelineStore'

/** The chronology, or null until it has loaded. */
export function useStoryTimeline(projectName) {
  const [timeline, setTimeline] = useState(() => peekStoryTimeline(projectName))
  useEffect(() => {
    if (!projectName) return undefined
    let live = true
    setTimeline(peekStoryTimeline(projectName))
    loadStoryTimeline(projectName).then((loaded) => {
      if (live) setTimeline(peekStoryTimeline(projectName) || loaded)
    })
    const unsubscribe = subscribeTimeline(projectName, (next) => {
      if (live) setTimeline(next)
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [projectName])
  return timeline
}

export function useStoryCursor(projectName) {
  return useSyncExternalStore(
    (onChange) => subscribeStoryCursor(projectName, onChange),
    () => getStoryCursor(projectName)
  )
}
