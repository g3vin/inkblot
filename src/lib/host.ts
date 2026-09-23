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
 *  - `windowChrome` traffic-light spacing and fullscreen tracking. The shell draws no
 *                   titlebar row, so the page's toolbar is the top of the window and
 *                   still the place to drag it by; the shell says how much room the
 *                   traffic lights need (`setTitlebarInset`) and does the drag itself.
 *  - `rightSidebar` search, clipboard, workbench, notes and history — drawn by the shell
 *                   from what `useNativeSidebar` publishes
 *  - `notePreviews` the cards that open over a note's marker — drawn by the shell as
 *                   Liquid Glass, placed from what `useNativeNotePreviews` publishes
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
  | 'tabDock'
  | 'draftPane'
  | 'sentenceBubble'

export function isNativeShell(): boolean {
  return detectNativeHost() !== null
}

export function nativeOwns(part: NativeChrome): boolean {
  return detectNativeHost()?.chrome?.includes(part) ?? false
}
