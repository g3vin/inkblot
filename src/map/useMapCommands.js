/**
 * useMapCommands.js — a map's actions in the command palette (⌘K).
 *
 * Registered by the active map only, so ⌘K offers the map you are looking at. The
 * tools keep their single-letter keys, handled by the map itself (MapSurface's
 * onKeyDown), so they are shown here (`shortcut`) rather than bound (`keys`).
 */
import { useCommands } from '../lib/commands'

const TOOLS = [
  { tool: 'select', title: 'Select and move', icon: 'cursor', shortcut: 'V', keywords: ['pointer', 'arrow', 'move'] },
  { tool: 'pin', title: 'Add a place', icon: 'map-pin', shortcut: 'P', keywords: ['pin', 'marker', 'city', 'location', 'point'] },
  { tool: 'route', title: 'Draw a route', icon: 'map-route', shortcut: 'R', keywords: ['road', 'path', 'line', 'journey', 'river'] },
  { tool: 'region', title: 'Draw a region', icon: 'map-area', shortcut: 'G', keywords: ['area', 'country', 'border', 'shape', 'continent', 'polygon'] },
  { tool: 'label', title: 'Add a label', icon: 'label', shortcut: 'T', keywords: ['text', 'name', 'caption'] },
  { tool: 'ruler', title: 'Measure a distance', icon: 'ruler', shortcut: 'M', keywords: ['ruler', 'how far', 'length'] },
  { tool: 'area', title: 'Measure an area', icon: 'measure-area', shortcut: 'A', keywords: ['size', 'square kilometres', 'acres'] },
  { tool: 'calibrate', title: 'Set the scale from two points', icon: 'calibrate', keywords: ['calibrate', 'scale', 'units'] },
  { tool: 'pan', title: 'Move the map', icon: 'hand', shortcut: 'H', keywords: ['pan', 'hand', 'drag'] },
]

export function useMapCommands({ active, mapKind, setTool, zoomIn, zoomOut, fitAll, hasSelection, removeSelection, openExport, showInspector }) {
  useCommands(() => {
    if (!active) return []
    const plane = mapKind === 'blank' || mapKind === 'image'
    return [
      ...TOOLS.filter((entry) => entry.tool !== 'calibrate' || plane).map((entry) => ({
        id: `map.tool.${entry.tool}`,
        section: 'Map',
        title: entry.title,
        icon: entry.icon,
        shortcut: entry.shortcut,
        keywords: ['map', 'tool', ...entry.keywords],
        run: () => setTool(entry.tool),
      })),
      { id: 'map.zoom-in', section: 'Map', title: 'Zoom in on the map', icon: 'zoom-in', keywords: ['closer', 'magnify'], run: zoomIn },
      { id: 'map.zoom-out', section: 'Map', title: 'Zoom out on the map', icon: 'zoom-out', keywords: ['further', 'shrink'], run: zoomOut },
      { id: 'map.fit', section: 'Map', title: 'Zoom to fit the map', icon: 'fit', shortcut: '⌘0', keywords: ['whole map', 'everything', 'reset view', 'frame'], run: fitAll },
      { id: 'map.delete', section: 'Map', title: 'Delete the selection', icon: 'delete', keywords: ['remove', 'erase'], when: () => hasSelection, run: removeSelection },
      { id: 'map.export', section: 'Map', title: 'Export map…', icon: 'export', keys: 'Mod+Alt+E', keywords: ['png', 'svg', 'pdf', 'print', 'picture', 'image', 'save as', 'copy image'], run: openExport },
      { id: 'map.inspector', section: 'Map', title: 'Show the map’s settings', icon: 'sidebar', keywords: ['inspector', 'panel', 'scale', 'style', 'travel', 'journeys'], run: showInspector },
    ]
  }, [active, fitAll, hasSelection, mapKind, openExport, removeSelection, setTool, showInspector, zoomIn, zoomOut])
}
