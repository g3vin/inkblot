/**
 * toolbarContext.js — what every toolbar item reads: the state the page publishes,
 * the display mode, and how to send a command back.
 */
import { useCallback, useMemo } from 'react'
import { shellBridge, useLatestBridgeState } from '../../bridge'
import { DEFAULT_HIGHLIGHT_COLOR, DEFAULT_TEXT_COLOR } from '../../lib/palette'

export const CUSTOMIZE_TOOLBAR_EVENT = 'inkblot:customize-toolbar'

const DEFAULT_TOOLBAR_STATE = {
  target: undefined,
  color: DEFAULT_TEXT_COLOR,
  highlight: DEFAULT_HIGHLIGHT_COLOR,
  font: 'Literata',
  fontSize: '18px',
  alignment: 'left',
  activeMarks: { bold: false, italic: false, underline: false, strike: false, table: false },
  canUndo: false,
  canRedo: false,
  lastHighlightColor: DEFAULT_HIGHLIGHT_COLOR,
}
const NO_CANVAS = {}
const NO_MAP = {}
const NO_TIMELINE = {}
const DEFAULT_VIEW = { focusMode: false, wordCountVisible: true }

/** What every item reads: the published state, the display mode, and how to send. */
export function useToolbarContext({ editor, activeDoc, hasProject, panel, split, timer, display }) {
  const toolbar = useLatestBridgeState('toolbarState', DEFAULT_TOOLBAR_STATE)
  const canvas = useLatestBridgeState('canvasToolbarChanged', NO_CANVAS)
  const map = useLatestBridgeState('mapChromeChanged', NO_MAP)
  const timeline = useLatestBridgeState('timelineChromeChanged', NO_TIMELINE)
  const layout = useLatestBridgeState('pageLayoutState', null)
  const view = useLatestBridgeState('viewOptions', DEFAULT_VIEW)
  const send = useCallback((type, payload) => shellBridge.send(type, payload), [])
  return useMemo(() => ({
    toolbar: toolbar || DEFAULT_TOOLBAR_STATE,
    canvas: canvas?.state ?? null,
    map: map?.state ?? null,
    timeline: timeline?.state ?? null,
    layout,
    view: view || DEFAULT_VIEW,
    send,
    editor: editor ?? null,
    activeDoc: activeDoc ?? null,
    hasProject: Boolean(hasProject),
    panel,
    split,
    timer,
    display,
  }), [toolbar, canvas, map, timeline, layout, view, send, editor, activeDoc, hasProject, panel, split, timer, display])
}
