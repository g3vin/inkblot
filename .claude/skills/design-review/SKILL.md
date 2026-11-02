---
name: design-review
disable-model-invocation: true
description: Run a design review round on Inkblot's front end — capture the control, audit a pattern family, propose variants, wait for my picks, then unify.
argument-hint: [setup | audit | round <family> | apply <round> | status]
---

# Inkblot design review

You are running a **design review loop** for Inkblot's front end. The goal is
Apple-level consistency: one way to do each thing, everywhere, with features that
share a family resemblance and still have their own character. **I am the design
lead. You propose. I decide. Nothing visible changes in the product until I have
picked it.**

Command argument: `$ARGUMENTS` (if empty, run `status` and suggest the next step).

## Read first, every time

- `CLAUDE.md`, `docs/DESIGN.md` (the rules), `docs/design-handoff.md` (the state and
  the gotchas).
- `docs/design-review/decisions.md` and `docs/design-review/state.md` if they exist.
  These are your memory between sessions. Never re-ask a question that has already been
  decided there.

DESIGN.md stays the source of truth. This loop is how DESIGN.md changes deliberately
(§16). It is not a way around it.

---

## Core ideas

**The control.** The front end as it is today is the baseline. It is identified by a
git commit sha (recorded in `state.md`) plus the capture script below. Screenshots
are reproducible from that sha, so don't commit PNGs. Add `design-review/out/` to
`.gitignore`. The control only moves forward when I approve a round and it has been
applied.

**Pattern families.** The unit of review is a family of things that do the same job.
Examples: modals (Dialog / Sheet / large Popover / bespoke overlays), panel headers,
inspector sections, footers and button order, empty states, toolbars, menus, list rows,
cards, form layouts, confirmations, toasts and errors, onboarding and landing.

**Merge candidates.** These are instances in one family that do the same job in
different ways: different header anatomy, close-button placement, footer order,
padding, width, motion, Escape and focus behaviour, or copy pattern. Each one should
either merge into a single unified state or be justified as a deliberate exception.

**Skeleton and signature.** Every feature shares a **skeleton**: shell, header
anatomy, spacing, motion, controls, footer order and voice. Each feature may own a
small, declared **signature**: its icon, an eyebrow, an ink it's associated with, its
empty-state line, and maybe one bespoke visual that serves its content (the map's
globe, the canvas grid). Anything else that differs is drift. Part of this work is
writing down, per feature, what its signature is.

---

## Sub-commands

### `setup` (run once, then only when surfaces are added)

1. Create a branch `design/review-setup`.
2. Build **`scripts/dev/capture.mjs`** by generalising `scripts/dev/screenshot.mjs`.
   Keep using `tauri-mock.js` and playwright-core (`npm i --no-save playwright-core
   pixelmatch pngjs`; in cloud containers Chromium is at
   `/opt/pw-browsers/chromium-*/chrome-linux/chrome`). It reads a surface catalogue
   and, for each surface × theme (light, dark) × viewport (1400×900 desktop, 820×1180
   iPad), writes `design-review/out/<run>/<surface>-<theme>-<viewport>.png`. It takes
   `--only <glob>` and `--variant <family>:<id>`.
3. Write **`design-review/surfaces.json`**: every surface a writer can see, each with
   a stable id, the family it belongs to, and the Playwright steps that open it. Cover:
   the landing page, editor (empty, with text, scrolled), each panel open, every Sheet
   (Settings and each tab, Customize toolbar, Page setup, …), every Popover, menus,
   the command palette, every confirmation, empty states, canvas, map, timeline, print
   layout, focus mode, and stats. Find them by grepping `src/` for `Sheet`, `Popover`,
   `Dialog`, `Menu`, `EmptyState`, `Panel` and any element positioned `fixed` or with
   `--z-dialog`/`--z-popover`. List what you couldn't reach through the mock, rather
   than skipping it silently.
4. Capture the **control** at the current `main` sha. Record the sha, the date and the
   surface count in `docs/design-review/state.md`.
5. Build **`scripts/dev/compare.mjs`**: given two runs, it pixel-diffs matching
   screenshots and writes a report of the changed surfaces and the % of pixels changed.
6. Stop. Report what was captured and what couldn't be, then suggest running `audit`.

### `audit`

Read-only: change no UI code. For each pattern family:

1. **Inventory** every instance, with its file and line, the primitive it uses (or
   "bespoke"), and its control screenshot.
2. Build a **divergence matrix**. Rows are instances; columns are the attributes that
   should be the same. For modals, for example: primitive, width, radius, shadow,
   eyebrow/title/description anatomy, close affordance and position, footer order
   (secondary left, primary right), primary-button variant, padding, entry/exit motion
   and duration, Escape, click outside, focus trap and return, scroll behaviour, and
   copy pattern. Measure from computed styles in the browser rather than guessing from
   source.
3. Mark the **merge candidates**, and score each family by *visibility* (how often a
   writer sees it) × *divergence* (how many attributes disagree).
4. Note where DESIGN.md is **silent or ambiguous** for a family. Those are decisions I
   need to make, not ones for you to infer.
5. Draft the **skeleton and signature** table for each major feature (editor, notes,
   canvas, map, timeline, print/typeset, stats, references, history): what it shares
   and what it owns today.

Write all of this to `docs/design-review/audit.md`, and build a browsable
`design-review/out/audit.html` with thumbnails per family, grouped so I can see the
drift at a glance. Then propose an **order for the rounds** (highest score first;
modals are likely first) and stop.

### `round <family>`

One family per round, with at most ~6 decisions, so each round is something I can
review in one sitting.

1. Branch `design/round-NN-<family>` off the latest control sha.
2. For each decision, prepare **options**:
   - **A: Control.** Exactly as it is today. Always present.
   - **B: Unify to the best existing instance.** Name which one and why.
   - **C, and optionally D: New proposals**, grounded in DESIGN.md's principles. Say
     which rule each one serves, and what it costs (migration size, risk).
   Options must be real code, not mock-ups. Implement them in the `src/ui` primitive
   (or a new one) behind a **dev-only variant switch**, read from
   `?variant=<family>:<option>` and never shipped in production builds. With no
   variant set, the app must render pixel-identical to the control: verify with
   `compare.mjs`.
3. Capture every affected surface for every option in both themes.
4. Build the **review board**: `design-review/out/round-NN/board.html`. For each
   decision it shows the options side by side (light over dark), in context on 2–3
   real surfaces rather than in isolation, plus one line per option on what changed
   and why. Add live links (`http://localhost:5173/?variant=…`) so I can click
   through motion, focus and keyboard behaviour that screenshots can't show. Include
   a "doesn't change" note so I know what was held constant.
5. Write `docs/design-review/rounds/NN-<family>.md` with the decisions, the options
   and your recommendation. Keep the recommendation separate from the options and
   short.
6. **Stop and ask me.** List the decisions with their option letters. I may answer per
   decision with: pick (`2: B`), mix (`3: B header + C footer`), tweak (`1: C but
   24px padding`), reject all and keep the control, or "more options". Iterate on that
   round until every decision has a pick. Never pick for me, and never treat silence
   as approval.

### `apply <round>`

Only after every decision in the round has an explicit pick from me.

1. Make the chosen option *the* implementation in one place (the `src/ui` primitive
   or a token), then migrate **every** instance from the audit onto it. Delete the
   losing options and the variant switch for this family.
2. For an instance that should stay different, it is a **declared exception**: list
   it with my reason in DESIGN.md, or it gets unified too.
3. Update `docs/DESIGN.md` (the rule, the component table, and the skeleton/signature
   section if touched), the showcase (`src/dev/DesignShowcase.jsx`) and
   `docs/design-handoff.md`, in the same change.
4. Recapture everything and run `compare.mjs` against the control. **Every changed
   surface must be explained by an approved decision.** List any unexplained diff as
   a regression and fix it, or bring it to me. Don't wave it through.
5. Run `npm run lint && npm run lint:design && npm run typecheck && npm test && npm
   run build`. All must pass, with zero ESLint warnings.
6. Append to `docs/design-review/decisions.md` one entry per decision: id, family,
   options considered, my pick, my reason in my words, date, and commit sha.
7. Open a PR using Conventional Commits, with a "Design decisions" section linking
   the round file and the before/after board. When I merge it, the merge sha becomes
   the new control: update `state.md`.

### `status`

Read `state.md`, `decisions.md` and `audit.md`. Report the control sha, the rounds
done, the round in progress and its open decisions, the families not started, and any
declared exceptions. Suggest the single next step.

---

## Rules for the whole loop

- **I vet everything.** You may audit, measure, prototype behind the variant switch
  and recommend freely. You may not change what a writer sees on `main` without a
  recorded pick from me.
- **The control is sacred.** If the default render drifts from the control while you
  prototype, stop and fix it before anything else.
- **Unify, don't add.** The best outcome of a decision is usually fewer variants in
  the codebase. A new primitive needs a stated reason why no existing one fits.
- **Consistency of behaviour, not only looks.** Same keys, same focus, same motion
  tokens, same dismiss rules, same copy patterns (DESIGN.md §11).
- **Every option respects the guardrails:** tokens only, both themes, AA contrast,
  keyboard reachable, reduced motion honoured, glass only where §12 allows.
- **Show, don't describe.** Every decision I'm asked to make comes with screenshots
  in context, in both themes. A paragraph is not a design option.
- **Small rounds.** If a family needs more than ~6 decisions, split it into rounds
  and say so.
- **Ask when DESIGN.md is silent.** Don't invent a rule and then present it as
  existing policy.