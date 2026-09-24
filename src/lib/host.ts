/**
 * host.ts — which parts of the chrome this page is still responsible for.
 *
 * Under Tauri, all of it. Under the Swift shell, whatever has not moved yet: Phase 5
 * moves the chrome a piece at a time, and a piece that has moved must stop rendering
 * here, or the window has two file trees. The shell says which pieces it draws when it
 * injects `window.__inkblotNative` (see `native/…/Web/native-host.js`).
 *
 * Asked, not assumed. A flag compiled into the bundle would make the same `dist/`
 * behave differently depending on which build made it; asking the host keeps one
 * bundle for both shells, which is what lets the Tauri app stay shippable while the
 * port is under way.
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
 *  - `pageSetup`    Print Layout's page setup, book and binding settings — the
 *                   inspector's Page tab, drawn from what `usePrintLayoutController`
 *                   publishes. Without it the page shows its own Page Setup sheet.
 */
export type NativeChrome = 'fileTree' | 'windowChrome' | 'rightSidebar' | 'notePreviews' | 'pageSetup'

export function isNativeShell(): boolean {
  return detectNativeHost() !== null
}

export function nativeOwns(part: NativeChrome): boolean {
  return detectNativeHost()?.chrome?.includes(part) ?? false
}
