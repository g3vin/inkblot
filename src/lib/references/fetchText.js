/**
 * fetchText.js — a GET from the page, through the host.
 *
 * The page cannot fetch another origin (CORS), so lookups go through the Tauri app's
 * `fetch_text` (`reference_commands.rs`, with reqwest). It returns
 * `{ status, finalUrl, contentType, body }`, only ever for http(s), with a size cap.
 */
import { invoke } from '@tauri-apps/api/core'

export async function fetchText(url, { accept = '' } = {}) {
  const result = await invoke('fetch_text', { url, accept })
  if (!result || typeof result.body !== 'string') throw new Error('No response')
  return result
}
