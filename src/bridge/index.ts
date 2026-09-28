/**
 * The bridge, as the rest of the app imports it.
 *
 * The protocol types themselves come from `src/types` — they are generated, and the
 * bridge is not their owner. What is exported here is the machinery: the two client
 * ends, the transports, the registry, the drag hand-off, and the React glue.
 */
export { shellBridge, documentSurface, editorRegistry } from './appBridge'
export { useBridgeEvent, useBridgeState, useLatestBridgeState, latestBridgeEvent, useRegisterEditor } from './useBridge'
export { dragHandoff, createDragHandoff, DragPayloadKind } from './dragHandoff'
export type { DragHandoff, DragOrigin, DragSession } from './dragHandoff'
export { createShellBridge, createSurfaceBridge, BridgeRequestError } from './client'
export type { ShellBridge, SurfaceBridge, CommandPayload, EventPayload } from './client'
export { createInProcessTransports, createDeferredTransports } from './transport'
export { createEditorRegistry } from './editorRegistry'
export { createDocumentSurface } from './surface'
export { createCoalescer, frameScheduler, immediateScheduler } from './coalesce'
export { resolveAnchor, readAnchor, readSelectionAnchor, findText } from './anchors'
export { readToolbarState, readSelectionContext, TOOLBAR_DEFAULTS } from './readState'
