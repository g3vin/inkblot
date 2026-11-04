/**
 * useMarkVisibilitySetting.js — the app's side of the Show menu: it owns the setting
 * (lib/markVisibility.ts), takes `setMarkVisible` from the toolbar or a shell,
 * publishes the result as `viewOptions.marks`, and puts each layer in ⌘K.
 */
import { useEffect } from 'react'
import { documentSurface } from '../bridge'
import { useCommands } from '../lib/commands'
import {
  MARK_LAYERS,
  allMarksShown,
  getMarkVisibility,
  onMarkVisibilityChange,
  setAllMarksVisible,
  setMarkVisible,
} from '../lib/markVisibility'

const LAYER_KEYWORDS = {
  names: ['characters', 'places', 'tags', 'mentions', 'highlight'],
  notes: ['comments', 'dots', 'markers'],
  bubbles: ['chips', 'sessions'],
  timeline: ['events', 'passages', 'chips'],
}

export function useMarkVisibilitySetting() {
  useEffect(() => (
    documentSurface.onCommand('setMarkVisible', ({ mark, visible }) => setMarkVisible(mark, visible))
  ), [])

  useEffect(() => {
    const publish = () => documentSurface.publishViewOptions({ marks: { ...getMarkVisibility() } })
    publish()
    return onMarkVisibilityChange(publish)
  }, [])

  useCommands(() => [
    ...MARK_LAYERS.map(({ id, label, icon }) => ({
      id: `view.marks.${id}`,
      section: 'View',
      title: `Show or hide ${label.toLowerCase()}`,
      icon,
      keywords: ['show', 'hide', 'marks', ...LAYER_KEYWORDS[id]],
      run: () => setMarkVisible(id, !getMarkVisibility()[id]),
    })),
    {
      id: 'view.marks.all',
      section: 'View',
      title: 'Show or hide all marks',
      icon: 'show',
      keywords: ['clean', 'distraction', 'names', 'notes', 'bubbles', 'timeline'],
      run: () => setAllMarksVisible(!allMarksShown(getMarkVisibility())),
    },
  ], [])
}
