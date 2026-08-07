/**
 * useAssetUrl.js — resolve a stored asset path to a URL the webview can render.
 *
 * The underlying convertFileSrc call is cached per (project, path), so a card
 * that re-renders does not flicker: the URL resolves synchronously from cache on
 * every render after the first.
 */
import { useEffect, useState } from 'react'
import { assetUrl } from '../lib/assets'

export function useAssetUrl(projectName, relativePath) {
  const [url, setUrl] = useState(null)

  useEffect(() => {
    if (!projectName || !relativePath) {
      setUrl(null)
      return
    }

    let cancelled = false
    assetUrl(projectName, relativePath).then((resolved) => {
      if (!cancelled) setUrl(resolved)
    })

    return () => {
      cancelled = true
    }
  }, [projectName, relativePath])

  return url
}
