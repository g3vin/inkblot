import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // .claude/worktrees holds other checkouts of this repo; each lints itself.
  globalIgnores(['dist', 'src-tauri/target', '.claude']),
  {
    files: ['**/*.{js,jsx,mjs,ts,tsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      // `_` marks a name kept only to leave it out of a rest: `{ dropped: _dropped, ...kept }`.
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      'react-hooks/immutability': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  /* TypeScript files parse with the TS parser and use its unused-vars rule, which
     understands type-only references the base rule flags as unused. Not type-aware
     (no `projectService`): `npm run typecheck` is what checks types. */
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommended],
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        varsIgnorePattern: '^_',
        argsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
    },
  },
  /* typeshare's output. A command with nothing to say (`NewTabCommand`) is an empty
     struct in Rust and an empty interface here, and it has to exist: adjacent tagging
     sends a payload for every variant. */
  {
    files: ['src/types/inkblot-core.ts'],
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  /* Scripts injected into pinterest.com, read with Vite's ?raw. They are not
     modules: the prologue constants below are prepended by the builders in
     pinterestScrape.js before the script is evaluated in the remote page. */
  {
    files: ['src/lib/pinterestScripts/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        requestId: 'readonly',
        maxPins: 'readonly',
        timeoutMs: 'readonly',
        requestedUrl: 'readonly',
        debugState: 'readonly',
      },
    },
  },
  {
    files: ['scripts/**/*.{js,mjs}', 'tests/**/*.mjs', 'vite.config.js', 'eslint.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  /* The unit suites run under Node with a custom ESM loader, and mount components
     into jsdom — so they see both sets of globals. */
  {
    files: ['tests/unit/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
