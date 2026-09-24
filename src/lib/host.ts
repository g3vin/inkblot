/**
 * host.ts — which parts of the chrome this page is responsible for drawing.
 *
 * Under Tauri, all of it. Under the Swift shell, only what the shell does not draw
 * natively: a piece the shell draws must not also render here, or the window has two
 * file trees. The shell says which pieces it draws when it injects
 * `window.__inkblotNative` (see `native/inkblot-core/inkblot-core/Web/native-host.js`).
 *
 * Asked, not assumed: one `dist/` serves both shells, so nothing about the host is
 * compiled into the bundle.
 */
import { detectNativeHost } from '../bridge/transport'

/**
 * The pieces the shell can take over.
 *
 *  - `fileTree`     the left sidebar — the shell draws the project's tree natively
 *  - `windowChrome` the titlebar and fullscreen tracking. The window has a real toolbar,
 *                   which places the traffic lights and drags the window; the shell says
 *                   how much of the page its glass sidebars cover (`setPanelInsets`).
 *  - `rightSidebar` search, clipboard, workbench, notes and history — drawn by the shell
 *                   from what `useNativeSidebar` publishes
 *  - `notePreviews` the cards that open over a note's marker — drawn by the shell as
 *                   Liquid Glass, placed from what `useNativeNotePreviews` publishes
 *  - `toolbar`      the formatting toolbar — a real window toolbar, driven by the pushed
 *                   `ToolbarState`. The page then draws its toolbar row only for a canvas's
 *                   own toolbar or a comparison's, below the window's.
 *  - `bubble`       the bubble editor — each word a Liquid Glass bubble, drawn by the
 *                   shell from what `useBubbleSessions` publishes
 *  - `wordCount`    the per-pane word-count badge — drawn by the shell as Liquid Glass,
 *                   placed from what `useEditorWordCount` publishes
 *  - `projectPicker` the landing page — the shell picks a project in a window of its own
 *                   and sends `openProject`; with no project open the page draws nothing
 *  - `pageSetup`    Print Layout's page setup, book and binding settings — the
 *                   inspector's Page tab, drawn from what `usePrintLayoutController`
 *                   publishes. Without it the page shows its own Page Setup sheet.
 *  - `printControls` the Print Layout button (bottom-left of the editor) and its zoom
 *                   control (bottom-right) — drawn by the shell as Liquid Glass from
 *                   `pageLayoutState`. The page leaves them room and draws no zoom bar.
 *  - `tabDock`      the floating tab bar at the bottom — the shell draws it from what
 *                   `useNativeTabDock` publishes and sends back selections and closes
 *  - `draftPane`    the new-tab chooser. The page keeps the pane (a draft holds it
 *                   open) and reports where it is; the shell draws the chooser there
 *  - `sentenceBubble` the Analytic Bubble — the page parses, the shell draws the trees
 */
export type NativeChrome =
  | 'fileTree'
  | 'windowChrome'
  | 'rightSidebar'
  | 'notePreviews'
  | 'bubble'
  | 'toolbar'
  | 'wordCount'
  | 'projectPicker'
  | 'pageSetup'
  | 'printControls'
  | 'tabDock'
  | 'draftPane'
  | 'sentenceBubble'

export function isNativeShell(): boolean {
  return detectNativeHost() !== null
}

export function nativeOwns(part: NativeChrome): boolean {
  return detectNativeHost()?.chrome?.includes(part) ?? false
}
