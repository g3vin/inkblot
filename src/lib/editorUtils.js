/**
 * editorUtils.js — small shared helpers for working with TipTap editor instances.
 */

/**
 * True when a TipTap editor instance is fully mounted and safe to use:
 * not destroyed, has a schema/view, and its command API is available.
 * Guards against the window between React unmount and editor teardown.
 */
export const isEditorReady = (instance) => Boolean(
  instance &&
  !instance.isDestroyed &&
  instance.state?.schema?.nodes &&
  instance.view &&
  !instance.view.isDestroyed &&
  instance.commandManager &&
  instance.commands &&
  typeof instance.chain === 'function'
)
