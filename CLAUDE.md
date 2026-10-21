# CLAUDE.md

Guidance for AI agents working in this repository.

## Read first

- **[ARCHITECTURE.md](ARCHITECTURE.md)**: how the page, the Rust crates and the shells
  fit together. Read it before changing anything that crosses a boundary.
- **[CONTRIBUTING.md](CONTRIBUTING.md)**: branches, Conventional Commits, code style.
- **[README.md → Checks](README.md#checks)**: the commands to run before committing.

## Design language (required for all UI work)

**Before making any user-facing change — a new feature, a fix to something visible,
copy, styling, layout, icons, or a new component — read [docs/DESIGN.md](docs/DESIGN.md)
and follow it.** It is the single source of truth for how Inkblot looks, feels and
speaks. The short version:

- Build from the primitives in `src/ui/` (`Button`, `IconButton`, `Segmented`, `Menu`,
  `Popover`, `Sheet`, `Dialog`, `Section` + `FormRow`/`Toggle`/`Stepper`/`SelectMenu`,
  `Panel`, `Card`, `EmptyState`, `InkPicker`, `FloatingCapsule`, …). Don't restyle bare
  elements or write one-off modals, menus or colour pickers.
- Never hard-code a colour, font, radius or shadow. Use the tokens in
  `src/styles/tokens.css`. Anything a writer colours uses an ink id from
  `src/lib/palette.ts`, drawn with `inkColor()`.
- Typefaces: Inter (`--font-ui`) for chrome, eyebrows included (`.ib-eyebrow`, bold
  capitals), Literata (`--font-editor`) for the writer's words, and Courier Prime
  (`--font-type`) only for small typewritten accents (`.ib-meta`, `Kbd`, empty-state
  titles).
- Icons: `<Icon name="…" />` (Phosphor Light; Fill when active), 16 or 20px, named by
  meaning in `src/ui/icons.js`.
- The document is the room: a seamless writing surface in a card on the window's tinted
  tray, with the sidebars docked on the tray or hovering over the card, and the toolbar
  ruled off at the card's top (docs/DESIGN.md §6).
- Keep the surface simple. Register every new action with `useCommands`
  (`src/lib/commands.ts`) so it appears in the ⌘K palette, and put advanced tools in
  "More" menus or inspector panels.
- Copy is plain and warm: sentence case, verb first, no jargon on the surface.
- Liquid Glass appears on iOS/iPadOS only, and only on floating chrome over the page
  (the `.floating-capsule` surface: `FloatingToolbar`, `FloatingActionButton`,
  `FloatingCapsule`).
- The logo is `Mark` / `Wordmark` / `AppIcon` from `src/ui`: black on white, never
  recoloured or redrawn (regenerate it with `docs/brand/generator/`).
- Both themes, AA contrast, keyboard access and reduced motion, every time.

Check UI work with `npm run lint:design` (it must pass) and in the showcase
(`npm run dev`, then `/?design`) in light and dark. If the system lacks something you
need, extend it: `src/ui` + showcase + `docs/DESIGN.md`, in the same change. Don't work
around it locally.

## Work in progress

Every surface is on the design language. What's left (the logo check on real devices,
moving bare buttons onto `src/ui`) and the gotchas are in
[docs/design-handoff.md](docs/design-handoff.md). Read it before design-system work.

## Code comments

The full standard is in [CONTRIBUTING.md → Comments](CONTRIBUTING.md#comments). The rules:

- **Explain why, not what or when.** Keep intent, invariants, and ordering,
  performance or security constraints the code can't show.
- **Never write history:** "changed from", "previously", "now uses", "fixed the bug
  where", dates. Never leave commented-out code. Never address a comment to an AI
  assistant or write one as one. History goes in the commit message, the PR
  description or CHANGELOG.md; how modules fit together goes in ARCHITECTURE.md.
- **Fixing a bug:** explain it in the commit message. Add a comment only if the fixed
  code would look wrong or removable without it, and then state the constraint.
- **Workarounds** for outside bugs: one or two lines, a link to the issue, and when it
  can be removed.
- **TODOs** are `TODO(#123): …` or carry a one-line reason. A lint suppression
  carries its reason after `--`.

```js
// Bad:  Fixed rename losing the last edit (we used to save after renaming).
// Good: Close the document first: its pane's final autosave writes to the path it had.
```

## Checks

These must pass before you commit (what each catches: [README → Checks](README.md#checks)):

- `npm run lint` (0 errors and 0 warnings), `npm run lint:design`, `npm run typecheck`,
  `npm test`, `npm run build`
- When you touch Rust or a mirrored module: `npm run parity`, `npm run types:check`,
  and `cd src-tauri && cargo build --workspace && cargo test --workspace`
