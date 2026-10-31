---
name: audit
disable-model-invocation: true
# A forked subagent reads the whole slice; only the findings come back to the conversation.
context: fork
description: Audit the codebase for bugs a slice at a time (about 2,500 lines per run), with a ledger so an unchanged file is never reviewed twice. The code-review method (find, then verify each finding) applied to whole files instead of a diff.
argument-hint: "[path] [--lines N] | status"
allowed-tools: Read, Grep, Glob, Bash, LSP, Write
---

# Audit

You audit one slice of the Inkblot codebase for bugs and report only findings you
verified. You never edit source files.

**Arguments:** $ARGUMENTS

## 0. Status only

If the arguments are `status` (or `status --full`), run
`node scripts/claude/audit.mjs $ARGUMENTS`, reply with its output unchanged, and stop.

## 1. Pick the slice

Run `node scripts/claude/audit.mjs next $ARGUMENTS`. It prints the files due (never
audited, or changed since their audit), sized for one run. If it prints "Nothing due",
reply with that line and stop. Audit exactly the files it lists.

## 2. Load the context

- `ARCHITECTURE.md` → "Things that will bite you" (`awk '/^## Things that will bite you/{f=1;print;next} f&&/^## /{exit} f' ARCHITECTURE.md`),
  and the section for the slice's area if it has one (`grep -n '^## ' ARCHITECTURE.md`).
- Read every file in the slice in full: the slice is sized for it. A file with a
  `Mirrors:` header has a Rust or JS twin; open the twin's matching function when the
  slice depends on the two agreeing.

## 3. Find candidates

Go through each file with these lenses, most important first. Note every candidate with
file:line; judge them in step 4, not here.

1. **Losing the writer's work.** Anything that can lose, corrupt, duplicate or
   overwrite writing: autosave, rename, move, delete, version history, migrations,
   partial writes, a write without `docLock`, an error swallowed on a save path.
2. **Logic.** Inverted or wrong conditions, off-by-one, wrong variable, an unreachable
   or missing branch, a mutated shared object, wrong units (px/pt, ms/s, 0/1-based).
3. **Edge input.** Empty document, selection or list; null/undefined; NaN; emoji and
   other multi-code-unit text (string indices vs graphemes), CRLF, very long text.
4. **Async and ordering.** Missing `await`, unhandled rejections, races between save,
   rename and close, a stale closure, a listener or timer never removed, effects without
   cleanup, a state update after unmount, wrong or missing dependency arrays.
5. **Boundaries.** JS and Rust twins that disagree; a bridge message whose shape differs
   between sender and receiver; a Rust `unwrap`/`expect` on IO or input that can fail;
   a path from the page used without checking it stays inside the project; HTML put
   into the DOM unsanitised.
6. **Cleanups, only when clear-cut.** Logic that duplicates an existing helper, dead
   code, needless complexity, real waste on a hot path (per keystroke, per frame).

Skip style and anything lint, typecheck or `lint:size` already enforce.

## 4. Verify each candidate

This step is what makes the report worth reading. For each candidate:

- Re-read the lines and trace the inputs: find the callers (LSP, or `rg` with a path)
  and confirm the bad state can actually reach this code and isn't guarded upstream.
- Check the tests in `tests/unit/` for the case; a test that pins the behaviour as
  intended means it isn't a bug.
- Write a concrete failure scenario: these inputs or this state, then this wrong result
  or crash. If you can't, drop the candidate.
- Mark it **CONFIRMED** when you traced it end to end, **PLAUSIBLE** when it depends on
  something you couldn't confirm. Severity: **high** loses or corrupts writing,
  crashes, or is a security hole; **medium** is wrong behaviour a writer will hit;
  **low** is a rare edge case or a cleanup.

Be adversarial about your own candidates: a short report of real bugs beats a long one.

## 5. Record

Write `.claude/audit/pending.json`:

```json
{
  "files": ["every file the slice listed, exactly as printed"],
  "findings": [
    { "file": "src/…", "line": 42, "severity": "high", "category": "data-loss",
      "verdict": "CONFIRMED", "summary": "one sentence: the defect",
      "failure_scenario": "inputs or state → wrong result" }
  ]
}
```

Then run `node scripts/claude/audit.mjs done .claude/audit/pending.json`.

## 6. Report

Only this comes back to the conversation, so keep it under 40 lines:

- The slice in one line (directory, file count, lines).
- Each finding, most severe first:
  `path:line — [severity, verdict] summary` and, indented under it, the failure scenario
  in one line.
- The progress line `done` printed, and `Next: /audit` (or `/audit status` for the full list).

No praise and no list of what looked fine. If nothing survived verification, say so
in one line.
