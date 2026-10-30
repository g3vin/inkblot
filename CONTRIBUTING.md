# Contributing

Inkblot is open source under the [Apache License 2.0](LICENSE). Thank you for helping.
These are the working conventions for everyone who works on it.

Before changing anything that crosses a boundary (chrome ↔ document surface,
JavaScript ↔ Rust), read [ARCHITECTURE.md](ARCHITECTURE.md).

## Setup

Install the prerequisites in the [README](README.md#prerequisites), then `npm install`
and `npm run tauri dev`. `npm run dev` alone serves the page in a browser, without
the Tauri commands; `/?design` there is the design showcase.

If you use Claude Code, the project turns on its TypeScript and Rust code-intelligence
plugins (`.claude/settings.json`). They need the language servers on your `PATH`:
`npm i -g typescript-language-server typescript` and `rustup component add rust-analyzer`.

## Licensing your contribution

By contributing you agree that your work is licensed under the
[Apache License 2.0](LICENSE), the same as the rest of Inkblot (section 5 of the
licence). You keep the copyright in what you write. There is no CLA to sign.

To confirm you have the right to contribute it, sign off every commit under the
[Developer Certificate of Origin](https://developercertificate.org/):

```sh
git commit -s
```

This adds a line with your real name and email to the commit message:

```text
Signed-off-by: Your Name <you@example.com>
```

- **Only contribute work you have the right to give.** If your employer or school
  might own what you write, check with them first.
- **Code from elsewhere** must be under a licence compatible with Apache 2.0 (MIT,
  BSD, ISC, Apache 2.0, or the OFL for fonts). Keep its notice and say where it came
  from in the pull request. Nothing GPL, AGPL or under a "non-commercial" licence.
- **Generated code** follows the same rule. You are responsible for its origin.
- **The name and logo** aren't covered by the code licence. Forks and rebuilds follow
  [TRADEMARKS.md](TRADEMARKS.md).

## Branches

`main` is always releasable. Work happens on short-lived branches cut from `main` and merged back through a pull request.

Name a branch `<type>/<topic>`, using the same types as commits:

| Branch | For |
|---|---|
| `feat/maps-timeline` | A new capability |
| `fix/rename-open-document` | A bug fix |
| `refactor/editor-hooks` | Restructuring with no change in behaviour |
| `docs/privacy-policy` | Documentation only |
| `test/print-layout` | Tests only |
| `chore/bump-tauri` | Tooling, dependencies, housekeeping |
| `ci/cache-typeshare` | The CI workflows |

Delete the branch once it is merged.

## Commits

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<optional scope>): <summary in the imperative, lower case, no period>

<optional body: what changed and why, wrapped at 72 columns>
```

- **Types:** `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `style`, `build`,
  `ci`, `chore`.
- **Scopes** name the area: `core`, `models`, `bridge`, `canvas`, `maps`, `print`,
  `references`, `notes`, `editor`, `stats`, `toolbar`, `inspector`.
- Put a behaviour change in its own commit, separate from a refactor.
- A breaking change to the bridge protocol or the on-disk format gets a `BREAKING CHANGE:` footer.

## Pull requests

1. Fork the repository (or branch, if you have write access), rebase on `main`, sign
   off your commits and run the checks in the [README](README.md#checks). CI runs the
   web, Rust and generated-type checks. `npm run test:layout` is local only, so run it
   yourself when you touch `src/print/`.
2. Fill in the pull request template.
3. Merge with a merge commit, so the branch's history stays readable, and delete the branch.

## Design

Every user-facing change follows the design language in [docs/DESIGN.md](docs/DESIGN.md):
build from `src/ui/` and the tokens in `src/styles/tokens.css`, never hard-code a
colour, font, radius or shadow, and register new actions with the command palette.
`npm run dev` then `?design` shows every token and component in both themes.

## Adding a feature, end to end

Most features touch the same layers in the same order. Skip the ones yours doesn't need.

1. **Types.** A new shape on disk or on the bridge is defined once in Rust
   (`inkblot-core/src/types/` or `src/bridge/`), then `npm run types`.
2. **Logic.** Pure logic goes in `src/lib/` (or `src/lib/map/`, `src/lib/timeline/`,
   `src/print/`) with a suite in `tests/unit/`. If Rust needs it too, port it with a
   parity case ([ARCHITECTURE.md → Recipes](ARCHITECTURE.md#recipes)).
3. **Persistence.** Saving goes through the document layer (`src/lib/FileSystem.js`
   and its neighbours) or a Tauri command (`src-tauri/src/*_commands.rs`).
4. **The surface.** Editor behaviour is a TipTap extension in `src/extensions/`; a
   pane's behaviour is in `src/canvas/`, `src/map/`, `src/timeline/` or `src/print/`.
   If the chrome needs to see or change it, add a bridge command or event.
5. **The chrome.** Build the UI from `src/ui/`
   ([docs/DESIGN.md](docs/DESIGN.md)). Register every action with `useCommands` so ⌘K
   finds it, and add a toolbar item or an inspector field if it belongs there.
6. **Tests and docs.** Mount the component in a suite, update ARCHITECTURE.md if you
   changed how pieces fit, and add a line to CHANGELOG.md under Unreleased.

## Code style

- **Lint clean.** `npm run lint` must report 0 errors and 0 warnings. Format Rust with
  `cargo fmt`.
- **Comments follow the standard below.**
- **Generated files are never edited by hand.** `src/types/inkblot-core.ts` comes from
  `npm run types`.
- **Mount it or it's untested.** A component with logic worth keeping is mounted by a
  suite in `tests/unit/`.
- **Mirror both sides.** A function that exists in both JavaScript and Rust gets a
  parity case in `tests/parity/cases/`.

## Comments

**A comment explains why, not what or when.** The code says what it does, and git says
when and how it changed.

Write a comment for:

- Intent or reasoning the code can't show: why this approach, why this order.
- Invariants, preconditions and assumptions a caller or a later edit must keep.
- Performance, concurrency, ordering or security constraints that aren't obvious.
- Workarounds for an outside bug or platform quirk: one or two lines, a link to the
  issue, and when it can go (`WebKit drops the caret here; remove once
  https://bugs.webkit.org/… ships`).
- Public functions and types, in JSDoc (`/** … */`) or rustdoc (`///`): what it does,
  what it returns, and anything a caller must know. Skip it when the name and
  signature already say everything.
- A header at the top of any non-trivial module: what it is responsible for and how
  it fits with its neighbours.

Don't write:

- History: "changed from X", "previously", "now uses", "as before", dates, or
  which bug a line fixed. Put that in the commit message, the pull request or
  CHANGELOG.md.
- A comment that restates the next line.
- Commented-out code. Delete it; git keeps it.
- Long explanations of how several modules fit together. Those go in
  [ARCHITECTURE.md](ARCHITECTURE.md), with a short pointer in the code if needed.
- A bare `TODO`. Write `TODO(#123): …` or give a one-line reason, or don't write it.
- Comments addressed to, or written as, an AI assistant.

When you fix a bug, the explanation goes in the commit message. Add a comment only if
the fixed code would otherwise look wrong or removable, and then state the constraint,
not the story:

```js
// Bad: history, and it doesn't say what must stay true.
// Fixed the bug where renaming lost the last edit (was saving after the rename).

// Good: the constraint that still holds.
// Close the document first: its pane's final autosave writes to the path it had.
```

A lint suppression always carries its reason: `// eslint-disable-next-line rule -- why`.
