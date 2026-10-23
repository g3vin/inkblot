---
description: Refine Inkblot's front end without redesigning it — cut words, calm busy layouts, remove duplicates. Findings first, my picks, then small edits.
argument-hint: [<surface> | all | apply]
---

# Inkblot refinement pass

This is a **refinement pass, not a redesign.** The app's look, structure and design
language stay as they are. Your job is to make what's already there quieter and easier
to take in: fewer words, clearer grouping, nothing said or shown twice. Think editor,
not architect. **I decide what changes. You find, propose and then apply my picks.**

Command argument: `$ARGUMENTS`. A surface name (`landing`, `settings`, `inspector`,
`notes`, `canvas`, `map`, `timeline`, `print`, `stats`, `history`, `references`, `⌘K`,
…) reviews that one. `all` reviews every surface, highest-traffic first. `apply`
applies the picks I've given you. Empty: review `landing` and the editor.

## Read first

`CLAUDE.md`, `docs/DESIGN.md` (especially §1, §6, §10 and §11) and
`docs/design-handoff.md`. If `docs/design-review/decisions.md` exists, read it and don't
reopen anything decided there. Every suggestion must already be allowed by DESIGN.md.
Where DESIGN.md is silent, say so and ask; don't invent a rule.

## Look at the real thing

Judge from screenshots, not source alone. Run `npm run dev`, then
`node scripts/dev/audit.mjs design-review/out/refine light` (and `dark`), or
`scripts/dev/screenshot.mjs`, against `tauri-mock.js`. Look at each surface the way a
writer meets it: at 1400×900, at a glance, then a second time reading closely. Note any
surface you couldn't reach through the mock instead of skipping it silently.

## The three questions

Ask all three of every surface, in this order.

### 1. Is this too wordy? (verbosity — the main focus)

- **Count the words a writer has to read before they can act.** Labels, hints,
  descriptions, eyebrows, empty states, tooltips, confirmations.
- A control gets its label and **at most one short line of hint** (§11). A paragraph,
  a second sentence, or a hint that restates the label is a cut. Explanations belong
  in a help topic (`src/lib/help.ts`), not on the surface.
- Tighten labels: verb first, the noun the writer recognises, no filler ("your",
  "here", "you can", "in order to", "simply", "currently").
- Flag a title and description that say the same thing, and an eyebrow that repeats
  the heading under it.
- Keep live status lines (counts, warnings). They're information, not explanation.

### 2. Is too much going on at once? Will the reader breeze past it? (layout and organisation)

- **The glance test:** in two seconds, is there one obvious place for the eye to land
  and one obvious next action? Name the focal points you see. More than one primary
  thing competing is a finding.
- **Will it be skipped?** Look for what a writer will scroll past: a wall of equal-
  weight rows, important text styled like boilerplate, a key option buried mid-list,
  a hint in a spot nobody reads. Say what they'd miss and why.
- **Grouping:** related controls together under one `Section`, unrelated ones apart.
  Flag lone controls that belong in a neighbouring group, and groups of one.
- **Order:** most-used first, destructive last, the same order wherever the same
  set appears.
- **Disclosure level (§10):** is something on the surface that most writers rarely
  use? Propose moving it one level down (More menu, inspector, ⌘K). Never delete a
  capability; move it.
- **Rhythm:** uneven spacing, misaligned edges, a section that looks heavier than its
  importance. Fix with existing tokens and primitives only.

### 3. Do I need two of the same thing here? (duplication)

- The same action, information or control **visible twice on one screen at the same
  time**: two close buttons, a toolbar button and a panel button for one action, a
  heading and a tab both naming the section, a count shown in two places.
- The same idea said twice in copy (a description, then a hint, then a tooltip).
- **Not duplication:** an action that also lives in ⌘K, a context menu or a shortcut.
  §10 wants those. Only flag what a writer sees at once on the same surface.
- When two copies exist, recommend which one stays and why (where the writer looks
  first, or where DESIGN.md puts it).

## What you may not do

- No new primitives, tokens, colours, fonts, icons or layouts. No restyling of the
  shell, the card, the toolbar recipe or the brand.
- No removed features. A capability can move down a disclosure level, never vanish.
- No change to behaviour, keyboard shortcuts or data. Copy, order, grouping,
  spacing-by-token, and visibility only.
- Don't rewrite a surface wholesale. If a surface truly needs more than refinement,
  say so in one line and leave it for a `/design-review` round.
- Both themes, AA contrast, keyboard reach and reduced motion still hold after every
  edit.

## Output for a review run

Change no code. Write `docs/refine/<surface>.md` (one file per surface; with `all`, one
per surface plus an index ranked by impact), and keep each one short. For each surface:

1. **Verdict, one line:** "Mostly fine, two cuts" or "Busy: three things compete for
   the eye".
2. **Findings**, numbered, highest impact first, each with:
   - which question it answers (Words / Layout / Duplicate),
   - where it is (file and line, and the screenshot),
   - **before → after**, shown literally for copy (`"Choose a colour for this note so
     you can find it later"` → `"Note colour"`), and in one sentence for layout,
   - the size of the change (copy only, reorder, move, remove a duplicate).
3. **Leave alone:** things you considered and decided are fine, so I know you looked.

Keep it to the findings that matter; ten sharp ones beat thirty small ones. Then
**stop** and list the finding numbers. I'll answer per finding: yes, no, or a tweak
("4, but keep the hint"). Never pick for me, and never treat silence as a yes.

## `apply`

Only for findings I've said yes to, exactly as I've tweaked them.

1. Branch `refine/<surface>`. Make the edits, nothing else.
2. Recapture the surface in both themes and put before/after pairs in
   `design-review/out/refine/<surface>/`. Any visual change I didn't approve is a
   regression: fix it or bring it to me.
3. If a copy rule or placement you applied isn't written in DESIGN.md yet, add it in
   the same change (§16), and update the showcase if a primitive's usage changed.
4. Run `npm run lint && npm run lint:design && npm run typecheck && npm test && npm
   run build`. All must pass, with zero ESLint warnings.
5. Commit with Conventional Commits (`refactor(ui): tighten Settings copy`), and
   record each applied finding in `docs/design-review/decisions.md` so it isn't
   reopened.

## Taste, briefly

Quieter beats cleverer. Shorter beats more complete. One clear thing beats two
helpful ones. If you're unsure whether a cut loses meaning, propose it and say what
the risk is; I'll decide.
