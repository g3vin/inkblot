/**
 * MapInspectorPanel — the Map tab: the active map's panel, drawn from what the map
 * publishes (`mapChromeChanged`) and sent back as map commands. The same MapPanelView
 * the map floats when the inspector is shut.
 */
import { useMemo } from 'react'
import { useLatestBridgeState } from '../../bridge'
import { mapPanelCommands } from '../../map/mapPanelCommands'
import MapPanelView from '../../map/MapPanelView'
import Icon from '../../ui/Icon.jsx'

const NO_MAP = {}

export default function MapInspectorPanel() {
  const chrome = useLatestBridgeState('mapChromeChanged', NO_MAP)
  const state = chrome?.state
  const handlers = useMemo(() => mapPanelCommands(state?.surfaceId), [state?.surfaceId])

  if (!state?.panel) {
    return (
      <div className="inspector-placeholder">
        <Icon name="map" size={20} />
        <span>Open a map to see its places, routes and layers here.</span>
      </div>
    )
  }
  return (
    <div className="map-inspector-panel">
      <MapPanelView panel={state.panel} handlers={handlers} />
    </div>
  )
}
