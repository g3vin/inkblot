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
 *  - `windowChrome` the titlebar: dragging, traffic-light spacing, fullscreen tracking.
 *                   A real titlebar makes all three the window's business again.
 */
export type NativeChrome = 'fileTree' | 'windowChrome'

export function isNativeShell(): boolean {
  return detectNativeHost() !== null
}

export function nativeOwns(part: NativeChrome): boolean {
  return detectNativeHost()?.chrome?.includes(part) ?? false
}
