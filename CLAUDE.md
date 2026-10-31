# CLAUDE.md

Guidance for AI agents working in this repository.

<!-- Maintainers: this file loads into every session, so keep it short. Area-specific
guidance belongs in .claude/rules/ (path-scoped), procedures in .claude/skills/. HTML
comments like this one are stripped before loading. -->

## Never read the writer's documents

The person who uses this repository writes with Inkblot. Their projects are private
personal writing. **Never read, open, search, quote, summarise, copy, screenshot or edit
anything inside them, and never load their contents into this conversation, a subagent,
memory or any file.** This holds even when a task seems to need it (debugging a real
document, reproducing a bug, checking a migration): ask the user instead, and work from
the mock or a fixture.

- Off-limits: Inkblot's app data folder (`~/Library/Application Support/com.inkblot.app/`
  on macOS, `com.inkblot.app` under the app data folder elsewhere), with its projects,
  `preferences.json` (it holds excerpts), stats and version history; and every project
  folder linked elsewhere (listed in `.inkblot-project-locations.json` in that folder).
- Allowed: the project *names*, from a plain `ls` of the app data folder. Nothing deeper.
- Test and read only Inkblot's own data: the in-memory mock at `/?mock`
  (`scripts/dev/tauri-mock.js`), `showcase/fixtures/`, and the stubs in `tests/unit/`.
  Never run the desktop app against the real projects to look at or screenshot it.

`scripts/claude/private-writing.mjs` (a PreToolUse hook) and the `deny` rules in
`.claude/settings.json` enforce this; don't work around them.

## Read first

- **[ARCHITECTURE.md](ARCHITECTURE.md)**: how the page, the Rust crates and the shells fit
  together. Before changing anything that crosses a boundary, read "The pieces" and the
  section for the area (`grep -n '^## ' ARCHITECTURE.md`). Always read "Things that will bite you".
- **[CONTRIBUTING.md](CONTRIBUTING.md)**: branches, Conventional Commits, code style.
- `.claude/rules/` loads the UI, Rust, bridge and test rules when you touch those paths.
  UI work follows [docs/DESIGN.md](docs/DESIGN.md); its brief loads with the UI rule.
- Skills: `run-app` (see a change in a browser), `add-bridge-message`, `add-toolbar-item`,
  `design-review`, `perf-review`. Agents: `checks` (runs checks, reports only failures),
  `explore-inkblot` (read-only locator that knows this map).

## Where things live

- Every module opens with a header comment saying what it owns. Read the first 30 lines,
  then grep for the part you need; several files run past 1,000 lines.
- `src/map`, `src/timeline`, `src/canvas` are UI; their models are in `src/lib/map/`,
  `src/lib/timeline/` and `src/lib/canvas*.js`.
- `src/lib/commands.ts` is the ⌘K registry; `src/bridge/commands.ts` runs NativeCommands.
  `docLock` is the per-document write mutex; `docLocks` is the documents a writer locked.
- Window events shared across modules are named in `src/lib/appEvents.ts`; single-owner
  events live with their owner (grep the constant).
- A JS module with a Rust twin says `Mirrors:` in its header; change both and run
  `npm run parity` (table: ARCHITECTURE.md → "JavaScript and Rust parity").
- Generated, never edit by hand: `src/types/inkblot-core.ts` (`npm run types`; excluded
  from search, so grep the Rust type instead), `scripts/design-baseline.json`
  (`npm run lint:design -- --update-baseline`), the `--spring-*` tokens
  (`scripts/gen-spring-tokens.mjs`). Scripts are indexed in `scripts/README.md`.

## Working efficiently

- Search with the Grep tool or `rg`, never `grep -r` (it walks build output; a hook blocks it).
- Prefer the LSP tool for definitions, references and types when it is available.
- Pick checks with `npm run affected`, not by guessing suites. For a long check run, use
  the `checks` agent so the output stays out of this conversation.

## Code comments

Full standard: [CONTRIBUTING.md → Comments](CONTRIBUTING.md#comments).

- Explain why, not what or when: intent, invariants, ordering, performance or security
  constraints the code can't show.
- Never write history ("previously", "now uses", "fixed the bug where", dates), never leave
  commented-out code, never address a comment to an AI. History goes in the commit message.
- A bug fix is explained in the commit message; comment only if the fixed code would look
  removable, and then state the constraint. Workarounds link the issue and say when to remove.
- `TODO(#123): …` or a one-line reason. A lint suppression carries its reason after `--`.

```js
// Bad:  Fixed rename losing the last edit (we used to save after renaming).
// Good: Close the document first: its pane's final autosave writes to the path it had.
```

## Checks

Must pass before you commit ([README → Checks](README.md#checks)):

- `npm run check` (lint with 0 warnings, lint:design, lint:size, typecheck, tests), then `npm run build`.
- Rust or a mirrored module touched: `npm run check:rust` (fmt, clippy, cargo test, parity,
  types:check), then `cd src-tauri && cargo build -q --workspace`.

While iterating: `npm run affected` prints the suites and commands your diff needs;
`npm test -- <suite> [<suite>…]` runs some suites (names in `tests/unit/run.mjs`).

# Compact instructions

When compacting, keep: the files changed and why, failing checks with their key output,
decisions the user made, and the next step. Drop passing output and file contents.
