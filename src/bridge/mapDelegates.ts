/**
 * mapDelegates.ts — the map half of the protocol, over what a map already listens to.
 *
 * The same translation as `canvasDelegates.ts`: a native shell names a map by surface
 * id, and this turns the id back into the element and dispatches the command a map
 * receives from the page (`mapEvents.js`). A command for a map no longer mounted is
 * dropped: it was aimed at something the user could see.
 */
import { dispatchMapCommand, mapSurfaceById } from '../map/mapEvents'
import type { SurfaceDelegates } from './surface'

export const mapDelegates: SurfaceDelegates = {
  mapCommand({ surfaceId, command, detail }) {
    const surface = mapSurfaceById(surfaceId)
    if (!surface) return
    dispatchMapCommand(surface, command, (detail ?? {}) as Record<string, unknown>)
  },
}
