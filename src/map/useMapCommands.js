/**
 * useMapCommands.js — a map's actions in the command palette (⌘K).
 *
 * Registered by the active map only, so ⌘K offers the map you are looking at. The
 * tools keep their single-letter keys, handled by the map itself (MapSurface's
 * onKeyDown), so they are shown here (`shortcut`) rather than bound (`keys`).
 */
import { useCommands } from '../lib/commands'
import { VIEW_COMMAND_TITLES } from './mapViewMenu'

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

export function useMapCommands({ active, mapKind, setTool, zoomIn, zoomOut, fitAll, hasSelection, removeSelection, openExport, importGeo, openSearch, showOnTimeline, addEventHere, showInspector, viewMenu = [], onViewOption, upOneLevel, openSurface }) {
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
      { id: 'map.find', section: 'Map', title: 'Find on this map…', icon: 'search', shortcut: '⌘F', keywords: ['search', 'go to', 'fly to', 'place', 'where is', 'locate'], run: () => openSearch?.() },
      { id: 'map.show-on-timeline', section: 'Map', title: 'Show this place on the timeline', icon: 'timeline', keywords: ['events', 'chronology', 'when', 'history'], when: () => Boolean(showOnTimeline), run: () => showOnTimeline?.() },
      { id: 'map.add-event-here', section: 'Map', title: 'Add a timeline event here', icon: 'timeline', keywords: ['event', 'chronology', 'happens', 'scene'], when: () => Boolean(addEventHere), run: () => addEventHere?.() },
      { id: 'map.import', section: 'Map', title: 'Import places and borders…', icon: 'import', keywords: ['geojson', 'kml', 'google earth', 'gis', 'shapes', 'countries', 'open'], when: () => Boolean(importGeo), run: () => importGeo?.() },
      { id: 'map.up', section: 'Map', title: 'Go up to the map this is inside', icon: 'up-level', keywords: ['up', 'parent', 'out', 'back', 'system', 'galaxy', 'breadcrumb'], when: () => Boolean(upOneLevel), run: () => upOneLevel?.() },
      { id: 'map.open-surface', section: 'Map', title: 'Open the selected body’s surface', icon: 'world', keywords: ['planet', 'world', 'globe', 'drill', 'into', 'star'], when: () => Boolean(openSurface), run: () => openSurface?.() },
      { id: 'map.inspector', section: 'Map', title: 'Show the map’s settings', icon: 'sidebar', keywords: ['inspector', 'panel', 'scale', 'style', 'travel', 'journeys'], run: showInspector },
      // The View menu, each choice by name.
      // A choice already made is not offered again; an on/off is always offered.
      ...viewMenu.filter((entry) => VIEW_COMMAND_TITLES[entry.id] && !entry.disabled && !(entry.checked && /\.(view|projection|imagery|radial)\./.test(entry.id))).map((entry) => ({
        id: `map.view.${entry.id}`,
        section: 'Map',
        title: VIEW_COMMAND_TITLES[entry.id][0],
        icon: 'globe',
        keywords: ['map', 'view', ...VIEW_COMMAND_TITLES[entry.id][1]],
        run: () => onViewOption?.(entry.id),
      })),
    ]
  }, [active, addEventHere, fitAll, hasSelection, importGeo, mapKind, openSearch, showOnTimeline, onViewOption, openExport, openSurface, removeSelection, setTool, showInspector, upOneLevel, viewMenu, zoomIn, zoomOut])
}
