---
name: run-app
description: See an Inkblot UI change in a real browser without the Tauri shell — the app against an in-memory mock (?mock), or the design showcase (?design), with headless screenshots in light and dark. Use to check any visible change before calling it done.
---

# Run Inkblot in a browser

The page runs outside the desktop shell against `scripts/dev/tauri-mock.js`: an in-memory
projects folder at `/mock` ("Novel" with two chapters and notes, "Short stories"). Writes
land in it, native menus are recorded on `window.__ibMenus`, and every other native
command answers null. Anything that needs real Rust (models, Read Aloud, print to PDF)
won't work here.

1. Start Vite in the background: `npm run dev` (http://localhost:5173).
2. Open one of these:
   - `http://localhost:5173/?mock` for the app (`src/main.jsx` loads the mock)
   - `http://localhost:5173/?design` for the showcase of every primitive (`src/dev/DesignShowcase.jsx`)
3. Screenshot it headlessly. This needs `playwright-core`, which isn't a dependency, so
   install it with `npm i --no-save playwright-core`:
   ```
   node scripts/dev/screenshot.mjs <scratchpad>/app dark            # landing, editor, scrolled
   node scripts/dev/screenshot.mjs <scratchpad>/ds light --design   # the showcase
   ```
   Then Read the PNGs. Do both themes for any visual change.
4. To shoot catalogued surfaces (`design-review/surfaces.json`: every sheet, inspector
   tab, menu, settings page and map), run `node scripts/dev/capture.mjs --run <name> --only 'inspector-*'`
   (`--list` prints the ids). For a specific interaction, `capture.mjs` and `measure.mjs` show
   how to drive the page (and `window.__ibMenuClick('More › Rename…')` for native menus).
   If a browser tool is attached, you can drive `?mock` with it instead.

Only ever look at the mock's projects. Never run or screenshot the desktop app against
the writer's real projects: they are private (CLAUDE.md → "Never read the writer's
documents").

Write screenshots to the scratchpad, never into the repo. Stop the dev server when done.
