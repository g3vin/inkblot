/**
 * Node ESM loader for the canvas suites.
 *
 * Four jobs:
 *   1. map the @tauri-apps modules onto the in-memory stubs
 *   2. resolve the extensionless relative imports Vite allows but Node does not
 *   3. transpile .jsx and .ts, so a suite can mount a real component or import a
 *      converted module
 *   4. neutralize `import.meta.glob`, which is Vite's and has no Node equivalent
 *
 * (3) is what lets the `dom` suite render CanvasSurface itself. esbuild comes with
 * Vite, so this adds no dependency. The automatic JSX runtime is used, matching the
 * app's Vite config — no `import React` needed in a component.
 *
 * .ts is erased rather than checked — esbuild does not typecheck, and nothing here
 * should. `npm run typecheck` is what looks at the types; this only has to make a
 * converted module runnable, so a Phase 3 conversion does not quietly drop a module
 * out of the suites that cover it.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { transform } from 'esbuild'

const HERE = new URL('.', import.meta.url)

const MAP = {
  '@tauri-apps/plugin-fs': new URL('stub-fs.mjs', HERE).href,
  '@tauri-apps/api/path': new URL('stub-path.mjs', HERE).href,
  '@tauri-apps/api/core': new URL('stub-core.mjs', HERE).href,
  '@tauri-apps/api/webview': new URL('stub-webview.mjs', HERE).href,
  lodash: new URL('stub-lodash.mjs', HERE).href,
}

export async function resolve(specifier, context, next) {
  if (MAP[specifier]) return { url: MAP[specifier], shortCircuit: true }

  if (specifier.startsWith('.') && context.parentURL) {
    const base = fileURLToPath(new URL(specifier, context.parentURL))

    // A bare directory import (`../anicon`) resolves to its index — Vite does this,
    // Node does not.
    if (existsSync(base) && statSync(base).isDirectory()) {
      for (const index of ['/index.js', '/index.jsx', '/index.ts']) {
        const c = new URL(specifier + index, context.parentURL)
        if (existsSync(fileURLToPath(c))) return { url: c.href, shortCircuit: true }
      }
    }

    if (!existsSync(base)) {
      for (const ext of ['.js', '.jsx', '.ts']) {
        const c = new URL(specifier + ext, context.parentURL)
        if (existsSync(fileURLToPath(c))) return { url: c.href, shortCircuit: true }
      }
    }
  }

  return next(specifier, context)
}

/** File extension → the esbuild loader that erases it. Anything else is left to Node. */
const LOADERS = { '.jsx': 'jsx', '.ts': 'ts' }

export async function load(url, context, next) {
  // CSS is imported for its side effect only (CanvasPane imports Canvas.css).
  if (url.endsWith('.css')) {
    return { format: 'module', source: 'export default {}', shortCircuit: true }
  }

  const ext = url.slice(url.lastIndexOf('.'))
  const loader = LOADERS[ext]
  const isSource = url.includes('/src/')
  if (!loader && !isSource) return next(url, context)

  let source = readFileSync(fileURLToPath(url), 'utf8')

  /**
   * `import.meta.glob` is a Vite build-time transform, not a runtime function, so a
   * module using it throws on import under Node before any of its exports exist —
   * which is what kept readAloud.js, and its chunker, unreachable from here.
   *
   * It is rewritten to a call returning an empty map. Anything that actually needs the
   * globbed assets (the bundled Kokoro voice files) cannot work outside the app
   * anyway; everything else in the module becomes importable.
   *
   * This runs before the transpile, not instead of it: a module can need both.
   */
  const globbed = isSource && source.includes('import.meta.glob')
  if (globbed) source = source.replaceAll('import.meta.glob', '(() => ({}))')

  if (!loader) {
    return globbed ? { format: 'module', source, shortCircuit: true } : next(url, context)
  }

  const { code } = await transform(source, {
    loader,
    format: 'esm',
    jsx: 'automatic',
    sourcefile: url,
  })
  return { format: 'module', source: code, shortCircuit: true }
}
