---
name: add-toolbar-item
description: Add an action to Inkblot's chrome — a toolbar item, a ⌘K command, a keyboard shortcut — with stable ids, the right default set, published on/off state, and tests.
---

# Add an action or toolbar item

Every action is registered with `useCommands` (`src/lib/commands.ts`; its header has the
shape). A toolbar item also does the following. These are the steps in ARCHITECTURE.md →
Recipes → A toolbar item, listed here so they aren't missed:

1. `src/lib/chromeLayout.ts`: add it to `TOOLBAR_ITEMS` with id `inkblot.<area>.<name>`,
   a sentence-case label, a semantic icon (registered in `src/ui/icons.js`) and its
   contexts. Ids are keys in saved layouts. Never rename or reuse one. A removed id goes
   in `RETIRED_TOOLBAR_IDS`.
2. `src/components/toolbar/registry.jsx`: add its component, built from `ToolbarControls.jsx`.
3. Default sets: before `MORE` only if nearly everyone needs it (docs/DESIGN.md §10),
   otherwise after it.
4. With no live editor, it renders **disabled, never omitted**.
5. On/off state comes from the surface: editor facts in `ToolbarState`/`ActiveMarks`, canvas
   facts in `CanvasToolbarState`, app settings in `ViewOptions`. A new field there is a
   Rust change, so use the add-bridge-message skill.
6. A help topic, if a control points at one, must exist in `src/lib/help.ts`.
7. Add the id to the list in `tests/unit/chromeLayout.mjs`, then run
   `npm test -- chromeLayout toolbar icons help`.
