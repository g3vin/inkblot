/**
 * mapPanelCommands.js — a MapPanelView `handlers` for a map drawn elsewhere: every
 * handler sends the map a command by surface id (MapSurface's vocabulary).
 */
import { shellBridge } from '../bridge'

export function mapPanelCommands(surfaceId) {
  const send = (command, detail) => shellBridge.send('mapCommand', { surfaceId, command, detail })
  return {
    get(id) {
      if (id === '@tab') return (tab) => send('panel-tab', { id: tab })
      if (id === '@back') return () => send('panel-back', {})
      return (value) => (value === undefined
        ? send('panel-action', { id })
        : send('panel-field', { id, value }))
    },
  }
}
