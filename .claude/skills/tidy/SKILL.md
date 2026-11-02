---
name: tidy
# A forked subagent on a lighter model does the pass, so the review costs little and
# only a short report comes back to the conversation.
context: fork
model: sonnet
description: Final pass on a finished code change. Makes the new code simple and legible (names, shape, dead code, reuse, comments) without changing behaviour, then records the tree as tidied. Run it when a code change is done, before committing or reporting it finished; the Stop hook asks for it. Reviews only what changed since the last tidy.
argument-hint: "[optional: paths to limit the pass to]"
allowed-tools: Read, Grep, Glob, Bash, Edit, LSP
---

# Tidy

You give a finished change a last pass for simplicity and legibility, as a careful
reviewer on this codebase would. You fix what is local and safe, and you never change
behaviour.

## 1. Get the diff

Run `node scripts/claude/tidy.mjs diff $ARGUMENTS`. If it prints "Nothing to tidy",
reply "Tidy: nothing new to review." and stop. If the diff runs past about 1,500 lines,
review the files with the most changed lines first and name the ones you skipped.

Review the changed lines and the function around them. Read more of a file only to
answer a question below; don't read whole files.

## 2. Review

For each point: fix it when the fix is in the changed code, keeps behaviour, and is
clearly better. Otherwise list it in the report.

- **Names** say what a thing is, in the words the neighbouring code already uses (grep
  them). No `data`, `tmp`, `obj`, `handle2`; booleans read as questions (`isOpen`).
- **Shape.** Early returns instead of nesting deeper than three levels. A function that
  does two jobs splits only when both halves are things you can name. No boolean
  parameter that switches the whole behaviour.
- **Less code.** Remove dead code, unused imports, variables and parameters, duplicated
  branches, an abstraction with one caller that adds nothing, a defensive check for a
  state that can't happen (confirm it can't first). Before keeping a new helper, `rg`
  for an existing one in `src/lib`, `src/hooks`, `src/ui` or the crate's own modules.
- **Comments** follow [CONTRIBUTING.md → Comments](../../../CONTRIBUTING.md#comments):
  why, not what; no history ("now", "previously", "fixed"), no restating the code, no
  commented-out code, nothing addressed to an AI. A new module opens with a header
  saying what it owns; a changed mirrored module keeps its `Mirrors:` line true.
- **Fits in.** Same idioms, error handling and import style as the neighbours; UI uses
  the `src/ui` primitives and design tokens rather than one-off styles.
- **Size.** No file pushed past 700 lines (the post-edit hook reports it).

Don't touch code the diff didn't change, rename anything used outside the diff, reformat
(the hooks do), add comments for their own sake, or swap one reasonable style for another.

## 3. Check your edits

If you edited anything, run `npm run affected` and then the test and lint commands it
prints (skip `npm run build`). Fix what your edit broke, or undo that edit.

## 4. Mark

Always run `node scripts/claude/tidy.mjs mark` last, even when you changed nothing, so
the next pass starts from here.

## 5. Report

At most 15 lines: each change as `path:line — what` (a few words), then anything you'd
change but left (and why), then check results as `✓`/`✗` lines. If you changed nothing:
"Tidy: no changes."
