import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // .claude/worktrees holds other checkouts of this repo; each lints itself.
  globalIgnores(['dist', 'public/ort', 'src-tauri/target', '.claude']),
  {
    files: ['**/*.{js,jsx,mjs,ts,tsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^([A-Z_]|motion$)',
        caughtErrors: 'none',
      }],
      'react-hooks/immutability': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  /* TypeScript files parse with the TS parser and use its unused-vars rule, which
     understands type-only references the base rule flags as unused. Not type-aware
     yet (no `projectService`) — `npm run typecheck` is what checks types. */
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommended],
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        varsIgnorePattern: '^([A-Z_]|motion$)',
        argsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
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
    files: ['scripts/**/*.{js,mjs}', 'vite.config.js', 'eslint.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  /* The canvas suites run under Node with a custom ESM loader, and mount components
     into jsdom — so they see both sets of globals. */
  {
    files: ['scripts/canvas-tests/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
