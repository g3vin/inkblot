/** The window's one `StatsRuntime`, and the hooks that start it and read it. */
import { useEffect, useSyncExternalStore } from 'react'
import { documentSurface, latestBridgeEvent, shellBridge } from '../bridge'
import { StatsRuntime } from './runtime.js'
import { watchTray } from './tray.js'

let runtime = null

export function getStatsRuntime() {
  runtime ??= new StatsRuntime({
    bridge: shellBridge,
    surface: documentSurface,
    focusModeOpen: () => Boolean(latestBridgeEvent('viewOptions')?.focusMode),
  })
  return runtime
}

/** Start the stats for this window, for as long as the caller is mounted. */
export function useStatsRuntime() {
  useEffect(() => {
    const stats = getStatsRuntime()
    stats.start()
    const unwatchTray = watchTray(stats)
    return () => {
      unwatchTray()
      stats.stop()
    }
  }, [])
}

/** The runtime, re-rendering the caller on every tick and record. */
export function useStats() {
  const stats = getStatsRuntime()
  useSyncExternalStore(stats.subscribe, stats.getVersion)
  return stats
}
