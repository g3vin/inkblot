/**
 * Node ESM loader for the canvas suites.
 *
 * Five jobs:
 *   1. map the @tauri-apps modules onto the in-memory stubs
 *   2. resolve the extensionless relative imports Vite allows but Node does not
 *   3. transpile .jsx and .ts, so a suite can mount a real component or import a
 *      converted module
 *   4. serve a `?raw` import as the file's text, the way Vite does (the citation styles)
 *   5. import JSON without an import attribute, as Vite does
 *
 * (3) is what lets the `dom` suite render CanvasSurface itself. esbuild is a dev
 * dependency in its own right; Vite does not provide it. The automatic JSX runtime is used,
 * matching the app's Vite config — no `import React` needed in a component.
 *
 * .ts is erased rather than checked — esbuild does not typecheck, and nothing here
 * should. `npm run typecheck` is what looks at the types; this only has to make a
 * .ts module runnable, so converting a module to TypeScript keeps it under test.
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

  if (specifier.endsWith('?raw') && context.parentURL) {
    return { url: new URL(specifier, context.parentURL).href, shortCircuit: true }
  }

  if (specifier.startsWith('.') && context.parentURL) {
    const base = fileURLToPath(new URL(specifier, context.parentURL))

    // A bare directory import (`../icons`) resolves to its index — Vite does this,
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
  if (url.endsWith('?raw')) {
    const text = readFileSync(fileURLToPath(url.slice(0, -'?raw'.length)), 'utf8')
    return { format: 'module', source: `export default ${JSON.stringify(text)}`, shortCircuit: true }
  }

  // CSS is imported for its side effect only (CanvasPane imports Canvas.css).
  if (url.endsWith('.css')) {
    return { format: 'module', source: 'export default {}', shortCircuit: true }
  }

  // Vite imports JSON without `with { type: 'json' }`, which Node refuses.
  if (url.endsWith('.json') && context.importAttributes?.type !== 'json') {
    const text = readFileSync(fileURLToPath(url), 'utf8')
    return { format: 'module', source: `export default ${text}`, shortCircuit: true }
  }

  const ext = url.slice(url.lastIndexOf('.'))
  const loader = LOADERS[ext]
  if (!loader) return next(url, context)
  const source = readFileSync(fileURLToPath(url), 'utf8')

  const { code } = await transform(source, {
    loader,
    format: 'esm',
    jsx: 'automatic',
    sourcefile: url,
  })
  return { format: 'module', source: code, shortCircuit: true }
}
