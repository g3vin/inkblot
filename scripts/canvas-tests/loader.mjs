/**
 * Node ESM loader for the canvas suites.
 *
 * Three jobs:
 *   1. map the @tauri-apps modules onto the in-memory stubs
 *   2. resolve the extensionless relative imports Vite allows but Node does not
 *   3. transpile .jsx, so a suite can mount a real component
 *
 * (3) is what lets the `dom` suite render CanvasSurface itself. esbuild comes with
 * Vite, so this adds no dependency. The automatic JSX runtime is used, matching the
 * app's Vite config — no `import React` needed in a component.
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
      for (const index of ['/index.js', '/index.jsx']) {
        const c = new URL(specifier + index, context.parentURL)
        if (existsSync(fileURLToPath(c))) return { url: c.href, shortCircuit: true }
      }
    }

    if (!existsSync(base)) {
      for (const ext of ['.js', '.jsx']) {
        const c = new URL(specifier + ext, context.parentURL)
        if (existsSync(fileURLToPath(c))) return { url: c.href, shortCircuit: true }
      }
    }
  }

  return next(specifier, context)
}

export async function load(url, context, next) {
  if (url.endsWith('.jsx')) {
    const source = readFileSync(fileURLToPath(url), 'utf8')
    const { code } = await transform(source, {
      loader: 'jsx',
      format: 'esm',
      jsx: 'automatic',
      sourcefile: url,
    })
    return { format: 'module', source: code, shortCircuit: true }
  }

  // CSS is imported for its side effect only (CanvasPane imports Canvas.css).
  if (url.endsWith('.css')) {
    return { format: 'module', source: 'export default {}', shortCircuit: true }
  }

  return next(url, context)
}
