---
paths:
  - "src/**/*.css"
  - "src/**/*.jsx"
  - "src/ui/**"
  - "src/styles/**"
---

<!-- Keep in step with docs/DESIGN.md → "The rules, in brief" (the human copy). -->

# UI work

Every user-facing change (feature, visible fix, copy, styling, layout, icons, component)
follows [docs/DESIGN.md](../../docs/DESIGN.md). The brief:

- Build from the primitives in `src/ui/` (`Button`, `IconButton`, `Segmented`, `Menu`,
  `Popover`, `Dialog`, `Section` + `FormRow`/`Toggle`/`Stepper`/`SelectMenu`, `Panel`,
  `Card`, `EmptyState`, `InkWheel`, `InkPicker`, `FloatingCapsule`, …). Don't restyle bare
  elements or write one-off modals, menus or colour pickers.
- Never hard-code a colour, font, radius or shadow. Use the tokens in
  `src/styles/tokens.css`. Anything a writer colours uses an ink id from
  `src/lib/palette.ts`, drawn with `inkColor()`.
- Typefaces: Inter (`--font-ui`) for chrome, eyebrows included (`.ib-eyebrow`, bold
  capitals), Literata (`--font-editor`) for the writer's words, Courier Prime
  (`--font-type`) only for small typewritten accents (`.ib-meta`, `Kbd`, empty-state titles).
- Icons: `<Icon name="…" />` (Phosphor Light; Fill when active), 16 or 20px, named by
  meaning and registered in `src/ui/icons.js` (the `icons` suite checks this).
- The document is the room: a seamless writing surface in a card on the window's tinted
  tray, sidebars docked on the tray or hovering over the card, the toolbar ruled off at
  the card's top (§6).
- Keep the surface simple. Register every new action with `useCommands`
  (`src/lib/commands.ts`) so it appears in ⌘K; advanced tools go in "More" menus or
  inspector panels.
- Copy is plain and warm: sentence case, verb first, no jargon on the surface.
- All motion is physical: springs, never timed curves (§7). CSS uses the `--spring-*`
  tokens (generated from `src/ui/physics.js`), script uses `useSpring` / `SpringValue`. A
  gesture hands its release speed to the spring; anything moving can be grabbed or
  redirected mid-way. Bounce only after momentum.
- Liquid Glass on iOS/iPadOS only, and only on floating chrome over the page (the
  `.floating-capsule` surface).
- The logo is `Mark` / `Wordmark` / `AppIcon` from `src/ui`: black on white, never
  recoloured or redrawn.
- Both themes, AA contrast, keyboard access and reduced motion, every time.
- Missing a primitive or token? Extend the system (`src/ui` + showcase + DESIGN.md) in the
  same change; don't work around it locally.

Read only the DESIGN.md sections the change touches (`grep -n '^## ' docs/DESIGN.md`):

| Touching | Read |
|---|---|
| colours, inks, contrast | §3 Colour, §4 Themes |
| text styles | §5 Typography |
| sidebars, toolbar, card, tray | §6 Layout (long: grep it for the surface's name) |
| spacing, radii, shadows, motion, loading states | §7 (and "Content arriving") |
| icons | §8 Iconography |
| a control, dialog, menu or popover | §9 Components |
| where an action lives | §10 Progressive disclosure |
| copy | §11 Voice and copy |
| iOS / Glass | §12 Platforms |
| a missing primitive or token | §16 Changing the system |

Before design-system work (`src/ui`, `tokens.css`), read the gotchas in
[docs/design-handoff.md](../../docs/design-handoff.md).

- Tokens: grep `src/styles/tokens.css` for the one you need instead of reading it.
- Primitives are exported from `src/ui/index.js`; usage examples are in `src/dev/DesignShowcase.jsx`.
- Look at the change with the run-app skill (`?mock`, or `?design` for the showcase), in
  light and dark.
- Checks: `npm run lint:design` (must pass), then `npm test -- ui icons css toolbar` and the
  suite for the surface you touched.
