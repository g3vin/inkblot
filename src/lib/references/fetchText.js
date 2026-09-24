/**
 * fetchText.js — a GET from the page, through the host.
 *
 * The page cannot fetch another origin (CORS), so lookups go through the host: the
 * Swift shell answers `fetch_text` with URLSession (TauriHost.swift), the Tauri app
 * with reqwest (`print_commands`' neighbour `reference_commands.rs`). Both return
 * `{ status, finalUrl, contentType, body }`, only ever for http(s), with a size cap.
 */
import { invoke } from '@tauri-apps/api/core'

export async function fetchText(url, { accept = '' } = {}) {
  const result = await invoke('fetch_text', { url, accept })
  if (!result || typeof result.body !== 'string') throw new Error('No response')
  return result
}

/** The body parsed as JSON, or an error that says what went wrong. */
export async function fetchJson(url, options) {
  const result = await fetchText(url, options)
  if (result.status >= 400) throw new Error(`HTTP ${result.status}`)
  return JSON.parse(result.body)
}
